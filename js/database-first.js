import { supabase } from './supabase.js';
import { createConflictRecovery } from './conflict-recovery.js';
import { retryStartup } from './startup-retry.mjs';

// PostgREST's default maximum response size is 1,000 rows. Fetching that
// maximum halves round trips without changing the authoritative full-state load.
const PAGE_SIZE = 1000;
let ownerId = null;
let actorId = null;
let profile = null;
let baseline = new Map();
let stateReady = false;
let saveChain = Promise.resolve();
let channel = null;
let auditChannel = null;
let auditRealtimeEnabled = false;
let applyingRemote = false;
let lastConfirmedState = null;
let conflictWriteLock = false;
let storageScope = 'anonymous';
const pendingWriteKeys = new Set();
const conflictRecovery = () => createConflictRecovery({ scope: storageScope });
function startupMark(name){try{performance.mark('factory:'+name)}catch(_){}}
function startupMeasure(name,start,end){try{performance.measure('factory:'+name,'factory:'+start,'factory:'+end)}catch(_){}}
function publishStartupMetrics(){try{const entries=performance.getEntriesByType('measure'),resource=performance.getEntriesByType('resource');const duration=name=>entries.find(e=>e.name==='factory:'+name)?.duration??null;const dbRequests=resource.filter(e=>/\/rest\/v1\/factory_records(?:\?|$)/.test(e.name));window.__factoryStartupMetrics={authSessionMs:duration('auth-session'),authProfileMs:duration('auth-profile'),databaseRecordsMs:duration('database-records'),databaseStartupMs:duration('database-startup'),factoryRecordRequests:dbRequests.length,factoryRecordTransferBytes:dbRequests.reduce((sum,e)=>sum+(e.transferSize||0),0)};}catch(_){}}

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
    ? (item._cloudRecordId ?? item.id ?? item.entryId ?? item.no ?? item.code ?? item.sku ?? item.external_id)
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
const mapKey = (type, id) => type + '\u0000' + id;
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
function rememberConfirmedState() {
  const { arrays, meta } = splitState(getState());
  lastConfirmedState = clone({ arrays, meta });
}
window.__factoryRestoreConfirmedState = () => {
  if (!lastConfirmedState) return;
  const patch = { ...clone(lastConfirmedState.arrays), __meta: clone(lastConfirmedState.meta) };
  window.__factoryReplaceArrays?.(patch);
};
function legacyDeviceEntries() {
  const entries = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || key === 'mgr6pref' || key.startsWith('mgr6pref::')) continue;
      if (/^(?:mgr6(?:-|:|$)|ms-factory-db-(?:queue|baseline|last-sync|cache|conflict-temp)-v1(?::|$))/.test(key)) {
        entries.push({ key, value: localStorage.getItem(key) });
      }
    }
  } catch (error) { console.warn('Could not inspect legacy device records:', error); }
  return entries;
}
function downloadReviewFile(payload, prefix) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  link.href = url;
  link.download = prefix + '-' + stamp + '-' + (globalThis.crypto?.randomUUID?.() || Date.now()) + '.json';
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function updateRecoveryControls() {
  try {
    const recovery = conflictRecovery();
    const legacy = legacyDeviceEntries();
    const archives = recovery.readArchives();
    const needsReview = Boolean(legacy.length || archives.length || recovery.hasBlock() || conflictWriteLock || window.__factoryLastRejectedOperations?.length);
    let exportButton = document.getElementById('factory-conflict-export');
    if (!needsReview) { exportButton?.remove(); document.getElementById('factory-conflict-resolve')?.remove(); return; }
    if (!exportButton) {
      exportButton = document.createElement('button');
      exportButton.id = 'factory-conflict-export'; exportButton.type = 'button';
      exportButton.style.cssText = 'position:fixed;z-index:100000;left:12px;bottom:12px;padding:10px 14px;border:0;border-radius:9px;background:#7c2d12;color:#fff;font:600 13px Arial;box-shadow:0 3px 14px #0003;cursor:pointer;max-width:calc(100vw - 24px)';
      exportButton.addEventListener('click', () => {
        try {
          downloadReviewFile({
            format: 'ms-factory-device-review-v1', exportedAt: new Date().toISOString(), accountId: ownerId,
            archives: conflictRecovery().readArchives(), rejectedOperations: window.__factoryLastRejectedOperations || [],
            legacyDeviceEntries: legacyDeviceEntries(), writesBlocked: Boolean(conflictWriteLock || conflictRecovery().hasBlock())
          }, 'ms-factory-device-review');
          exportButton.dataset.exported = 'true';
          updateRecoveryControls();
        } catch (error) { alert('تعذر تصدير البيانات القديمة للمراجعة: ' + (error.message || error)); }
      });
      document.body.appendChild(exportButton);
    }
    const legacyCount = legacy.length + (window.__factoryLastRejectedOperations?.length || 0) + archives.reduce((sum, item) => sum + Number(item.rejectedOperationCount || 0), 0);
    exportButton.textContent = 'تصدير بيانات الجهاز للمراجعة (' + legacyCount + ')';
    exportButton.hidden = false;
    let continueButton = document.getElementById('factory-conflict-resolve');
    if (conflictWriteLock || recovery.hasBlock()) {
      if (!continueButton) {
        continueButton = document.createElement('button');
        continueButton.id = 'factory-conflict-resolve'; continueButton.type = 'button';
        continueButton.style.cssText = 'position:fixed;z-index:100000;left:12px;bottom:60px;padding:10px 14px;border:0;border-radius:9px;background:#475569;color:#fff;font:600 13px Arial;box-shadow:0 3px 14px #0003;cursor:pointer';
        continueButton.textContent = 'متابعة بعد التصدير';
        continueButton.addEventListener('click', () => {
          if (exportButton.dataset.exported !== 'true') { alert('صدّر البيانات أولاً للاحتفاظ بنسخة منها.'); return; }
          if (!confirm('تم تنزيل نسخة المراجعة؟ ستبقى البيانات القديمة محفوظة على الجهاز لكنها لن تُرسل. سيتم فتح الحفظ المباشر من قاعدة البيانات.')) return;
          conflictRecovery().clearBlock();
          location.reload();
        });
        document.body.appendChild(continueButton);
      }
      continueButton.hidden = false;
    } else if (continueButton) continueButton.hidden = true;
  } catch (error) { console.warn('Could not update the device-data review control:', error); }
}
function archiveLegacyQueues() {
  const prefix = 'ms-factory-db-queue-v1';
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key === prefix || key === prefix + ':' + storageScope) keys.push(key);
  }
  for (const key of keys) {
    const raw = localStorage.getItem(key);
    let operations;
    try { operations = JSON.parse(raw || '[]'); }
    catch (_) {
      conflictRecovery().persistBlock({ ownerId, reason: 'طابور قديم غير قابل للقراءة؛ لم يتم حذفه أو إرساله.' });
      throw new Error('توجد قائمة عمليات قديمة تالفة. تم الاحتفاظ بها ومنع إرسالها. صدّر بيانات الجهاز للمراجعة.');
    }
    if (!Array.isArray(operations)) {
      conflictRecovery().persistBlock({ ownerId, reason: 'صيغة الطابور القديم غير معروفة؛ لم يتم حذفه أو إرساله.' });
      throw new Error('توجد قائمة عمليات قديمة بصيغة غير معروفة. تم الاحتفاظ بها ومنع إرسالها.');
    }
    if (!operations.length) continue;
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
    patch[type] = [];
  }
  window.__factoryReplaceArrays?.(patch);
}
function snapshotBaseline(state) {
  baseline = new Map();
  const { arrays, meta } = splitState(state);
  for (const [type,items] of Object.entries(arrays)) items.forEach((item,index)=>{
    const id=recordKey(type,item,index);baseline.set(mapKey(type,id),{type,id,payload:cleanPayload(item),version:0,deleted_at:null});
  });
  baseline.set(mapKey('__meta','main'),{type:'__meta',id:'main',payload:meta,version:0,deleted_at:null});
}
function setBaselineRow(row) {
  baseline.set(mapKey(row.record_type, row.record_id), {
    type: row.record_type, id: row.record_id, payload: clone(row.payload),
    version: Number(row.version || 1), deleted_at: row.deleted_at || null
  });
}
async function fetchAllRecords() {
  // The owner is already constrained by the query. Audit timestamps and actor IDs
  // are not used while hydrating the business state, so do not serialize them on
  // every startup page.
  const columns = 'record_type,record_id,payload,version,deleted_at';
  const { count, error: countError } = await withRequestTimeout(supabase.from('factory_records')
    .select('record_type,record_id', { count: 'exact', head: true }).eq('user_id', ownerId));
  if (countError) throw countError;
  const total = Number(count || 0);
  if (!total) return [];

  const starts = Array.from({ length: Math.ceil(total / PAGE_SIZE) }, (_, page) => page * PAGE_SIZE);
  const all = [];
  // A few independent indexed pages complete faster than serial round trips,
  // while keeping request concurrency modest for Supabase/PostgREST.
  for (let page = 0; page < starts.length; page += 4) {
    const batch = await Promise.all(starts.slice(page, page + 4).map(async from => {
      const { data, error } = await withRequestTimeout(supabase.from('factory_records').select(columns)
        .eq('user_id', ownerId).order('record_type').order('record_id')
        .range(from, from + PAGE_SIZE - 1));
      if (error) throw error;
      return data || [];
    }));
    all.push(...batch.flat());
  }

  const unique = new Set(all.map(row => row.record_type + '\u0000' + row.record_id));
  // An insert or delete during offset pagination can shift a page boundary.
  // Retry sequentially rather than booting with a duplicate or missing record.
  if (all.length === total && unique.size === all.length) return all;
  const stable = [];
  for (let from = 0; from < total;) {
    const { data, error } = await withRequestTimeout(supabase.from('factory_records').select(columns)
      .eq('user_id', ownerId).order('record_type').order('record_id')
      .range(from, from + PAGE_SIZE - 1));
    if (error) throw error;
    if (!data?.length) break;
    stable.push(...data);
    // Advance by the number actually returned. This also handles projects
    // whose PostgREST max_rows is configured below the default page size.
    from += data.length;
  }
  const stableUnique = new Set(stable.map(row => row.record_type + '\u0000' + row.record_id));
  if (stable.length !== total || stableUnique.size !== stable.length) throw new Error('تغيرت سجلات قاعدة البيانات أثناء التحميل. أعد المحاولة حتى لا تُعرض نسخة غير مكتملة.');
  return stable;
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
  const { arrays: localArrays } = splitState(local);
  const patch = {};
  for (const [type, items] of Object.entries(localArrays)) {
    patch[type] = grouped[type] || [];
  }
  for (const [type, items] of Object.entries(grouped)) {
    if (!Object.prototype.hasOwnProperty.call(patch, type)) patch[type] = items;
  }
  if (metaRow?.payload && typeof metaRow.payload === 'object') patch.__meta = metaRow.payload;
  window.__factoryReplaceArrays?.(patch);
  const current = getState();
  const { arrays, meta } = splitState(current);
  // Only rows received from Supabase are used as the current business state.
  for (const [type, items] of Object.entries(arrays)) {
    items.forEach((item, index) => {
      const id = recordKey(type, item, index), key = mapKey(type,id);
      if (!baseline.has(key)) baseline.set(key, { type, id, payload: cleanPayload(item), version: 0, deleted_at: null });
    });
  }
  if (!baseline.has(mapKey('__meta','main'))) baseline.set(mapKey('__meta','main'), { type:'__meta', id:'main', payload:meta, version:0, deleted_at:null });
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
  const keys = operations.map(op => mapKey(op.type, op.id));
  keys.forEach(key => pendingWriteKeys.add(key));
  const records = operations.map(op => ({
    user_id: ownerId,
    record_type: op.type,
    record_id: op.id,
    payload: op.deleted ? {} : op.payload,
    expected_version: Number(op.expectedVersion || 0),
    deleted_at: op.deleted ? new Date().toISOString() : null
  }));
  try {
    const { data, error } = await supabase.rpc('apply_factory_record_batch', { p_records: records });
    if (error) {
      if (error.code === '40001' || String(error.message || '').includes('FACTORY_RECORD_CONFLICT')) {
        const conflict = new Error('تعارض نسخة البيانات. أوقفنا الحفظ في هذه الجلسة لحماية السجل. أعد تحميل الصفحة ثم راجع آخر تعديل قبل المحاولة مجدداً.');
        conflict.code = 'FACTORY_RECORD_CONFLICT';
        conflict.rejectedOperations = clone(operations);
        throw conflict;
      }
      throw error;
    }
    for (const row of data || []) setBaselineRow(row);
    rememberConfirmedState();
    return (data || []).map(row => row.updated_at).filter(Boolean).sort().pop() || null;
  } finally {
    keys.forEach(key => pendingWriteKeys.delete(key));
  }
}
async function persistState(state) {
  if (!stateReady || applyingRemote) return;
  if (!navigator.onLine || window.__factoryOfflineMode === true || window.__factoryDatabaseFirstFailed || conflictWriteLock || conflictRecovery().hasBlock()) throw new Error('الحفظ موقوف لحماية البيانات. تحقق من الاتصال وأعد تحميل الصفحة قبل المتابعة.');
  if (!makeOperations(state).length) return;
  saveChain = saveChain.catch(()=>{}).then(async()=>{
    // Writes queued before a conflict must not be replayed with their stale versions.
    if (conflictWriteLock || conflictRecovery().hasBlock() || window.__factoryDatabaseFirstFailed) throw new Error('الحفظ موقوف لحماية البيانات. أعد تحميل الصفحة قبل المتابعة.');
    try {
      const updatedAt=await writeOperations(makeOperations(getState()));
      document.dispatchEvent(new CustomEvent('factory-db-save-confirmed',{detail:{updatedAt}}));
    } catch(error) {
      const isConflict = error?.code === 'FACTORY_RECORD_CONFLICT' || String(error?.message || '').includes('FACTORY_RECORD_CONFLICT');
      if (isConflict) {
        // Keep this tab write-locked even when the authoritative reload succeeds.
        // A page reload starts a clean session and prevents an automatic conflict loop.
        conflictWriteLock = true;
        window.__factoryDatabaseFirstFailed = true;
        window.__factoryLastRejectedOperations = clone(error?.rejectedOperations || makeOperations(getState()));
        try {
          const rejected = window.__factoryLastRejectedOperations;
          const queueKey = 'ms-factory-db-conflict-temp-v1:' + storageScope + ':' + Date.now();
          localStorage.setItem(queueKey, JSON.stringify(rejected));
          conflictRecovery().archiveRejectedQueue(rejected, {
            capturedAt: new Date().toISOString(), ownerId, actorId,
            reason: 'FACTORY_RECORD_CONFLICT: the atomic database batch rejected this operation; it was not resent.'
          }, queueKey);
          window.__factoryLastRejectedOperations = [];
        } catch (archiveError) {
          try { conflictRecovery().persistBlock({ ownerId, actorId, reason: 'تعذر أرشفة العملية المرفوضة؛ تم إيقاف الكتابة لحمايتها.' }); } catch (_) {}
          console.error('Rejected operation was not archived; writes remain blocked for review:', archiveError);
        }
        window.__factoryRestoreConfirmedState?.();
        try { await reloadFromDatabase({ keepWritesBlocked:true }); }
        catch (reloadError) { console.error('Could not restore last confirmed database state after conflict:',reloadError); }
        window.__factoryDatabaseFirstFailed = true;
        document.dispatchEvent(new CustomEvent('factory-db-save-failed',{detail:{message:error.message || String(error),conflict:true}}));
        updateRecoveryControls();
        throw error;
      }
      const rejectedInvoice = String(error?.message || error || '').match(/FACTORY_INVOICE_HAS_RETURNS:([^\s]+)/);
      if (rejectedInvoice) {
        try { await logRejectedOperation('docs', rejectedInvoice[1], 'رفض PostgreSQL تعديل الفاتورة الأصلية لوجود مرتجع مرتبط بها.'); }
        catch (auditError) { console.error('Could not record rejected invoice edit:', auditError); }
      }
      window.__factoryRestoreConfirmedState?.();
      try { await reloadFromDatabase(); } catch(reloadError) { console.error('Could not restore last confirmed database state:',reloadError); }
      document.dispatchEvent(new CustomEvent('factory-db-save-failed',{detail:{message:error.message||String(error)}}));
      throw error;
    }
  });
  return saveChain;
}
async function reloadFromDatabase({ keepWritesBlocked = conflictWriteLock } = {}) {
  window.__factoryDatabaseFirstFailed = true;
  try {
    if(!navigator.onLine) throw new Error('الاتصال مطلوب لإعادة تحميل البيانات المؤكدة');
    const rows=await retryStartup(() => fetchAllRecords());applyingRemote=true;
    try { baseline.clear();hydrateFromRows(rows); } finally { applyingRemote=false; }
    rememberConfirmedState();
    window.__factoryDatabaseFirstFailed = Boolean(keepWritesBlocked || conflictWriteLock);
  } catch (error) {
    // Never permit another write with stale versions if authoritative recovery failed.
    window.__factoryDatabaseFirstFailed = true;
    throw error;
  }
}
function applyRealtimeRow(row) {
  if (!row || row.user_id !== ownerId) return;
  const key = mapKey(row.record_type,row.record_id);
  if (pendingWriteKeys.has(key)) return;
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
  rememberConfirmedState();
}
async function connectAuditRealtime() {
  if (!auditRealtimeEnabled || !ownerId) return;
  if (auditChannel) await supabase.removeChannel(auditChannel);
  auditChannel = supabase.channel('factory-audit-' + ownerId)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'factory_audit_log',filter:'user_id=eq.'+ownerId},payload=>{
      if (payload.new) window.dispatchEvent(new CustomEvent('factory-audit-new',{detail:payload.new}));
    }).subscribe();
}
async function connectRealtime() {
  if (channel) await supabase.removeChannel(channel);
  channel = supabase.channel('factory-records-' + ownerId)
    .on('postgres_changes',{event:'*',schema:'public',table:'factory_records',filter:'user_id=eq.'+ownerId},payload=>{
      if (payload.eventType === 'DELETE') return;
      applyRealtimeRow(payload.new);
    }).subscribe();
  await connectAuditRealtime();
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
  startupMark('database-startup');
  if (!supabase || !navigator.onLine || window.__factoryOfflineMode === true) throw new Error('يلزم الاتصال بالإنترنت بقاعدة البيانات لفتح البرنامج. أعد المحاولة بعد عودة الاتصال.');
  const user = await retryStartup(() => currentSessionUser());
  startupMark('database-session-ready');
  startupMeasure('database-session','database-startup','database-session-ready');
  actorId = user.id;
  await retryStartup(() => ensureProfile(actorId, false));
  startupMark('database-profile-ready');
  startupMeasure('database-profile','database-session-ready','database-profile-ready');
  ownerId = profile.created_by || profile.id;
  storageScope = ownerId;
  resetLocalBusinessState();
  startupMark('database-records-start');
  const rows = await retryStartup(() => fetchAllRecords());
  startupMark('database-records-ready');
  startupMeasure('database-records','database-records-start','database-records-ready');
  // Supabase is the only source of business records. An empty database stays empty.
  hydrateFromRows(rows);
  rememberConfirmedState();
  stateReady = true;
  let legacyArchiveFailed = false;
  try { archiveLegacyQueues(); } catch (error) { legacyArchiveFailed = true; console.error('Legacy operations remain local and are blocked from replay:', error); }
  conflictWriteLock = legacyArchiveFailed || conflictRecovery().hasBlock();
  window.__factoryDatabaseFirstReady = true;
  window.__factoryDatabaseFirstFailed = conflictWriteLock;
  await connectRealtime();
  startupMark('database-ready');
  startupMeasure('database-startup','database-startup','database-ready');
  publishStartupMetrics();
  window.dispatchEvent(new CustomEvent('factory-database-ready'));
  updateRecoveryControls();
}
window.__factoryPersistState = persistState;
window.__factoryDatabaseSyncNow = async () => { await reloadFromDatabase(); };
window.__factoryReloadFromDatabase = reloadFromDatabase;
window.__factoryLoadAuditLog = async () => {
  if (!ownerId || !navigator.onLine) throw new Error('يلزم الاتصال بقاعدة البيانات لعرض سجل التعديلات');
  const { data, error } = await supabase.from('factory_audit_log')
    .select('id,actor_id,record_type,record_id,operation,old_payload,new_payload,old_version,new_version,old_deleted_at,new_deleted_at,occurred_at')
    .eq('user_id', ownerId).order('occurred_at', { ascending: false }).limit(500);
  if (error) throw error;
  auditRealtimeEnabled = true;
  await connectAuditRealtime();
  return data || [];
};
async function logRejectedOperation(recordType, recordId, reason) {
  if (!ownerId || !navigator.onLine) throw new Error('يلزم الاتصال لتسجيل العملية المرفوضة');
  const { data, error } = await supabase.rpc('log_factory_rejected_operation', {
    p_record_type: String(recordType || ''),
    p_record_id: String(recordId || ''),
    p_reason: String(reason || '').slice(0, 500)
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (row) window.dispatchEvent(new CustomEvent('factory-audit-new', { detail:row }));
  return row;
}
window.__factoryLogRejectedOperation = logRejectedOperation;
async function reconnectDatabase() {
  const user = await retryStartup(() => currentSessionUser());
  actorId = user.id;
  await retryStartup(() => ensureProfile(actorId, true));
  ownerId = profile.created_by || profile.id;
  storageScope = ownerId;
  await reloadFromDatabase();
  try { archiveLegacyQueues(); } catch (error) { conflictWriteLock = true; console.error('Legacy operations remain local and are blocked from replay:', error); }
  await connectRealtime();
  window.__factoryOfflineMode = false;
  window.__factoryDatabaseFirstReady = true;
  window.__factoryDatabaseFirstFailed = Boolean(conflictWriteLock || conflictRecovery().hasBlock());
  window.dispatchEvent(new CustomEvent('factory-database-ready'));
  updateRecoveryControls();
}
window.addEventListener('online', async () => {
  if (!stateReady) return;
  window.__factoryDatabaseFirstFailed = true;
  window.dispatchEvent(new Event('factory-db-connection-state'));
  try { await saveChain.catch(()=>{}); await reconnectDatabase(); }
  catch (error) {
    window.__factoryDatabaseFirstFailed = true;
    console.error('Database reconnect:',error);
    window.dispatchEvent(new Event('factory-db-connection-state'));
  }
});
window.addEventListener('offline', () => {
  window.__factoryDatabaseFirstFailed = true;
  window.__factoryRestoreConfirmedState?.();
  window.dispatchEvent(new Event('factory-db-connection-state'));
});
window.addEventListener('factory-db-conflict', event => {
  console.warn('Factory database conflict:',event.detail?.message || event.detail);
  updateRecoveryControls();
});
window.addEventListener('factory-database-ready', updateRecoveryControls);
window.addEventListener('storage', updateRecoveryControls);
bootstrap().catch(error => {
  window.__factoryDatabaseFirstFailed = true;
  console.error('Database-first startup failed:',error);
  window.dispatchEvent(new CustomEvent('factory-db-startup-error',{detail:{message:error.message || String(error)}}));
});

