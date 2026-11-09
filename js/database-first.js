import { supabase } from './supabase.js';

const QUEUE_KEY = 'ms-factory-db-queue-v1';
const BASELINE_KEY = 'ms-factory-db-baseline-v1';
const PAGE_SIZE = 500;
let ownerId = null;
let actorId = null;
let profile = null;
let baseline = new Map();
let stateReady = false;
let saveChain = Promise.resolve();
let channel = null;
let applyingRemote = false;

const clone = value => JSON.parse(JSON.stringify(value ?? null));
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
  try { const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); return Array.isArray(q) ? q : []; }
  catch (_) { return []; }
};
const setQueue = q => localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
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
function persistBaseline() {
  try { localStorage.setItem(BASELINE_KEY, JSON.stringify([...baseline.values()])); } catch (e) { console.warn('Could not persist sync baseline',e); }
}
function snapshotBaseline(state) {
  baseline = new Map();
  try {
    const saved = JSON.parse(localStorage.getItem(BASELINE_KEY) || '[]');
    if (Array.isArray(saved) && saved.length) {
      for (const row of saved) baseline.set(mapKey(row.type,row.id),row);
      return;
    }
  } catch (_) {}
  const { arrays, meta } = splitState(state);
  for (const [type, items] of Object.entries(arrays)) {
    items.forEach((item, index) => {
      const id = recordKey(type, item, index);
      baseline.set(mapKey(type, id), { type, id, payload: cleanPayload(item), version: 0, deleted_at: null });
    });
  }
  baseline.set(mapKey('__meta', 'main'), { type: '__meta', id: 'main', payload: meta, version: 0, deleted_at: null });
  persistBaseline();
}
function setBaselineRow(row) {
  baseline.set(mapKey(row.record_type, row.record_id), {
    type: row.record_type, id: row.record_id, payload: clone(row.payload),
    version: Number(row.version || 1), deleted_at: row.deleted_at || null
  });
}
async function fetchAllRecords() {
  const all = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase.from('factory_records')
      .select('user_id,record_type,record_id,payload,version,deleted_at,updated_at,updated_by')
      .eq('user_id', ownerId).order('record_type').order('record_id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}
function hydrateFromRows(rows) {
  const grouped = {};
  const metaRow = rows.find(r => r.record_type === '__meta' && r.record_id === 'main' && !r.deleted_at);
  for (const row of rows) {
    setBaselineRow(row);
    if (row.record_type === '__meta') continue;
    const target = (grouped[row.record_type] ||= []);
    if (!row.deleted_at) {
      const payload = clone(row.payload);
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) payload._cloudRecordId = row.record_id;
      target.push(payload);
    }
  }
  for (const values of Object.values(grouped)) values.sort((a,b) => {
    const ai = Number(a?.id), bi = Number(b?.id);
    return Number.isFinite(ai) && Number.isFinite(bi) ? ai-bi : String(a?.id ?? a?.no ?? '').localeCompare(String(b?.id ?? b?.no ?? ''));
  });
  const local = getState();
  const patch = {};
  for (const [type, items] of Object.entries(grouped)) patch[type] = items;
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
  if (!navigator.onLine || !getQueue().length) return;
  const queue = getQueue();
  await writeOperations(queue);
  for (const op of queue) applyOperationToState(op);
  setQueue([]);
  localStorage.removeItem('mgr6-sync-pending');
}
async function persistState(state) {
  if (!stateReady || applyingRemote) return;
  const ops = makeOperations(state);
  if (!ops.length) return;
  if (!navigator.onLine || window.__factoryOfflineMode === true) {
    queueOperations(ops);
    return;
  }
  saveChain = saveChain.then(async () => {
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
      if (error?.code === 'FACTORY_RECORD_CONFLICT') {
        document.dispatchEvent(new CustomEvent('factory-db-conflict',{detail:{message:error.message}}));
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
async function bootstrap() {
  if (!supabase || !navigator.onLine || window.__factoryOfflineMode === true) {
    snapshotBaseline(getState());
    stateReady = true;
    window.__factoryDatabaseFirstReady = true;
    window.dispatchEvent(new CustomEvent('factory-database-ready'));
    return;
  }
  const {data:{user},error:userError}=await supabase.auth.getUser();
  if (userError || !user) throw userError || new Error('لا يوجد مستخدم مسجل');
  actorId=user.id;
  const {data:profileData,error:profileError}=await supabase.from('profiles')
    .select('id,created_by,is_admin,permissions').eq('id',actorId).maybeSingle();
  if (profileError) throw profileError;
  if (!profileData) throw new Error('لم يتم العثور على ملف صلاحيات الحساب');
  profile=profileData;
  ownerId=profile.created_by || profile.id;
  const rows=await fetchAllRecords();
  hydrateFromRows(rows);
  stateReady=true;
  window.__factoryDatabaseFirstReady = true;
  await flushQueue();
  await connectRealtime();
  window.dispatchEvent(new CustomEvent('factory-database-ready'));
}
window.__factoryPersistState = persistState;
window.__factoryDatabaseSyncNow = async () => { await flushQueue(); await persistState(getState()); };
window.addEventListener('online', async () => {
  if (!stateReady) return;
  try { await bootstrap(); await flushQueue(); }
  catch (error) { console.error('Database reconnect:',error); }
});
window.addEventListener('factory-db-conflict', event => {
  console.warn('Factory database conflict:',event.detail?.message || event.detail);
});
bootstrap().catch(error => {
  console.error('Database-first startup failed:',error);
  document.dispatchEvent(new CustomEvent('factory-db-startup-error',{detail:{message:error.message || String(error)}}));
});
