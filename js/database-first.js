import { supabase } from './supabase.js';
import { createConflictRecovery } from './conflict-recovery.js';
import { retryStartup } from './startup-retry.mjs';
import { loadManagerDataBridge } from './manager-data-bridge.js';

const QUEUE_KEY = 'ms-factory-db-queue-v1';
const BASELINE_KEY = 'ms-factory-db-baseline-v1';
const LAST_SYNC_KEY = 'ms-factory-db-last-sync-v1';
const CONFLICT_REVIEW_KEY = 'ms-factory-db-conflict-review-v1';
const CONFLICT_BLOCK_KEY = 'ms-factory-db-conflict-block-v1';
const CACHE_PREFIX = 'ms-factory-db-cache-v1:';
const MANAGER_CACHE_KEY = 'ms-factory-manager-bridge-v1:';
let storageScope = 'anonymous';
const scopedKey = key => key + ':' + storageScope;
const conflictRecovery = () => createConflictRecovery({ scope: storageScope });
const getLastSyncAt = () => localStorage.getItem(scopedKey(LAST_SYNC_KEY)) || '';
const setLastSyncAt = value => { try { localStorage.setItem(scopedKey(LAST_SYNC_KEY), value); } catch (_) {} };
const cachePrefix = () => CACHE_PREFIX + storageScope + ':';
const cacheKey = (type,id) => cachePrefix() + encodeURIComponent(type) + ':' + encodeURIComponent(id);
function cacheRow(row) { try { localStorage.setItem(cacheKey(row.record_type,row.record_id), JSON.stringify(row)); } catch (e) { console.warn('Local offline cache write failed',e); } }
function loadCachedRows() { const rows=[]; const prefix=cachePrefix(); for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key||!key.startsWith(prefix))continue;try{const row=JSON.parse(localStorage.getItem(key)||'null');if(row&&row.record_type&&row.record_id)rows.push(row)}catch(_){}} return rows; }
const PAGE_SIZE = 1000;
let ownerId = null;
let actorId = null;
let profile = null;
let baseline = new Map();
let stateReady = false;
let saveChain = Promise.resolve();
let channel = null;
let applyingRemote = false;
// A stale-version conflict is terminal for this browser session.
let conflictWriteLock = false;

const clone = value => JSON.parse(JSON.stringify(value ?? null));
function withRequestTimeout(query, ms = 9000) {
  return typeof AbortSignal !== 'undefined' && AbortSignal.timeout && typeof query?.abortSignal === 'function'
    ? query.abortSignal(AbortSignal.timeout(ms)) : query;
}
const stable = value => {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).filter(k => !k.startsWith('_cloud')).sort().map(k => JSON.stringify(k)+':'+stable(value[k])).join(',') + '}';
  return JSON.stringify(value);
};
const recordKey = (type, item, index) => {
  const id = item && typeof item === 'object'
    ? (item._cloudRecordId ?? item.id ?? item.no ?? item.code ?? item.sku ?? item.external_id)
    : null;
  return String(id !== undefined && id !== null && id !== '' ? id : 'legacy-index-' + index);
};
const cleanPayload = item => {
  const out = clone(item);
  if (out && typeof out === 'object' && !Array.isArray(out)) {
    delete out._cloudUpdatedAt;
    delete out._cloudConflict;
    delete out._cloudVersion;
    delete out._cloudRecordId;
  }
  return out;
};
const getQueue = () => {
  try { const q = JSON.parse(localStorage.getItem(scopedKey(QUEUE_KEY)) || '[]'); return Array.isArray(q) ? q : []; }
  catch (_) { return []; }
};
const setQueue = q => localStorage.setItem(scopedKey(QUEUE_KEY), JSON.stringify(q));
const mapKey = (type, id) => type + '\u0000' + id;
const isNetworkFailure = error => {
  if (!navigator.onLine) return true;
  const message = String(error?.message || error || '').toLowerCase();
  return error instanceof TypeError || /failed to fetch|network|fetch failed|load failed|timeout|timed out|502|503|504/.test(message) || [0, 502, 503, 504].includes(Number(error?.status));
};
function getState() {
  if (typeof window.__factoryGetState !== 'function') throw new Error('تطبيق المصنع لم يجهز حالة البيانات');
  return window.__factoryGetState();
}
function splitState(state) {
  const arrays = {};
  const meta = {};
  for (const [key, value] of Object.entries(state || {})) {
    if (Array.isArray(value)) arrays[key] = value;
    else if (key !== 'pend' && key !== 'undefined' && typeof value !== 'function') meta[key] = value;
  }
  return { arrays, meta };
}
function clearLegacyDeviceData() {
  if (conflictRecovery().hasBlock()) return;
  const marker = 'ms-factory-empty-device-v2:' + storageScope;
  if (localStorage.getItem(marker) === '1') return;
  const remove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (key === 'mgr6' || key === 'mgr6-sync-pending' || key === 'mgr6-cloud-snapshot-conflict' ||
        key.startsWith('mgr6-backup') ||
        key.startsWith('ms-factory-db-baseline-v1:') || key.startsWith('ms-factory-db-last-sync-v1:') ||
        key.startsWith('ms-factory-db-cache-v1:')) remove.push(key);
  }
  for (const key of remove) localStorage.removeItem(key);
  localStorage.setItem(marker, '1');
}
function archiveLegacyQueues() {
  if (conflictRecovery().hasBlock()) return;
  const keys = [QUEUE_KEY, scopedKey(QUEUE_KEY)];
  for (const key of keys) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    let operations;
    try { operations = JSON.parse(raw); }
    catch (_) {
      conflictRecovery().persistBlock({ ownerId, reason: 'طابور قديم غير قابل للقراءة؛ لم يتم حذفه أو إرساله.' });
      throw new Error('توجد قائمة عمليات قديمة تالفة. تم الاحتفاظ بها ومنع إرسالها.');
    }
    if (!Array.isArray(operations)) {
      conflictRecovery().persistBlock({ ownerId, reason: 'صيغة الطابور القديم غير معروفة؛ لم يتم حذفه أو إرساله.' });
      throw new Error('توجد قائمة عمليات قديمة بصيغة غير معروفة. تم الاحتفاظ بها ومنع إرسالها.');
    }
    if (!operations.length) { localStorage.removeItem(key); continue; }
    conflictRecovery().archiveRejectedQueue(operations, {
      capturedAt: new Date().toISOString(), ownerId, actorId,
      reason: 'طابور من إصدار سابق؛ تم أرشفته للمراجعة ولم يُرسل إلى قاعدة البيانات.'
    }, key);
  }
}
function resetLocalBusinessState() {
  const state = getState();
  const { arrays } = splitState(state);
  const patch = {};
  for (const [type, items] of Object.entries(arrays)) {
    // Discard every seeded/demo business collection; only the authenticated production database may populate it.
    patch[type] = type === 'curs' ? ['EGP','USD','EUR'] : [];
  }
  window.__factoryReplaceArrays?.(patch);
}
function persistBaseline() {
  try {
    localStorage.setItem(scopedKey(BASELINE_KEY), JSON.stringify([...baseline.values()].map(row => ({
      type:row.type,id:row.id,version:Number(row.version||0),deleted_at:row.deleted_at||null
    }))));
  } catch (e) { console.warn('Could not persist sync versions',e); }
}
function snapshotBaseline(state) {
  baseline = new Map();
  const { arrays, meta } = splitState(state);
  const current = new Map();
  for (const [type,items] of Object.entries(arrays)) {
    items.forEach((item,index) => {
      const id=recordKey(type,item,index);
      current.set(mapKey(type,id),{type,id,payload:cleanPayload(item)});
    });
  }
  current.set(mapKey('__meta','main'),{type:'__meta',id:'main',payload:meta});
  try {
    const saved=JSON.parse(localStorage.getItem(scopedKey(BASELINE_KEY))||'[]');
    if(Array.isArray(saved)&&saved.length){
      for(const row of saved){
        const item=current.get(mapKey(row.type,row.id));
        baseline.set(mapKey(row.type,row.id),{
          type:row.type,id:row.id,payload:item?.payload??null,
          version:Number(row.version||0),deleted_at:row.deleted_at||null
        });
      }
      for(const [key,item] of current) if(!baseline.has(key)) baseline.set(key,{...item,version:0,deleted_at:null});
      persistBaseline();
      return;
    }
  } catch (_) {}
  for (const [key,item] of current) baseline.set(key,{...item,version:0,deleted_at:null});
  persistBaseline();
}
function setBaselineRow(row) {
  baseline.set(mapKey(row.record_type, row.record_id), {
    type: row.record_type, id: row.record_id, payload: clone(row.payload),
    version: row.version == null ? 1 : Number(row.version), deleted_at: row.deleted_at || null
  });
  // Manager source rows are a read-only base, cached separately per administrator.
  if(row.origin!=="manager-import")cacheRow(row);
}
async function fetchPagedRecords(buildQuery) {
  const all = [];
  const first = await withRequestTimeout(buildQuery().range(0, PAGE_SIZE - 1));
  if (first.error) throw first.error;
  all.push(...(first.data || []));
  if (!first.data || first.data.length < PAGE_SIZE) return all;
  const concurrentPages = 4;
  for (let base = PAGE_SIZE; ; base += PAGE_SIZE * concurrentPages) {
    const pages = await Promise.all(Array.from({ length: concurrentPages }, (_, index) =>
      withRequestTimeout(buildQuery().range(base + index * PAGE_SIZE, base + (index + 1) * PAGE_SIZE - 1))
    ));
    for (const page of pages) {
      if (page.error) throw page.error;
      all.push(...(page.data || []));
    }
    if (pages.some(page => !page.data || page.data.length < PAGE_SIZE)) break;
  }
  return all;
}
function managerCacheKey(actor) { return MANAGER_CACHE_KEY + String(actor || "anonymous") + ":" + String(ownerId || "no-owner"); }
function loadManagerCache(actor) {
  try {
    const rows = JSON.parse(localStorage.getItem(managerCacheKey(actor)) || "[]");
    return Array.isArray(rows) ? rows.filter(r=>r&&r.record_type&&r.record_id) : [];
  } catch (_) { return []; }
}
function saveManagerCache(actor, rows) {
  try { localStorage.setItem(managerCacheKey(actor),JSON.stringify(rows)); return true; }
  catch (error) { console.warn("Manager bridge cache could not be saved; data will be reloaded online:",error); return false; }
}
function managerStateToRows(state) {
  const rows=[];
  for(const [type,items] of Object.entries(state||{})){
    if(!Array.isArray(items))continue;
    items.forEach((payload,index)=>{
      const id=recordKey(type,payload,index);
      rows.push({user_id:ownerId,record_type:type,record_id:id,payload:cleanPayload(payload),version:0,deleted_at:null,updated_at:null,updated_by:null,origin:"manager-import"});
    });
  }
  return rows;
}
async function getManagerBridgeRows() {
  if(profile?.is_admin!==true)return [];
  const cached=loadManagerCache(actorId);
  if(cached.length){window.__factoryManagerBridgeLoaded=true;return cached;}
  try{
    const state=await retryStartup(()=>loadManagerDataBridge(supabase,ownerId));
    if(!state)return [];
    const rows=managerStateToRows(state);
    saveManagerCache(actorId,rows);
    window.__factoryManagerBridgeLoaded=true;
    return rows;
  }catch(error){
    window.__factoryManagerBridgeError=error?.message||String(error);
    console.error("Manager data bridge failed:",error);
    document.dispatchEvent(new CustomEvent("factory-manager-bridge-error",{detail:{message:window.__factoryManagerBridgeError}}));
    return [];
  }
}
async function fetchAllRecords() {
  return fetchPagedRecords(() => supabase.from('factory_records')
    .select('user_id,record_type,record_id,payload,version,deleted_at,updated_at,updated_by')
    .eq('user_id', ownerId).neq('record_type', 'manager_archive_095620')
    .order('record_type').order('record_id'));
}
async function fetchChangedRecords(since) {
  if (!since) return [];
  return fetchPagedRecords(() => supabase.from('factory_records')
    .select('user_id,record_type,record_id,payload,version,deleted_at,updated_at,updated_by')
    .eq('user_id', ownerId).neq('record_type', 'manager_archive_095620')
    .gt('updated_at', since)
    .order('updated_at').order('record_type').order('record_id'));
}
function hydrateFromRows(rows) {
  const groupedMaps = {};
  const orderedRows = [...(rows || [])].sort((a,b)=>(a.origin==="manager-import"?0:1)-(b.origin==="manager-import"?0:1));
  const metaRow = orderedRows.find(r => r.record_type === '__meta' && r.record_id === 'main' && !r.deleted_at);
  for (const row of orderedRows) {
    setBaselineRow(row);
    if (row.record_type === '__meta') continue;
    const target = (groupedMaps[row.record_type] ||= new Map());
    if (row.deleted_at) {
      target.delete(String(row.record_id));
      continue;
    }
    const payload = clone(row.payload);
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) payload._cloudRecordId = row.record_id;
    target.set(String(row.record_id),payload);
  }
  const grouped = Object.fromEntries(Object.entries(groupedMaps).map(([type,items])=>[type,[...items.values()]]));
  for (const values of Object.values(grouped)) values.sort((a,b) => {
    const ai = Number(a?.id), bi = Number(b?.id);
    return Number.isFinite(ai) && Number.isFinite(bi) ? ai-bi : String(a?.id ?? a?.no ?? '').localeCompare(String(b?.id ?? b?.no ?? ''));
  });
  const local = getState();
  const { arrays: localArrays } = splitState(local);
  const patch = {};
  for (const [type, items] of Object.entries(localArrays)) {
    patch[type] = grouped[type] || (type === 'accts' || type === 'wh' ? items : []);
  }
  for (const [type, items] of Object.entries(grouped)) {
    if (!Object.prototype.hasOwnProperty.call(patch, type)) patch[type] = items;
  }
  if (metaRow?.payload && typeof metaRow.payload === 'object') patch.__meta = metaRow.payload;
  window.__factoryReplaceArrays?.(patch);
  const current = getState();
  const { arrays, meta } = splitState(current);
  // Existing local seed/legacy values are a local baseline only, never bulk-uploaded on first launch.
  for (const [type, items] of Object.entries(arrays)) {
    items.forEach((item, index) => {
      const id = recordKey(type, item, index), key = mapKey(type,id);
      if (!baseline.has(key)) baseline.set(key, { type, id, payload: cleanPayload(item), version: 0, deleted_at: null });
    });
  }
  if (!baseline.has(mapKey('__meta','main'))) baseline.set(mapKey('__meta','main'), { type:'__meta', id:'main', payload:meta, version:0, deleted_at:null });
  persistBaseline();
}
function makeOperations(state) {
  const { arrays, meta } = splitState(state);
  const current = new Map();
  for (const [type, items] of Object.entries(arrays)) {
    items.forEach((item,index) => {
      const id = recordKey(type,item,index);
      current.set(mapKey(type,id), { type, id, payload: cleanPayload(item) });
    });
  }
  current.set(mapKey('__meta','main'), { type:'__meta', id:'main', payload:meta });
  const operations = [];
  for (const [key, item] of current) {
    const old = baseline.get(key);
    if (!old || stable(old.payload) !== stable(item.payload) || old.deleted_at) {
      operations.push({ ...item, expectedVersion: old?.version || 0, deleted: false });
    }
  }
  for (const [key, old] of baseline) {
    if (old.deleted_at) continue;
    if (!current.has(key)) operations.push({ type:old.type, id:old.id, payload:null, expectedVersion:old.version || 0, deleted:true });
  }
  return operations;
}
async function writeOperations(operations) {
  if (!operations.length) return;
  const records = operations.map(op => ({
    user_id: ownerId,
    record_type: op.type,
    record_id: op.id,
    payload: op.deleted ? {} : op.payload,
    expected_version: Number(op.expectedVersion || 0),
    deleted_at: op.deleted ? new Date().toISOString() : null
  }));
  const { data, error } = await supabase.rpc('apply_factory_record_batch', { p_records: records });
  if (error) {
    if (error.code === '40001' || String(error.message || '').includes('FACTORY_RECORD_CONFLICT')) {
      const conflict = new Error('تعارض تعديل: سجل اتغير من جهاز آخر. لم يتم الكتابة فوق النسخة الأحدث.');
      conflict.code = 'FACTORY_RECORD_CONFLICT';
      throw conflict;
    }
    throw error;
  }
  for (const row of data || []) setBaselineRow(row);
  persistBaseline();
  const updated = (data || []).map(row => row.updated_at).filter(Boolean).sort().pop();
  if (updated) setLastSyncAt(updated);
}
function queueOperations(operations) {
  const queue = getQueue();
  const latest = new Map(queue.map(item => [mapKey(item.type,item.id), item]));
  for (const op of operations) {
    const key = mapKey(op.type,op.id);
    const prior = latest.get(key);
    latest.set(key, { ...op, expectedVersion: prior ? prior.expectedVersion : op.expectedVersion, queuedAt: Date.now() });
  }
  setQueue([...latest.values()]);
  localStorage.setItem('mgr6', JSON.stringify(getState()));
  localStorage.setItem('mgr6-sync-pending', JSON.stringify({ at:Date.now(), count:latest.size }));
}
function applyOperationToState(op) {
  if (op.type === '__meta') {
    if (!op.deleted && op.payload) window.__factoryReplaceArrays?.({__meta:op.payload});
    return;
  }
  const state = getState();
  const list = Array.isArray(state[op.type]) ? [...state[op.type]] : [];
  const index = list.findIndex((item,i) => recordKey(op.type,item,i) === op.id);
  if (op.deleted) { if (index >= 0) list.splice(index,1); }
  else if (index >= 0) { list[index] = clone(op.payload); if (list[index] && typeof list[index] === 'object') list[index]._cloudRecordId = op.id; }
  else { const item = clone(op.payload); if (item && typeof item === 'object') item._cloudRecordId = op.id; list.push(item); }
  window.__factoryReplaceArrays?.({[op.type]:list});
}
async function flushQueue() {
  if (conflictWriteLock || conflictRecovery().hasBlock()) {
    conflictWriteLock = true;
    window.__factoryDatabaseFirstFailed = true;
    throw new Error('الحفظ موقوف بعد تعارض البيانات. أعد تحميل الصفحة لمراجعة النسخة المؤكدة.');
  }
  if (!navigator.onLine || !getQueue().length) return;
  const queue = getQueue();
  await writeOperations(queue);
  for (const op of queue) applyOperationToState(op);
  setQueue([]);
  localStorage.removeItem('mgr6');
  localStorage.removeItem('mgr6-sync-pending');
}
async function persistState(state) {
  if (!stateReady || applyingRemote) return;
  if (conflictWriteLock || conflictRecovery().hasBlock() || window.__factoryDatabaseFirstFailed) throw new Error('الحفظ موقوف بعد تعارض البيانات. أعد تحميل الصفحة لمراجعة النسخة المؤكدة.');
  const ops = makeOperations(state);
  if (!ops.length) return;
  if (!navigator.onLine || window.__factoryOfflineMode === true) {
    queueOperations(ops);
    return;
  }
  saveChain = saveChain.catch(() => {}).then(async () => {
    if (conflictWriteLock || window.__factoryDatabaseFirstFailed) throw new Error('الحفظ موقوف بعد تعارض البيانات. أعد تحميل الصفحة لمراجعة النسخة المؤكدة.');
    try {
      await flushQueue();
      const latestOps = makeOperations(getState());
      if (latestOps.length) {
        const pending = new Map(getQueue().map(item => [mapKey(item.type,item.id),item]));
        for (const op of latestOps) pending.set(mapKey(op.type,op.id),op);
        setQueue([...pending.values()]);
        await flushQueue();
      }
      localStorage.removeItem('mgr6-sync-pending');
    } catch (error) {
      if (error?.code === 'FACTORY_RECORD_CONFLICT' || String(error?.message || '').includes('FACTORY_RECORD_CONFLICT')) {
        // The atomic batch was rejected. Discard stale retries; never replay them.
        conflictWriteLock = true;
        window.__factoryDatabaseFirstFailed = true;
        const rejectedQueue = getQueue();
        const conflictAt = new Date().toISOString();
        try {
          conflictRecovery().archiveRejectedQueue(rejectedQueue, {
            capturedAt:conflictAt,
            ownerId,
            actorId,
            reason:'FACTORY_RECORD_CONFLICT: the atomic apply_factory_record_batch RPC rejected the complete submitted batch.'
          }, scopedKey(QUEUE_KEY));
          localStorage.removeItem('mgr6');
          localStorage.removeItem('mgr6-sync-pending');
        } catch (archiveError) {
          console.error('Could not archive rejected operations for review; queue retained:',archiveError);
        }
        document.dispatchEvent(new CustomEvent('factory-db-conflict',{detail:{message:'تعارض نسخة البيانات. أوقفنا الحفظ، وحفظنا العمليات المرفوضة للمراجعة قبل تفريغ طابور الإرسال. أعد تحميل الصفحة لجلب البيانات المؤكدة.'}}));
        throw error;
      }
      if (isNetworkFailure(error)) {
        queueOperations(makeOperations(getState()));
        return;
      }
      throw error;
    }
  });
  return saveChain;
}
function applyRealtimeRow(row) {
  if (!row || row.user_id !== ownerId) return;
  const key = mapKey(row.record_type,row.record_id);
  if (getQueue().some(op => mapKey(op.type,op.id) === key)) {
    document.dispatchEvent(new CustomEvent('factory-db-conflict',{detail:{message:'سجل عليه تعديل محلي معلق وتعديل أحدث من جهاز آخر.'}}));
    return;
  }
  const old = baseline.get(key);
  if (old) {
    const localPayload = old.payload;
    const current = getState();
    const list = current[row.record_type];
    if (Array.isArray(list)) {
      const index = list.findIndex((item,i) => recordKey(row.record_type,item,i) === row.record_id);
      if (index >= 0 && stable(cleanPayload(list[index])) !== stable(localPayload)) {
        document.dispatchEvent(new CustomEvent('factory-db-conflict',{detail:{message:'يوجد تعديل محلي متزامن مع تعديل من جهاز آخر.'}}));
        return;
      }
    }
  }
  setBaselineRow(row);
  persistBaseline();
  if (row.updated_at) setLastSyncAt(row.updated_at);
  applyingRemote = true;
  try {
    const current = getState();
    if (row.record_type === '__meta') {
      if (!row.deleted_at) window.__factoryReplaceArrays?.({__meta:row.payload});
    } else {
      const list = Array.isArray(current[row.record_type]) ? [...current[row.record_type]] : [];
      const index = list.findIndex((item,i) => recordKey(row.record_type,item,i) === row.record_id);
      if (row.deleted_at) { if (index >= 0) list.splice(index,1); }
      else if (index >= 0) { list[index] = clone(row.payload); if (list[index] && typeof list[index] === 'object') list[index]._cloudRecordId = row.record_id; }
      else { const item = clone(row.payload); if (item && typeof item === 'object') item._cloudRecordId = row.record_id; list.push(item); }
      window.__factoryReplaceArrays?.({[row.record_type]:list});
    }
  } finally { applyingRemote = false; }
}
async function connectRealtime() {
  if (channel) await supabase.removeChannel(channel);
  channel = supabase.channel('factory-records-' + ownerId)
    .on('postgres_changes',{event:'*',schema:'public',table:'factory_records',filter:'user_id=eq.'+ownerId},payload=>{
      if (payload.eventType === 'DELETE') return;
      applyRealtimeRow(payload.new);
    }).subscribe();
}
async function currentSessionUser() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session?.user) throw error || new Error('لا يوجد مستخدم مسجل');
  return data.session.user;
}
async function ensureProfile(userId, refresh = false) {
  if (!refresh && window.__factoryAuthProfile?.id === userId) {
    profile = window.__factoryAuthProfile;
    return profile;
  }
  const { data, error } = await withRequestTimeout(supabase.from('profiles')
    .select('id,created_by,is_admin,permissions,must_change_password,username,full_name')
    .eq('id', userId).maybeSingle());
  if (error) throw error;
  if (!data) throw new Error('لم يتم العثور على ملف صلاحيات الحساب');
  profile = data;
  window.__factoryAuthProfile = data;
  return profile;
}
async function bootstrap() {
  if (window.__factoryAuthPromise) await window.__factoryAuthPromise;
  if (window.__factoryAuthReady !== true || !window.__factoryAuthProfile) throw new Error('لم يكتمل التحقق المباشر من حساب المستخدم.');
  if (!supabase || !navigator.onLine || window.__factoryOfflineMode === true) {
    profile = window.__factoryAuthProfile || null;
    if (!profile || window.__factoryOfflineMode !== true) throw new Error('يلزم اتصال مباشر بقاعدة بيانات الإنتاج لتوثيق الحساب.');
    actorId = profile?.id || null;
    ownerId = profile?.created_by || profile?.id || null;
    storageScope = ownerId || 'anonymous';
    clearLegacyDeviceData();
    resetLocalBusinessState();
    const cachedRows = loadCachedRows();
    const managerRows = profile?.is_admin===true ? loadManagerCache(actorId) : [];
    if(managerRows.length)window.__factoryManagerBridgeLoaded=true;
    if (cachedRows.length || managerRows.length) hydrateFromRows([...managerRows,...cachedRows]);
    else snapshotBaseline(getState());
    const conflictRecoveryPending = conflictRecovery().hasBlock();
    const pendingQueue = getQueue();
    if (conflictWriteLock || conflictRecoveryPending || pendingQueue.length) {
      conflictWriteLock = true;
      window.__factoryDatabaseFirstFailed = true;
      const message = conflictRecoveryPending
        ? 'توجد عمليات محفوظة للمراجعة بعد تعارض سابق. الحفظ وإعادة الإرسال متوقفان.'
        : 'توجد عمليات غير مؤكدة محفوظة على هذا الجهاز. أوقفنا إرسالها تلقائيًا؛ صدّرها للمراجعة قبل المتابعة.';
      document.dispatchEvent(new CustomEvent('factory-db-conflict',{detail:{message}}));
    } else {
      for (const op of pendingQueue) applyOperationToState(op);
    }
    stateReady = true;
    window.__factoryDatabaseFirstReady = true;
    if (!conflictWriteLock) window.__factoryDatabaseFirstFailed = false;
    window.dispatchEvent(new CustomEvent('factory-database-ready'));
    return;
  }
  const user = await retryStartup(() => currentSessionUser());
  actorId = user.id;
  await retryStartup(() => ensureProfile(actorId, false));
  ownerId = profile.created_by || profile.id;
  storageScope = ownerId;
  resetLocalBusinessState();
  const rows = await retryStartup(() => fetchAllRecords());
  // Legacy Manager.io records remain the immutable base; factory_records overlays edits and tombstones.
  const managerRows = await getManagerBridgeRows();
  hydrateFromRows([...managerRows,...rows]);
  clearLegacyDeviceData();
  try { archiveLegacyQueues(); } catch (archiveError) { conflictWriteLock = true; window.__factoryDatabaseFirstFailed = true; console.error('Legacy operations remain local and are blocked from replay:', archiveError); }
  setLastSyncAt(new Date().toISOString());
  stateReady = true;
  window.__factoryDatabaseFirstReady = true;
  const conflictRecoveryPending = conflictRecovery().hasBlock();
  const pendingQueue = getQueue();
  if (conflictWriteLock || conflictRecoveryPending || pendingQueue.length) {
    // A pending queue is never replayed on startup, even if storage could not persist the marker.
    conflictWriteLock = true;
    window.__factoryDatabaseFirstFailed = true;
    const message = conflictRecoveryPending
      ? 'توجد عمليات محفوظة للمراجعة بعد تعارض سابق. لم نعد إرسالها تلقائيًا.'
      : 'توجد عمليات غير مؤكدة من جلسة سابقة. لم نعد إرسالها تلقائيًا؛ صدّرها للمراجعة قبل المتابعة.';
    document.dispatchEvent(new CustomEvent('factory-db-conflict',{detail:{message}}));
    await connectRealtime();
    window.dispatchEvent(new CustomEvent('factory-database-ready'));
    return;
  }
  window.__factoryDatabaseFirstFailed = false;
  await flushQueue();
  await connectRealtime();
  window.dispatchEvent(new CustomEvent('factory-database-ready'));
}
window.__factoryPersistState = persistState;
window.__factoryDatabaseSyncNow = async () => { await flushQueue(); await persistState(getState()); };
async function reconnectDatabase() {
  if (conflictWriteLock || conflictRecovery().hasBlock() || getQueue().length) {
    conflictWriteLock = true;
    window.__factoryDatabaseFirstFailed = true;
    throw new Error('إعادة الاتصال لا ترفع قفل الحفظ مع وجود عمليات غير مؤكدة. صدّرها وراجعها أولاً.');
  }
  const user = await retryStartup(() => currentSessionUser());
  actorId = user.id;
  await retryStartup(() => ensureProfile(actorId, true));
  ownerId = profile.created_by || profile.id;
  storageScope = ownerId;
  const since = getLastSyncAt();
  if (since) {
    const changed = await retryStartup(() => fetchChangedRecords(since));
    for (const row of changed) applyRealtimeRow(row);
  } else {
    const initialRows = await retryStartup(() => fetchAllRecords());
    const managerRows = await getManagerBridgeRows();
    hydrateFromRows([...managerRows,...initialRows]);
    setLastSyncAt(new Date().toISOString());
  }
  for (const op of getQueue()) applyOperationToState(op);
  await flushQueue();
  await connectRealtime();
  window.__factoryOfflineMode = false;
  window.__factoryDatabaseFirstReady = true;
  window.__factoryDatabaseFirstFailed = Boolean(conflictWriteLock);
  window.dispatchEvent(new CustomEvent('factory-database-ready'));
}
window.addEventListener('online', async () => {
  if (!stateReady) return;
  if (conflictWriteLock || conflictRecovery().hasBlock() || getQueue().length) {
    conflictWriteLock = true;
    window.__factoryDatabaseFirstFailed = true;
    updateConflictExportButton();
    window.dispatchEvent(new Event('factory-db-connection-state'));
    return;
  }
  window.__factoryDatabaseFirstFailed = true;
  window.dispatchEvent(new Event('factory-db-connection-state'));
  try { await saveChain.catch(()=>{}); await reconnectDatabase(); }
  catch (error) {
    window.__factoryDatabaseFirstFailed = true;
    console.error('Database reconnect:',error);
    window.dispatchEvent(new Event('factory-db-connection-state'));
  }
});
let conflictExportedInSession = false;
function updateConflictExportButton() {
  try {
    const recovery = conflictRecovery();
    const archives = recovery.readArchives();
    const queue = getQueue();
    let button = document.getElementById('factory-conflict-export');
    if (!button) {
      button = document.createElement('button');
      button.id = 'factory-conflict-export';
      button.type = 'button';
      button.style.cssText = 'position:fixed;z-index:100000;left:16px;bottom:16px;padding:11px 16px;border:0;border-radius:9px;background:#7c2d12;color:#fff;font:600 14px Arial;box-shadow:0 3px 14px #0003;cursor:pointer';
      button.addEventListener('click', () => {
        try {
          const currentRecovery = conflictRecovery();
          const payload = currentRecovery.getExportPayload(getQueue(), { accountId:ownerId });
          const blob = new Blob([JSON.stringify(payload,null,2)], {type:'application/json;charset=utf-8'});
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          const stamp = new Date().toISOString().replace(/[:.]/g,'-');
          const unique = globalThis.crypto?.randomUUID?.() || String(Date.now());
          link.href = url;
          link.download = 'ms-factory-conflict-review-' + stamp + '-' + unique + '.json';
          document.body.appendChild(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url),1000);
          conflictExportedInSession = true;
          updateConflictExportButton();
        } catch (error) { alert('تعذر تصدير العمليات المحفوظة: ' + (error.message || error)); }
      });
      document.body.appendChild(button);
    }
    let resolveButton = document.getElementById('factory-conflict-resolve');
    if (!resolveButton) {
      resolveButton = document.createElement('button');
      resolveButton.id = 'factory-conflict-resolve';
      resolveButton.type = 'button';
      resolveButton.style.cssText = 'position:fixed;z-index:100000;left:16px;bottom:66px;padding:11px 16px;border:0;border-radius:9px;background:#475569;color:#fff;font:600 14px Arial;box-shadow:0 3px 14px #0003;cursor:pointer';
      resolveButton.textContent = 'متابعة بعد تصدير العمليات';
      resolveButton.addEventListener('click', () => {
        if (!conflictExportedInSession) {
          alert('صدّر العمليات أولاً، ثم أكد تنزيل الملف للمتابعة.');
          return;
        }
        if (!confirm('هل نزّلت ملف العمليات؟ ستُحذف العمليات المعلقة من هذا الجهاز بعد حفظ الملف، ثم يعاد تحميل البيانات المؤكدة من قاعدة البيانات.')) return;
        try {
          localStorage.removeItem(scopedKey(QUEUE_KEY));
          localStorage.removeItem('mgr6');
          localStorage.removeItem('mgr6-sync-pending');
          const currentRecovery = conflictRecovery();
          currentRecovery.clearBlock();
          if (getQueue().length || currentRecovery.hasBlock()) {
            throw new Error('تعذر رفع قفل الحماية أو تفريغ الطابور؛ لم نفتح الحفظ.');
          }
          window.location.reload();
        } catch (error) {
          alert('تعذر المتابعة بأمان: ' + (error.message || error));
          updateConflictExportButton();
        }
      });
      document.body.appendChild(resolveButton);
    }
    const count = archives.reduce((sum,item)=>sum+Number(item.rejectedOperationCount||0),0) + queue.length;
    const needsReview = Boolean(queue.length || recovery.hasBlock() || conflictWriteLock);
    button.hidden = !(archives.length || needsReview);
    button.textContent = 'تصدير العمليات المحفوظة (' + count + ')';
    resolveButton.hidden = !needsReview;
    resolveButton.disabled = !conflictExportedInSession;
  } catch (error) { console.warn('Could not refresh conflict export control:',error); }
}
window.addEventListener('factory-db-conflict', event => {
  console.warn('Factory database conflict:',event.detail?.message || event.detail);
  updateConflictExportButton();
});
updateConflictExportButton();
window.addEventListener('factory-database-ready', updateConflictExportButton);
bootstrap().catch(error => {
  window.__factoryDatabaseFirstFailed = true;
  console.error('Database-first startup failed:',error);
  window.dispatchEvent(new CustomEvent('factory-db-startup-error',{detail:{message:error.message || String(error)}}));
});
