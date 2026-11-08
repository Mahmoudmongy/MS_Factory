// js/cloud-sync.js - V28 - إصلاح الشاشة البيضا + إخفاء شريط مسجل الدخول صح + تحميل تلقائي آمن
import { supabase } from './supabase.js';

let saveTimer = null;
let lastSyncTime = "";
let lastLang = "";
let lastMode = "";
let myProfile = null;
let ownerIdCache = null;
let syncState = "idle";
let autoLoadRunning = false;
let uploadRunning = false;
const PENDING_SYNC_KEY = 'mgr6-sync-pending';
let retryTimer = null;
let retryCount = 0;


function markPendingSync() {
  try { const state = getCachedState(); localStorage.setItem(PENDING_SYNC_KEY, JSON.stringify({ at: Date.now(), pend: Number(state.pend || 0) })); } catch(e) {}
}
function scheduleAutoSync(delay = 1000) {
  if (!navigator.onLine || localStorage.getItem("mgr6-cloud-snapshot-conflict")) return;
  clearTimeout(retryTimer);
  retryTimer = setTimeout(async () => {
    if (!navigator.onLine) return;
    if (autoLoadRunning || uploadRunning) { scheduleAutoSync(1200); return; }
    await onInternetBack();
    if (localStorage.getItem(PENDING_SYNC_KEY) && !localStorage.getItem("mgr6-cloud-snapshot-conflict")) {
      retryCount = Math.min(retryCount + 1, 5);
      scheduleAutoSync(Math.min(30000, 1500 * Math.pow(2, retryCount)));
    } else retryCount = 0;
  }, delay);
}

function isEN() {
  try {
    const pref = JSON.parse(localStorage.getItem("mgr6pref") || "{}");
    if (pref.lang) return pref.lang === "en";
  } catch(e){}
  return document.documentElement.lang === "en";
}
function T(ar, en) { return isEN() ? en : ar; }
function isMobile() { return window.innerWidth <= 640; }

async function getMyProfile() {
  if (myProfile) return myProfile;
  if (window.__factoryAuthProfile) { myProfile = window.__factoryAuthProfile; return myProfile; }
  if (!supabase) return null;
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return null;
    const { data, error } = await supabase.from('profiles')
      .select('id,created_by,is_admin,permissions,must_change_password,username,full_name')
      .eq('id', user.id).maybeSingle();
    if (error) { console.error('Profile lookup failed:', error); return null; }
    myProfile = data || null;
    window.__factoryAuthProfile = myProfile;
    if (myProfile && typeof window.setFactoryAuthProfile === "function") window.setFactoryAuthProfile(myProfile);
    return myProfile;
  } catch(e) { console.error('Profile lookup failed:', e); return null; }
}
async function getOwnerId() {
  if (ownerIdCache) return ownerIdCache;
  const p = await getMyProfile();
  if (!p) return null;
  ownerIdCache = p.created_by || p.id;
  return ownerIdCache;
}
function isAdmin() { return myProfile?.is_admin === true; }
function getCachedState() { try { return JSON.parse(localStorage.getItem("mgr6") || "{}"); } catch(e){ return {}; } }
function getField(obj, names) {
  if (!obj) return "";
  for (const n of names) if (obj[n] !== undefined && obj[n] !== null && obj[n] !== "") return obj[n];
  return "";
}
function isAccountName(name) {
  if (!name) return true;
  const n = String(name).trim();
  const bad = ["مصروف", "خصوم", "تكلفة", "رأس المال", "راس المال", "المخزون", "الموردون", "تحت التصنيع", "هالك", "عمال", "قطاعة", "إيراد", "ايراد", "أرباح", "خسائر", "ضرائب", "أصول", "خصوم"];
  return bad.some(b => n.includes(b));
}
function isLocalEmpty() {
  try {
    const raw = localStorage.getItem("mgr6");
    if (!raw || raw.length < 10) return true;
    const S = JSON.parse(raw);
    if (!S || typeof S !== "object" || Array.isArray(S)) return true;
    // app.js seeds demo customers/items and an opening journal on first launch.
    // A pristine seed (no sv() counter and no user transactions) is not user data.
    const hasSavedEdits = Number(S.pend || 0) > 0;
    const hasTransactions = ["docs", "po", "vch", "wo"].some(k => Array.isArray(S[k]) && S[k].length > 0)
      || (Array.isArray(S.je) && S.je.some(j => j && j.id))
      || (Array.isArray(S.L) && S.L.length > 4)
      || (Array.isArray(S.mv) && S.mv.length > 3)
      || (Array.isArray(S.emp) && S.emp.length > 0);
    const hasAddedMasterData = (Array.isArray(S.partners) && S.partners.length > 3)
      || (Array.isArray(S.items) && S.items.length > 3)
      || (Array.isArray(S.products) && S.products.length > 0)
      || (Array.isArray(S.prods) && S.prods.length > 0)
      || (Array.isArray(S.customers) && S.customers.length > 0)
      || (Array.isArray(S.suppliers) && S.suppliers.length > 0);
    return !(hasSavedEdits || hasTransactions || hasAddedMasterData);
  } catch(e){ return true; }
}
function mergeByKey(existing, incoming, keyFn) {
  const map = new Map();
  (existing || []).forEach(it => { try { const k = keyFn(it); if (k) map.set(String(k), it); } catch(e){} });
  let added = 0;
  (incoming || []).forEach(it => { try { const k = keyFn(it); if (k && !map.has(String(k))) { map.set(String(k), it); added++; } } catch(e){} });
  return { arr: [...map.values()], added };
}
function mergeCloudProducts(existing, incoming) {
  const rows = Array.isArray(existing) ? existing : [];
  const map = new Map();
  const skuMap = new Map();
  rows.forEach(item => {
    if (!item || typeof item !== "object") return;
    const identity = item.cloudId || item.id;
    if (identity != null) map.set(String(identity), item);
    const sku = String(item.sku || "").trim();
    if (sku) {
      if (!skuMap.has(sku)) skuMap.set(sku, []);
      skuMap.get(sku).push(item);
    }
  });
  let added = 0, linked = 0, conflicts = 0;
  (Array.isArray(incoming) ? incoming : []).forEach(remote => {
    if (!remote || typeof remote !== "object") return;
    const identity = remote.cloudId || remote.id;
    if (identity == null) return;
    const key = String(identity);
    if (map.has(key)) return;
    const sku = String(remote.sku || "").trim();
    const matches = sku ? (skuMap.get(sku) || []) : [];
    if (matches.length === 1) {
      const local = matches[0];
      const sameName = String(local.name || "").trim().toLocaleLowerCase() === String(remote.name || "").trim().toLocaleLowerCase();
      if (sameName && (!local.cloudId || String(local.cloudId) === key)) {
        local.cloudId = key;
        map.set(key, local);
        linked++;
      } else {
        local._cloudConflict = { reason: "product_identity_mismatch", serverCopy: remote };
        conflicts++;
      }
      return;
    }
    if (matches.length > 1) {
      matches.forEach(local => { local._cloudConflict = { reason: "ambiguous_product_sku", serverCopy: remote }; });
      conflicts++;
      return;
    }
    map.set(key, remote);
    rows.push(remote);
    if (sku) {
      if (!skuMap.has(sku)) skuMap.set(sku, []);
      skuMap.get(sku).push(remote);
    }
    added++;
  });
  return { arr: rows, added, linked, conflicts };
}

function mergeCloudPartners(existing, incoming) {
  const rows = Array.isArray(existing) ? existing : [];
  const byIdentity = new Map();
  rows.forEach(local => {
    if (!local || typeof local !== "object") return;
    const identity = local.cloudId || local.id;
    if (identity != null) byIdentity.set(String(identity), local);
  });
  let added = 0, linked = 0, conflicts = 0;
  (Array.isArray(incoming) ? incoming : []).forEach(remote => {
    if (!remote || typeof remote !== "object") return;
    const identity = remote.cloudId || remote.id;
    if (identity == null) return;
    const key = String(identity);
    const remoteIsCustomer = remote.kind === "customer" || remote.c === 1;
    const remoteIsSupplier = remote.kind === "supplier" || remote.s === 1;
    const local = byIdentity.get(key);
    if (local) {
      if (remoteIsCustomer) local.c = 1;
      if (remoteIsSupplier) local.s = 1;
      return;
    }
    const name = String(remote.name || "").trim().toLocaleLowerCase();
    const phone = String(remote.phone || "").trim();
    const matches = rows.filter(item => {
      const sameName = name && String(item.name || "").trim().toLocaleLowerCase() === name;
      const samePhone = phone && String(item.phone || "").trim() === phone;
      return sameName || samePhone;
    });
    if (matches.length === 1) {
      const candidate = matches[0];
      const sameName = String(candidate.name || "").trim().toLocaleLowerCase() === name;
      const samePhone = !phone || !candidate.phone || String(candidate.phone).trim() === phone;
      if (sameName && samePhone && (!candidate.cloudId || String(candidate.cloudId) === key)) {
        candidate.cloudId = key;
        if (remoteIsCustomer) candidate.c = 1;
        if (remoteIsSupplier) candidate.s = 1;
        byIdentity.set(key, candidate);
        linked++;
      } else {
        candidate._cloudConflict = { reason: "partner_identity_mismatch", serverCopy: remote };
        conflicts++;
      }
      return;
    }
    if (matches.length > 1) {
      matches.forEach(candidate => { candidate._cloudConflict = { reason: "ambiguous_partner_identity", serverCopy: remote }; });
      conflicts++;
      return;
    }
    const normalized = { ...remote, id: remote.id ?? key, cloudId: key,
      c: remoteIsCustomer ? 1 : Number(remote.c || 0),
      s: remoteIsSupplier ? 1 : Number(remote.s || 0) };
    rows.push(normalized);
    byIdentity.set(key, normalized);
    added++;
  });
  return { arr: rows, added, linked, conflicts };
}

function mergeCloudInvoices(existing, incoming) {
  const map = new Map();
  (existing || []).forEach(it => { const k = it && (it.id || it.no); if (k) map.set(String(k), it); });
  let added = 0, conflicts = 0;
  (incoming || []).forEach(remote => {
    const k = remote && (remote.id || remote.no);
    if (!k) return;
    const local = map.get(String(k));
    if (!local) { map.set(String(k), remote); added++; return; }
    const localVersion = Number(local._cloudVersion || 0);
    const remoteVersion = Number(remote._cloudVersion || 0);
    if (remoteVersion > localVersion) {
      local._cloudConflict = { serverVersion: remoteVersion, serverUpdatedAt: remote._cloudUpdatedAt || null, serverCopy: remote };
      conflicts++;
    } else if (remoteVersion && localVersion === remoteVersion) {
      delete local._cloudConflict;
    }
  });
  return { arr: [...map.values()], added, conflicts };
}

function mergeCloudRecords(existing, incoming) {
  const map = new Map();
  (Array.isArray(existing) ? existing : []).forEach(item => {
    const key = item && (item.id || item.no);
    if (key !== undefined && key !== null && key !== "") map.set(String(key), item);
  });
  let added = 0, conflicts = 0;
  (Array.isArray(incoming) ? incoming : []).forEach(remote => {
    const key = remote && (remote.id || remote.no);
    if (key === undefined || key === null || key === "") return;
    const local = map.get(String(key));
    if (!local) { map.set(String(key), remote); added++; return; }
    const localTime = Date.parse(local._cloudUpdatedAt || "") || 0;
    const remoteTime = Date.parse(remote._cloudUpdatedAt || "") || 0;
    if (remoteTime > localTime) {
      local._cloudConflict = { serverUpdatedAt: remote._cloudUpdatedAt || null, serverCopy: remote };
      conflicts++;
    } else if (remoteTime && remoteTime === localTime) {
      delete local._cloudConflict;
    }
  });
  return { arr: [...map.values()], added, conflicts };
}


// Build a deterministic, source-scoped view of accounting/inventory effects.
// This is intentionally a pure collector: it does not upload, mutate, or apply balances.
function collectSourceEffects(state) {
  const allowed = new Set(["doc", "po", "vch", "je", "wo"]);
  const groups = new Map();
  const invalid = [];
  const ignored = [];
  const add = (kind, row, index) => {
    if (!row || typeof row !== "object") { invalid.push({ kind, index, reason: "invalid_row" }); return; }
    const sourceType = String(row.src || "");
    const hasSourceId = row.rid !== undefined && row.rid !== null && String(row.rid) !== "";
    // First-launch opening balances predate source IDs and are baseline state, not replayable deltas.
    if (!hasSourceId && (row.desc === "رصيد افتتاحي" || row.ref === "رصيد افتتاحي")) {
      ignored.push({ kind, index, reason: "opening_baseline" }); return;
    }
    if (!allowed.has(sourceType)) { invalid.push({ kind, index, reason: "unsupported_source", sourceType }); return; }
    if (!hasSourceId) { invalid.push({ kind, index, reason: "missing_source_id", sourceType }); return; }
    const sourceId = String(row.rid);
    const key = JSON.stringify([sourceType, sourceId]);
    if (!groups.has(key)) groups.set(key, { sourceType, sourceId, ledger: [], movements: [] });
    groups.get(key)[kind].push(row);
  };
  (Array.isArray(state?.L) ? state.L : []).forEach((row, index) => add("ledger", row, index));
  (Array.isArray(state?.mv) ? state.mv : []).forEach((row, index) => add("movements", row, index));
  const effects = [...groups.values()];
  const stable = value => {
    if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
    if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + stable(value[k])).join(",") + "}";
    return JSON.stringify(value);
  };
  for (const effect of effects) {
    effect.ledger.sort((a, b) => stable(a).localeCompare(stable(b)));
    effect.movements.sort((a, b) => stable(a).localeCompare(stable(b)));
  }
  effects.sort((a, b) => a.sourceType.localeCompare(b.sourceType) || a.sourceId.localeCompare(b.sourceId));
  return { effects, invalid, ignored };
}

// Convert device-local foreign keys into the stable business keys already used by detail sync.
// The function refuses ambiguous/missing references; it never guesses by item or account name.
function normalizeSourceEffects(state) {
  const collected = collectSourceEffects(state);
  const invalid = [...collected.invalid];
  const accountById = new Map();
  const accountCodes = new Map();
  for (const account of Array.isArray(state?.accts) ? state.accts : []) {
    if (!account || account.id == null || account.code == null || String(account.code).trim() === "") continue;
    const id = String(account.id), code = String(account.code).trim();
    if (accountCodes.has(code) && accountCodes.get(code) !== id) {
      invalid.push({ reason: "duplicate_account_code", code });
      continue;
    }
    accountCodes.set(code, id);
    accountById.set(id, {
      code, name: String(account.name || ""), type: String(account.t || "A"),
      key: String(account.k || ""), cash: Number(account.cash || 0),
      currency: String(account.cur || "EGP")
    });
  }
  const itemById = new Map();
  const itemIds = new Set();
  const itemSkuToId = new Map();
  for (const item of Array.isArray(state?.items) ? state.items : []) {
    if (!item || item.id == null) continue;
    const id = String(item.id);
    if (itemIds.has(id)) invalid.push({ reason: "duplicate_item_id", id });
    itemIds.add(id);
    const sku = String(item.sku || "").trim();
    if (sku && itemSkuToId.has(sku) && itemSkuToId.get(sku) !== id) {
      invalid.push({ reason: "duplicate_item_sku", sku });
    } else if (sku) itemSkuToId.set(sku, id);
    const itemInfo = {
      localId: id,
      externalId: String(item.cloudId || id),
      name: String(item.name || ""),
      sku,
      warehouseId: item.wh == null ? null : String(item.wh),
      warehouseName: (state.wh || []).find(w => String(w.id) === String(item.wh))?.name || "",
      unit: String(item.unit || "")
    };
    for (const alias of new Set([id, itemInfo.externalId])) {
      const previous = itemById.get(alias);
      if (previous && previous.localId !== id) {
        invalid.push({ reason: "ambiguous_item_identity_alias", alias });
      } else itemById.set(alias, itemInfo);
    }
  }
  const partnerById = new Map();
  for (const partner of Array.isArray(state?.partners) ? state.partners : []) {
    if (partner?.id != null) {
      const info = { externalId: String(partner.cloudId || partner.id), name: String(partner.name || "") };
      partnerById.set(String(partner.id), info);
      partnerById.set(info.externalId, info);
    }
  }
  const effects = collected.effects.map(effect => {
    const ledger = effect.ledger.map(row => {
      const account = accountById.get(String(row.a));
      if (!account) { invalid.push({ sourceType: effect.sourceType, sourceId: effect.sourceId, reason: "unmapped_account", accountId: String(row.a) }); return null; }
      let partner = null;
      if (row.pid != null && Number(row.pid) !== 0) {
        partner = partnerById.get(String(row.pid));
        if (!partner) { invalid.push({ sourceType: effect.sourceType, sourceId: effect.sourceId, reason: "unmapped_partner", partnerId: String(row.pid) }); return null; }
      }
      return {
        date: row.d || null, timestamp: Number(row.ts || 0), reference: String(row.ref || ""),
        description: String(row.desc || ""), accountCode: account.code, accountName: account.name,
        accountType: account.type, accountKey: account.key, accountIsCash: account.cash,
        accountCurrency: account.currency,
        debit: Number(row.dr || 0), credit: Number(row.cr || 0),
        partnerExternalId: partner?.externalId || null, partnerName: partner?.name || "",
        foreignCurrencyAmount: Number(row.fc || 0)
      };
    }).filter(Boolean);
    const debitTotal = ledger.reduce((sum, row) => sum + row.debit, 0);
    const creditTotal = ledger.reduce((sum, row) => sum + row.credit, 0);
    if (ledger.length && Math.abs(debitTotal - creditTotal) > 0.005) {
      invalid.push({ sourceType: effect.sourceType, sourceId: effect.sourceId, reason: "unbalanced_ledger_effect", debitTotal, creditTotal });
    }
    const movements = effect.movements.map(row => {
      const item = itemById.get(String(row.iid));
      if (!item) { invalid.push({ sourceType: effect.sourceType, sourceId: effect.sourceId, reason: "unmapped_item", itemId: String(row.iid) }); return null; }
      let partner = null;
      if (row.pid != null && Number(row.pid) !== 0) {
        partner = partnerById.get(String(row.pid));
        if (!partner) { invalid.push({ sourceType: effect.sourceType, sourceId: effect.sourceId, reason: "unmapped_movement_partner", partnerId: String(row.pid) }); return null; }
      }
      return {
        date: row.d || null, timestamp: Number(row.ts || 0), itemExternalId: item.externalId,
        itemName: item.name, sku: item.sku, warehouseId: item.warehouseId,
        warehouseName: item.warehouseName, variant: String(row.v || "-"),
        quantity: Number(row.q || 0), value: Number(row.val || 0),
        reference: String(row.ref || ""), partnerExternalId: partner?.externalId || null
      };
    }).filter(Boolean);
    return { sourceType: effect.sourceType, sourceId: effect.sourceId, ledger, movements };
  });
  return { effects, invalid, ignored: collected.ignored };
}


// Pure optimistic-concurrency planner. It never calls Supabase or mutates local state.
function planSourceEffectSync(state, remoteRows, versionMap, tombstones) {
  const normalized = normalizeSourceEffects(state);
  const invalid = [...normalized.invalid];
  const actions = [];
  const conflicts = [];
  const adoptedVersions = {};
  const clearTombstones = [];
  const keyOf = (type, id) => JSON.stringify([String(type), String(id)]);
  const versions = versionMap && typeof versionMap === "object" ? versionMap : {};
  const remote = new Map();
  for (const row of Array.isArray(remoteRows) ? remoteRows : []) {
    if (!row || !row.source_type || row.source_id == null) continue;
    const key = keyOf(row.source_type, row.source_id);
    if (remote.has(key)) conflicts.push({ key, reason: "duplicate_remote_effect" });
    else remote.set(key, row);
  }
  const queued = new Map();
  for (const item of Array.isArray(tombstones) ? tombstones : []) {
    if (!item || !item.sourceType || item.sourceId == null) {
      invalid.push({ reason: "invalid_tombstone" }); continue;
    }
    const key = keyOf(item.sourceType, item.sourceId);
    if (queued.has(key)) continue;
    queued.set(key, item);
  }
  const currentKeys = new Set(normalized.effects.map(e => keyOf(e.sourceType, e.sourceId)));
  for (const key of currentKeys) {
    if (queued.has(key)) conflicts.push({ key, reason: "source_present_and_tombstoned_locally" });
  }
  if (invalid.length) return { actions: [], conflicts, adoptedVersions, clearTombstones, invalid };

  for (const effect of normalized.effects) {
    const key = keyOf(effect.sourceType, effect.sourceId);
    const localVersion = Number(versions[key] || 0);
    const row = remote.get(key);
    if (!row) {
      if (localVersion > 0) conflicts.push({ key, reason: "remote_effect_missing", localVersion });
      else actions.push({ op: "upsert", effect, expectedVersion: 0 });
      continue;
    }
    const remoteVersion = Number(row.sync_version || 0);
    if (!Number.isInteger(remoteVersion) || remoteVersion < 1) {
      conflicts.push({ key, reason: "invalid_remote_version" }); continue;
    }
    if (row.deleted_at) {
      conflicts.push({ key, reason: "remote_effect_deleted", localVersion, remoteVersion }); continue;
    }
    const remotePayload = row.payload || {};
    const ledgerIncluded = remotePayload.ledgerIncluded !== false;
    const movementsIncluded = remotePayload.movementsIncluded !== false;
    const localComparable = {
      sourceType: effect.sourceType, sourceId: effect.sourceId,
      ledger: ledgerIncluded ? effect.ledger : [],
      movements: movementsIncluded ? effect.movements : []
    };
    const remoteComparable = {
      sourceType: effect.sourceType, sourceId: effect.sourceId,
      ledger: ledgerIncluded ? (remotePayload.ledger || []) : [],
      movements: movementsIncluded ? (remotePayload.movements || []) : []
    };
    const samePayload = stableJson(localComparable) === stableJson(remoteComparable);
    if (localVersion === 0) {
      if (samePayload) adoptedVersions[key] = remoteVersion;
      else conflicts.push({ key, reason: "unknown_remote_baseline", remoteVersion });
      continue;
    }
    if (remoteVersion !== localVersion) {
      conflicts.push({ key, reason: "version_mismatch", localVersion, remoteVersion }); continue;
    }
    if (!samePayload) actions.push({ op: "upsert", effect, expectedVersion: localVersion });
  }

  for (const [key, item] of queued) {
    if (currentKeys.has(key)) continue;
    const localVersion = Number(versions[key] || 0);
    const row = remote.get(key);
    if (!row) {
      if (localVersion > 0) conflicts.push({ key, reason: "remote_effect_missing_for_delete", localVersion });
      else actions.push({ op: "delete", sourceType: String(item.sourceType), sourceId: String(item.sourceId), expectedVersion: 0 });
      continue;
    }
    const remoteVersion = Number(row.sync_version || 0);
    if (row.deleted_at) {
      if (remoteVersion > 0) adoptedVersions[key] = remoteVersion;
      clearTombstones.push(key);
    } else if (!localVersion) {
      conflicts.push({ key, reason: "unknown_remote_baseline_for_delete", remoteVersion });
    } else if (remoteVersion !== localVersion) {
      conflicts.push({ key, reason: "version_mismatch_for_delete", localVersion, remoteVersion });
    } else {
      actions.push({ op: "delete", sourceType: String(item.sourceType), sourceId: String(item.sourceId), expectedVersion: localVersion });
    }
  }
  return { actions, conflicts, adoptedVersions, clearTombstones, invalid };
}


// Applies one already-conflict-checked canonical effect to a local cache.
// The caller must first establish that product raw stock is not being double-counted.

// Plans remote downloads without overwriting local edits or resurrecting tombstones.
function planRemoteSourceEffectApply(state, remoteRows, versionMap) {
  const normalized = normalizeSourceEffects(state);
  const invalid = [...normalized.invalid];
  const actions = [];
  const conflicts = [];
  const adoptedVersions = {};
  const keyOf = (type, id) => JSON.stringify([String(type), String(id)]);
  const versions = versionMap && typeof versionMap === "object" ? versionMap : {};
  const local = new Map(normalized.effects.map(effect => [keyOf(effect.sourceType, effect.sourceId), effect]));
  const seen = new Set();
  for (const row of Array.isArray(remoteRows) ? remoteRows : []) {
    if (!row || !["doc", "po", "vch", "je", "wo"].includes(row.source_type) || row.source_id == null) {
      invalid.push({ reason: "invalid_remote_effect_identity" }); continue;
    }
    const key = keyOf(row.source_type, row.source_id);
    if (seen.has(key)) { conflicts.push({ key, reason: "duplicate_remote_effect" }); continue; }
    seen.add(key);
    const remoteVersion = Number(row.sync_version || 0);
    const localVersion = Number(versions[key] || 0);
    if (!Number.isInteger(remoteVersion) || remoteVersion < 1) {
      conflicts.push({ key, reason: "invalid_remote_version" }); continue;
    }
    const localEffect = local.get(key);
    if (row.deleted_at) {
      if (localEffect) conflicts.push({ key, reason: "remote_tombstone_conflicts_with_local_effect", localVersion, remoteVersion });
      else if (localVersion > remoteVersion) conflicts.push({ key, reason: "remote_tombstone_is_stale", localVersion, remoteVersion });
      else adoptedVersions[key] = remoteVersion;
      continue;
    }
    const effect = row.payload;
    if (!effect || effect.sourceType !== row.source_type || String(effect.sourceId) !== String(row.source_id) ||
        !Array.isArray(effect.ledger) || !Array.isArray(effect.movements)) {
      invalid.push({ key, reason: "invalid_remote_effect_payload" }); continue;
    }
    if (!localEffect) {
      if (localVersion > 0) conflicts.push({ key, reason: "local_effect_missing_for_known_version", localVersion, remoteVersion });
      else actions.push({ op: "apply", effect, version: remoteVersion });
      continue;
    }
    const ledgerIncluded = effect.ledgerIncluded !== false;
    const movementsIncluded = effect.movementsIncluded !== false;
    const localComparable = {
      sourceType: localEffect.sourceType, sourceId: localEffect.sourceId,
      ledger: ledgerIncluded ? localEffect.ledger : [],
      movements: movementsIncluded ? localEffect.movements : []
    };
    const remoteComparable = {
      sourceType: effect.sourceType, sourceId: String(effect.sourceId),
      ledger: ledgerIncluded ? effect.ledger : [],
      movements: movementsIncluded ? effect.movements : []
    };
    if (stableJson(localComparable) !== stableJson(remoteComparable)) {
      conflicts.push({ key, reason: "local_effect_differs_from_remote", localVersion, remoteVersion });
    } else if (localVersion > remoteVersion) {
      conflicts.push({ key, reason: "remote_effect_is_stale", localVersion, remoteVersion });
    } else adoptedVersions[key] = remoteVersion;
  }
  if (invalid.length) return { actions: [], conflicts, adoptedVersions, invalid };
  return { actions, conflicts, adoptedVersions, invalid };
}

function applyCanonicalSourceEffect(state, effect) {
  if (!state || typeof state !== "object" || !effect ||
      !["doc", "po", "vch", "je", "wo"].includes(effect.sourceType) ||
      effect.sourceId == null || !Array.isArray(effect.ledger) || !Array.isArray(effect.movements)) {
    return { applied: false, reason: "invalid_effect" };
  }
  const includeLedger = effect.ledgerIncluded !== false;
  const includeMovements = effect.movementsIncluded !== false;
  if (!includeLedger && !includeMovements) return { applied: false, reason: "no_visible_effect_sections" };
  if (!Array.isArray(state.accts)) state.accts = [];
  if (!Array.isArray(state.items)) state.items = [];
  if (!Array.isArray(state.partners)) state.partners = [];
  if (!Array.isArray(state.L)) state.L = [];
  if (!Array.isArray(state.mv)) state.mv = [];

  const accountsByCode = new Map();
  for (const account of state.accts) {
    const code = String(account?.code || "").trim();
    if (!code) continue;
    if (accountsByCode.has(code)) return { applied: false, reason: "duplicate_local_account_code", code };
    accountsByCode.set(code, account);
  }
  const itemsByExternalId = new Map();
  for (const item of state.items) {
    if (item?.id != null) itemsByExternalId.set(String(item.id), item);
    if (item?.cloudId != null) itemsByExternalId.set(String(item.cloudId), item);
  }
  const partnersByExternalId = new Map();
  for (const partner of state.partners) {
    if (partner?.id != null) partnersByExternalId.set(String(partner.id), partner);
    if (partner?.cloudId != null) partnersByExternalId.set(String(partner.cloudId), partner);
  }
  const accountPlans = new Map();
  const ledgerRows = [];
  const movementRows = [];

  if (includeLedger) for (const row of effect.ledger) {
    const code = String(row.accountCode || "").trim();
    if (!code) return { applied: false, reason: "missing_account_code" };
    if (!accountsByCode.has(code) && !accountPlans.has(code)) {
      accountPlans.set(code, {
        code, name: String(row.accountName || code), t: String(row.accountType || "A"),
        k: String(row.accountKey || ""), cash: Number(row.accountIsCash || 0),
        cur: String(row.accountCurrency || "EGP")
      });
    }
    let partner = null;
    if (row.partnerExternalId != null && String(row.partnerExternalId) !== "") {
      partner = partnersByExternalId.get(String(row.partnerExternalId));
      if (!partner) return { applied: false, reason: "unmapped_partner", partnerExternalId: String(row.partnerExternalId) };
    }
    ledgerRows.push({ sourceRow: row, code, partner });
  }
  if (includeMovements) for (const row of effect.movements) {
    const item = itemsByExternalId.get(String(row.itemExternalId));
    if (!item) return { applied: false, reason: "unmapped_item", itemExternalId: String(row.itemExternalId) };
    let partner = null;
    if (row.partnerExternalId != null && String(row.partnerExternalId) !== "") {
      partner = partnersByExternalId.get(String(row.partnerExternalId));
      if (!partner) return { applied: false, reason: "unmapped_movement_partner", partnerExternalId: String(row.partnerExternalId) };
    }
    movementRows.push({ sourceRow: row, item, partner });
  }

  for (const [code, plan] of accountPlans) {
    let id = Date.now() + Math.floor(Math.random() * 100000);
    while (state.accts.some(x => String(x.id) === String(id))) id++;
    const account = { id, ...plan };
    state.accts.push(account);
    accountsByCode.set(code, account);
  }

  const sourceId = String(effect.sourceId), sourceType = effect.sourceType;
  const matches = row => row && row.src === sourceType && String(row.rid) === sourceId;
  if (includeMovements) {
    const oldMovements = state.mv.filter(matches);
    for (const movement of oldMovements) {
      const item = itemsByExternalId.get(String(movement.iid));
      if (item) {
        if (!item.st || typeof item.st !== "object" || Array.isArray(item.st)) item.st = {};
        item.st[movement.v] = (Number(item.st[movement.v]) || 0) - (Number(movement.q) || 0);
        item.val = (Number(item.val) || 0) - (Number(movement.val) || 0);
      }
    }
    state.mv = state.mv.filter(row => !matches(row));
  }
  if (includeLedger) state.L = state.L.filter(row => !matches(row));

  if (includeLedger) for (const entry of ledgerRows) {
    const row = entry.sourceRow, account = accountsByCode.get(entry.code);
    state.L.push({
      d: row.date || "", ts: Number(row.timestamp || 0), ref: String(row.reference || ""),
      desc: String(row.description || ""), a: account.id, dr: Number(row.debit || 0),
      cr: Number(row.credit || 0), pid: entry.partner?.id || 0, src: sourceType, rid: sourceId,
      fc: Number(row.foreignCurrencyAmount || 0)
    });
  }
  if (includeMovements) for (const entry of movementRows) {
    const row = entry.sourceRow, item = entry.item;
    if (!item.st || typeof item.st !== "object" || Array.isArray(item.st)) item.st = {};
    const quantity = Number(row.quantity || 0), value = Number(row.value || 0), variant = String(row.variant || "-");
    item.st[variant] = (Number(item.st[variant]) || 0) + quantity;
    item.val = (Number(item.val) || 0) + value;
    state.mv.push({
      d: row.date || "", ts: Number(row.timestamp || 0), iid: item.id, v: variant,
      q: quantity, val: value, ref: String(row.reference || ""), pid: entry.partner?.id || 0,
      src: sourceType, rid: sourceId
    });
  }
  return { applied: true, ledgerCount: ledgerRows.length, movementCount: movementRows.length, includeLedger, includeMovements };
}

// Absolute stock baseline helpers. These replace quantities; they never replay movements.
function stockBaselineFingerprint(items) {
  const input = stableJson(items);
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return "fnv1a32:" + (hash >>> 0).toString(16).padStart(8, "0");
}

function buildStockBaseline(state) {
  const invalid = [];
  if (!state || !Array.isArray(state.items)) {
    return { baselineVersion: 1, items: [], fingerprint: null, invalid: [{ reason: "missing_items_array" }] };
  }
  const seen = new Set();
  const items = [];
  for (const item of state.items) {
    if (!item || item.id == null || String(item.id).trim() === "") {
      invalid.push({ reason: "missing_item_external_id" }); continue;
    }
    const id = String(item.cloudId || item.id);
    if (seen.has(id)) { invalid.push({ reason: "duplicate_item_external_id", itemExternalId: id }); continue; }
    seen.add(id);
    if (item.st != null && (typeof item.st !== "object" || Array.isArray(item.st))) {
      invalid.push({ reason: "invalid_item_stock_map", itemExternalId: id }); continue;
    }
    const variants = [];
    for (const [variant, rawQuantity] of Object.entries(item.st || {})) {
      const quantity = Number(rawQuantity);
      if (!Number.isFinite(quantity)) {
        invalid.push({ reason: "invalid_stock_quantity", itemExternalId: id, variant }); continue;
      }
      variants.push({ variant: String(variant), quantity });
    }
    variants.sort((a, b) => a.variant.localeCompare(b.variant));
    const value = Number(item.val || 0);
    if (!Number.isFinite(value)) {
      invalid.push({ reason: "invalid_item_stock_value", itemExternalId: id }); continue;
    }
    items.push({
      itemExternalId: id,
      sku: String(item.sku || ""),
      name: String(item.name || ""),
      unit: String(item.unit || ""),
      warehouseName: (state.wh || []).find(w => String(w.id) === String(item.wh))?.name || "",
      variants,
      value
    });
  }
  items.sort((a, b) => a.itemExternalId.localeCompare(b.itemExternalId));
  return {
    baselineVersion: 1,
    items,
    fingerprint: invalid.length ? null : stockBaselineFingerprint(items),
    invalid
  };
}

function applyStockBaseline(state, baseline) {
  if (!state || typeof state !== "object" || !Array.isArray(state.items) ||
      !baseline || baseline.baselineVersion !== 1 || !Array.isArray(baseline.items) ||
      !baseline.fingerprint || (Array.isArray(baseline.invalid) && baseline.invalid.length > 0) || baseline.fingerprint !== stockBaselineFingerprint(baseline.items)) {
    return { applied: false, reason: "invalid_stock_baseline" };
  }
  const localById = new Map();
  for (const item of state.items) {
    if (!item || item.id == null) continue;
    const id = String(item.cloudId || item.id);
    if (localById.has(id)) return { applied: false, reason: "duplicate_local_item_external_id", itemExternalId: id };
    localById.set(id, item);
  }
  const seen = new Set(), plan = [];
  for (const row of baseline.items) {
    if (!row || row.itemExternalId == null || seen.has(String(row.itemExternalId)) ||
        !Array.isArray(row.variants) || !Number.isFinite(Number(row.value))) {
      return { applied: false, reason: "invalid_baseline_item" };
    }
    const id = String(row.itemExternalId), item = localById.get(id);
    if (!item) return { applied: false, reason: "baseline_item_not_synced", itemExternalId: id };
    seen.add(id);
    const stock = {};
    for (const variant of row.variants) {
      if (!variant || variant.variant == null || Object.prototype.hasOwnProperty.call(stock, String(variant.variant)) ||
          !Number.isFinite(Number(variant.quantity))) {
        return { applied: false, reason: "invalid_baseline_variant", itemExternalId: id };
      }
      stock[String(variant.variant)] = Number(variant.quantity);
    }
    plan.push({ item, stock, value: Number(row.value) });
  }
  // Validation completes before any local state is changed.
  for (const row of plan) {
    row.item.st = row.stock;
    row.item.val = row.value;
  }
  return { applied: true, itemCount: plan.length, fingerprint: baseline.fingerprint };
}

function factoryBaselineFingerprint(baseline) {
  return stockBaselineFingerprint({
    baselineVersion: baseline.baselineVersion,
    stock: baseline.stock,
    accounts: baseline.accounts,
    partners: baseline.partners,
    openingLedger: baseline.openingLedger,
    openingMovements: baseline.openingMovements
  });
}

function buildFactoryBaseline(state) {
  const invalid = [];
  const stock = buildStockBaseline(state);
  invalid.push(...stock.invalid);
  const collected = collectSourceEffects(state);
  invalid.push(...collected.invalid);
  if (collected.effects.length) {
    invalid.push({ reason: "source_effects_require_backfill_before_baseline", count: collected.effects.length });
  }

  const accountById = new Map(), accountCodes = new Set();
  const accounts = [];
  for (const account of Array.isArray(state?.accts) ? state.accts : []) {
    if (!account || account.id == null || !String(account.code || "").trim()) {
      invalid.push({ reason: "invalid_baseline_account" }); continue;
    }
    const code = String(account.code).trim();
    if (accountCodes.has(code)) { invalid.push({ reason: "duplicate_account_code", code }); continue; }
    accountCodes.add(code);
    const cash = Number(account.cash || 0);
    if (!Number.isFinite(cash)) { invalid.push({ reason: "invalid_baseline_account_cash", code }); continue; }
    const row = {
      code, name: String(account.name || code), type: String(account.t || "A"),
      key: String(account.k || ""), cash,
      currency: String(account.cur || "EGP")
    };
    accounts.push(row);
    accountById.set(String(account.id), row);
  }
  accounts.sort((a, b) => a.code.localeCompare(b.code));

  const partnerById = new Map(), partnerIds = new Set();
  const partners = [];
  for (const partner of Array.isArray(state?.partners) ? state.partners : []) {
    if (!partner || partner.id == null) continue;
    const externalId = String(partner.cloudId || partner.id);
    if (!String(partner.name || "").trim()) { invalid.push({ reason: "invalid_baseline_partner_name", externalId }); continue; }
    if (partnerIds.has(externalId)) { invalid.push({ reason: "duplicate_partner_external_id", externalId }); continue; }
    partnerIds.add(externalId);
    const row = {
      externalId, name: String(partner.name || ""), phone: String(partner.phone || ""),
      customer: Number(partner.c || 0) === 1, supplier: Number(partner.s || 0) === 1
    };
    partners.push(row);
    partnerById.set(String(partner.id), row);
    partnerById.set(externalId, row);
  }
  partners.sort((a, b) => a.externalId.localeCompare(b.externalId));

  const openingLedger = [];
  let debitTotal = 0, creditTotal = 0;
  for (const row of Array.isArray(state?.L) ? state.L : []) {
    if (row?.rid != null) continue;
    if (row?.src !== "je" || String(row.desc || "").trim() !== "رصيد افتتاحي") {
      invalid.push({ reason: "unclassified_legacy_ledger_row", reference: String(row?.ref || "") });
      continue;
    }
    const account = accountById.get(String(row.a));
    if (!account) { invalid.push({ reason: "unmapped_opening_account", accountId: String(row.a) }); continue; }
    let partner = null;
    if (row.pid != null && Number(row.pid) !== 0) {
      partner = partnerById.get(String(row.pid));
      if (!partner) { invalid.push({ reason: "unmapped_opening_partner", partnerId: String(row.pid) }); continue; }
    }
    const debit = Number(row.dr || 0), credit = Number(row.cr || 0), foreign = Number(row.fc || 0), timestamp = Number(row.ts || 0);
    if (![debit, credit, foreign, timestamp].every(Number.isFinite) || debit < 0 || credit < 0) {
      invalid.push({ reason: "invalid_opening_ledger_amount" }); continue;
    }
    debitTotal += debit; creditTotal += credit;
    openingLedger.push({
      date: row.d || null, timestamp, reference: String(row.ref || ""),
      description: String(row.desc || ""), accountCode: account.code, debit, credit,
      partnerExternalId: partner?.externalId || null, foreignCurrencyAmount: foreign
    });
  }
  if (Math.abs(debitTotal - creditTotal) > 0.005) {
    invalid.push({ reason: "unbalanced_opening_ledger", debitTotal, creditTotal });
  }
  openingLedger.sort((a, b) => stableJson(a).localeCompare(stableJson(b)));

  const itemById = new Map();
  for (const item of Array.isArray(state?.items) ? state.items : []) {
    if (!item || item.id == null) continue;
    const externalId = String(item.cloudId || item.id);
    itemById.set(String(item.id), externalId);
    itemById.set(externalId, externalId);
  }
  const openingMovements = [];
  for (const row of Array.isArray(state?.mv) ? state.mv : []) {
    if (row?.rid != null) continue;
    if (row?.src != null || String(row?.ref || "").trim() !== "رصيد افتتاحي") {
      invalid.push({ reason: "unclassified_legacy_stock_movement", reference: String(row?.ref || "") });
      continue;
    }
    const itemExternalId = itemById.get(String(row.iid));
    if (!itemExternalId) { invalid.push({ reason: "unmapped_opening_item", itemId: String(row.iid) }); continue; }
    const quantity = Number(row.q || 0), value = Number(row.val || 0), timestamp = Number(row.ts || 0);
    if (![quantity, value, timestamp].every(Number.isFinite)) {
      invalid.push({ reason: "invalid_opening_stock_amount" }); continue;
    }
    openingMovements.push({
      date: row.d || null, timestamp, itemExternalId,
      variant: String(row.v || "-"), quantity, value, reference: String(row.ref || "")
    });
  }
  openingMovements.sort((a, b) => stableJson(a).localeCompare(stableJson(b)));

  const baseline = {
    baselineVersion: 1, stock, accounts, partners, openingLedger, openingMovements
  };
  return { ...baseline, fingerprint: invalid.length ? null : factoryBaselineFingerprint(baseline), invalid };
}

function applyFactoryBaseline(state, baseline) {
  if (!state || typeof state !== "object" || !Array.isArray(state.items) ||
      !baseline || baseline.baselineVersion !== 1 || !baseline.stock ||
      !Array.isArray(baseline.accounts) || !Array.isArray(baseline.partners) ||
      !Array.isArray(baseline.openingLedger) || !Array.isArray(baseline.openingMovements) ||
      !baseline.fingerprint || (Array.isArray(baseline.stock?.invalid) && baseline.stock.invalid.length > 0) || baseline.fingerprint !== factoryBaselineFingerprint(baseline)) {
    return { applied: false, reason: "invalid_factory_baseline" };
  }
  const accounts = Array.isArray(state.accts) ? state.accts : [];
  const partners = Array.isArray(state.partners) ? state.partners : [];
  const ledger = Array.isArray(state.L) ? state.L : [];
  const movements = Array.isArray(state.mv) ? state.mv : [];
  const accountByCode = new Map();
  for (const account of accounts) {
    const code = String(account?.code || "").trim();
    if (!code) continue;
    if (accountByCode.has(code)) return { applied: false, reason: "duplicate_local_account_code", code };
    accountByCode.set(code, account);
  }
  let nextAccountId = Math.max(0, ...accounts.map(x => Number(x?.id) || 0)) + 1;
  const accountPlans = [];
  for (const row of baseline.accounts) {
    const code = String(row.code || "").trim();
    if (!code || accountByCode.has(code) && (String(accountByCode.get(code).name || "") !== String(row.name || "") || String(accountByCode.get(code).t || "A") !== String(row.type || "A"))) {
      return { applied: false, reason: "account_definition_conflict", code };
    }
    if (!accountByCode.has(code)) {
      const account = { id: nextAccountId++, code, name: String(row.name || code), t: String(row.type || "A"),
        k: String(row.key || ""), cash: Number(row.cash || 0), cur: String(row.currency || "EGP") };
      accountPlans.push(account);
      accountByCode.set(code, account);
    }
  }

  const partnerByExternalId = new Map(), partnerLinks = [];
  for (const partner of partners) {
    if (partner?.id != null) partnerByExternalId.set(String(partner.id), partner);
    if (partner?.cloudId != null) partnerByExternalId.set(String(partner.cloudId), partner);
  }
  let nextPartnerId = Math.max(0, ...partners.map(x => Number(x?.id) || 0)) + 1;
  const partnerPlans = [];
  for (const row of baseline.partners) {
    const externalId = String(row.externalId || "");
    if (!externalId) return { applied: false, reason: "invalid_baseline_partner" };
    if (partnerByExternalId.has(externalId)) {
      const existing = partnerByExternalId.get(externalId);
      if (String(existing.name || "").trim().toLocaleLowerCase() !== String(row.name || "").trim().toLocaleLowerCase() ||
          (row.phone && existing.phone && String(existing.phone).trim() !== String(row.phone).trim())) {
        return { applied: false, reason: "partner_definition_conflict", externalId };
      }
      if (!existing.cloudId) partnerLinks.push({ local: existing, externalId });
      continue;
    }
    const name = String(row.name || "").trim().toLocaleLowerCase(), phone = String(row.phone || "").trim();
    const matches = partners.filter(p =>
      (name && String(p.name || "").trim().toLocaleLowerCase() === name) ||
      (phone && String(p.phone || "").trim() === phone)
    );
    if (matches.length > 1) return { applied: false, reason: "ambiguous_local_partner", externalId };
    if (matches.length === 1) {
      const local = matches[0];
      if (String(local.name || "").trim().toLocaleLowerCase() !== name ||
          (phone && local.phone && String(local.phone).trim() !== phone) ||
          (local.cloudId && String(local.cloudId) !== externalId)) {
        return { applied: false, reason: "partner_definition_conflict", externalId };
      }
      partnerLinks.push({ local, externalId });
      partnerByExternalId.set(externalId, local);
    } else {
      const partner = { id: nextPartnerId++, cloudId: externalId, name: row.name, phone: row.phone,
        c: row.customer ? 1 : 0, s: row.supplier ? 1 : 0 };
      partnerPlans.push(partner);
      partnerByExternalId.set(externalId, partner);
    }
  }

  const itemByExternalId = new Map();
  for (const item of state.items) {
    if (item?.id != null) itemByExternalId.set(String(item.id), item);
    if (item?.cloudId != null) itemByExternalId.set(String(item.cloudId), item);
  }
  const ledgerKeys = new Set();
  for (const row of ledger) {
    const account = accounts.find(a => String(a.id) === String(row.a));
    const partner = partners.find(p => String(p.id) === String(row.pid));
    const key = stableJson({ date: row.d || null, timestamp: Number(row.ts || 0), reference: row.ref || "",
      description: row.desc || "", accountCode: account?.code || "", debit: Number(row.dr || 0),
      credit: Number(row.cr || 0), partnerExternalId: partner ? String(partner.cloudId || partner.id) : null,
      foreignCurrencyAmount: Number(row.fc || 0) });
    ledgerKeys.add(key);
  }
  const ledgerPlans = [];
  for (const row of baseline.openingLedger) {
    const account = accountByCode.get(String(row.accountCode));
    const partner = row.partnerExternalId ? partnerByExternalId.get(String(row.partnerExternalId)) : null;
    if (!account || row.partnerExternalId && !partner) return { applied: false, reason: "unmapped_baseline_ledger_reference" };
    const key = stableJson(row);
    if (ledgerKeys.has(key)) continue;
    ledgerKeys.add(key);
    ledgerPlans.push({ d: row.date || "", ts: Number(row.timestamp || 0), ref: String(row.reference || ""),
      desc: String(row.description || ""), a: account.id, dr: Number(row.debit || 0), cr: Number(row.credit || 0),
      pid: partner?.id || 0, fc: Number(row.foreignCurrencyAmount || 0), src: "je" });
  }

  const movementKeys = new Set();
  for (const row of movements) {
    const item = state.items.find(x => String(x.id) === String(row.iid));
    const externalId = item ? String(item.cloudId || item.id) : "";
    movementKeys.add(stableJson({ date: row.d || null, timestamp: Number(row.ts || 0), itemExternalId: externalId,
      variant: String(row.v || "-"), quantity: Number(row.q || 0), value: Number(row.val || 0), reference: String(row.ref || "") }));
  }
  const movementPlans = [];
  for (const row of baseline.openingMovements) {
    const item = itemByExternalId.get(String(row.itemExternalId));
    if (!item) return { applied: false, reason: "unmapped_baseline_stock_item", itemExternalId: String(row.itemExternalId) };
    const key = stableJson(row);
    if (movementKeys.has(key)) continue;
    movementKeys.add(key);
    movementPlans.push({ d: row.date || "", ts: Number(row.timestamp || 0), iid: item.id, v: String(row.variant || "-"),
      q: Number(row.quantity || 0), val: Number(row.value || 0), ref: String(row.reference || "") });
  }

  const stockResult = applyStockBaseline(state, baseline.stock);
  if (!stockResult.applied) return stockResult;
  if (!Array.isArray(state.accts)) state.accts = [];
  if (!Array.isArray(state.partners)) state.partners = [];
  if (!Array.isArray(state.L)) state.L = [];
  if (!Array.isArray(state.mv)) state.mv = [];
  partnerLinks.forEach(link => { link.local.cloudId = link.externalId; });
  state.accts.push(...accountPlans);
  state.partners.push(...partnerPlans);
  state.L.push(...ledgerPlans);
  state.mv.push(...movementPlans);
  return { applied: true, fingerprint: baseline.fingerprint, accountsAdded: accountPlans.length,
    partnersAdded: partnerPlans.length, ledgerAdded: ledgerPlans.length, movementsAdded: movementPlans.length };
}


function applyInventoryBaselineSection(state, section) {
  if (!state || typeof state !== "object" || !section ||
      section.baselineVersion !== 1 || !section.stock ||
      !Array.isArray(section.openingMovements)) {
    return { applied: false, reason: "invalid_inventory_baseline_section" };
  }
  const itemByExternalId = new Map();
  for (const item of Array.isArray(state.items) ? state.items : []) {
    if (item?.id == null) continue;
    for (const id of [item.id, item.cloudId].filter(x => x != null).map(String)) {
      if (itemByExternalId.has(id) && itemByExternalId.get(id) !== item) {
        return { applied: false, reason: "duplicate_local_item_external_id", itemExternalId: id };
      }
      itemByExternalId.set(id, item);
    }
  }
  const movements = Array.isArray(state.mv) ? state.mv : [];
  const keys = new Set(movements.map(row => {
    const item = state.items.find(x => String(x.id) === String(row.iid));
    return stableJson({ date: row.d || null, timestamp: Number(row.ts || 0),
      itemExternalId: item ? String(item.cloudId || item.id) : "",
      variant: String(row.v || "-"), quantity: Number(row.q || 0),
      value: Number(row.val || 0), reference: String(row.ref || "") });
  }));
  const planned = [];
  for (const row of section.openingMovements) {
    const item = itemByExternalId.get(String(row?.itemExternalId || ""));
    if (!item || !Number.isFinite(Number(row.quantity)) ||
        !Number.isFinite(Number(row.value)) || !Number.isFinite(Number(row.timestamp || 0)) ||
        !String(row.variant || "").trim()) {
      return { applied: false, reason: "invalid_or_unmapped_opening_movement",
        itemExternalId: String(row?.itemExternalId || "") };
    }
    const key = stableJson(row);
    if (keys.has(key)) continue;
    keys.add(key);
    planned.push({ d: row.date || "", ts: Number(row.timestamp || 0), iid: item.id,
      v: String(row.variant), q: Number(row.quantity), val: Number(row.value),
      ref: String(row.reference || "رصيد افتتاحي") });
  }
  // applyStockBaseline performs a complete preflight before changing any quantity.
  const stockResult = applyStockBaseline(state, section.stock);
  if (!stockResult.applied) return stockResult;
  if (!Array.isArray(state.mv)) state.mv = [];
  state.mv.push(...planned);
  return { applied: true, fingerprint: section.fingerprint || section.stock.fingerprint,
    movementsAdded: planned.length, stock: stockResult };
}

function applyAccountingBaselineSection(state, section) {
  if (!state || typeof state !== "object" || !section ||
      section.baselineVersion !== 1 || !Array.isArray(section.accounts) ||
      !Array.isArray(section.partners) || !Array.isArray(section.openingLedger)) {
    return { applied: false, reason: "invalid_accounting_baseline_section" };
  }
  // Reuse the full baseline's all-or-nothing mapping and ledger validation,
  // while supplying a no-op absolute stock baseline from the current device.
  const stock = buildStockBaseline(state);
  if (stock.invalid.length) return { applied: false, reason: "invalid_local_stock_for_accounting_bootstrap" };
  const combined = { baselineVersion: 1, stock, accounts: section.accounts,
    partners: section.partners, openingLedger: section.openingLedger, openingMovements: [] };
  combined.fingerprint = factoryBaselineFingerprint(combined);
  return applyFactoryBaseline(state, combined);
}

function stableJson(value) {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).filter(k => !k.startsWith("_cloud")).sort()
      .map(k => JSON.stringify(k) + ":" + stableJson(value[k])).join(",") + "}";
  }
  return JSON.stringify(value);
}


// ===== الرفع مرة واحدة على الجداول - الكاش هو الأساس =====
async function uploadToTables(showAlert = false) {
  if (uploadRunning) return "upload already running";
  uploadRunning = true;
  if (!navigator.onLine) {
    syncState = "offline"; drawAll();
    if (showAlert) alert(T("مفيش إنترنت - محفوظ في الجهاز، وهيترفع أول ما النت يرجع 💾", "No internet - saved on device, will upload when online 💾"));
    uploadRunning = false;
    return "offline";
  }
  syncState = "saving"; drawAll();
  try {
    const owner = await getOwnerId();
    if (!owner) { syncState = "idle"; drawAll(); return "no user"; }
    const profile = await getMyProfile();
    if (!profile) throw new Error("تعذر تحديد صلاحيات الحساب");
    const admin = profile.is_admin === true;
    const canWrite = key => admin || profile.permissions?.[key] === true;
    if (!admin && !["customers", "suppliers", "invoices", "inventory", "production"].some(canWrite)) {
      syncState = "idle"; drawAll();
      const msg = T("حسابك للعرض فقط أو لا توجد صلاحية مزامنة متاحة.", "This account is read-only or has no supported sync permission.");
      if (showAlert) alert(msg);
      return msg;
    }
    const S = getCachedState();
    if (!S || typeof S !== "object" || Array.isArray(S)) throw new Error("بيانات المصنع المحلية غير صالحة؛ لم يتم رفع أي شيء");
    const errors = [];
    let snapshotError = null;
    let snapshotConflict = !!localStorage.getItem("mgr6-cloud-snapshot-conflict");

    // Snapshot conflicts must not block independent, idempotent detail-table writes.
    if (admin && !snapshotConflict) {
      const expectedVersion = Number(localStorage.getItem("mgr6-cloud-snapshot-version") || 0);
      const result = await supabase.rpc("sync_factory_state", {
        p_expected_version: expectedVersion,
        p_state: S
      });
      snapshotError = result.error;
      if (snapshotError?.code === "40001") {
        snapshotConflict = true;
        localStorage.setItem("mgr6-cloud-snapshot-conflict", JSON.stringify({ reason: "stale_snapshot", at: new Date().toISOString() }));
      } else if (snapshotError) {
        errors.push("factory_state: " + snapshotError.message);
      } else {
        const snapshotRow = Array.isArray(result.data) ? result.data[0] : result.data;
        if (!snapshotRow?.sync_version) errors.push("factory_state: server returned no snapshot version");
        else {
          localStorage.setItem("mgr6-cloud-snapshot-version", String(snapshotRow.sync_version));
          localStorage.setItem("mgr6-cloud-snapshot-pend", String(Number(S.pend || 0)));
          localStorage.removeItem("mgr6-cloud-snapshot-conflict");
          snapshotConflict = false;
        }
      }
    }

    const partnerArrays = [];
    if (Array.isArray(S.partners)) partnerArrays.push({ key: "partners", arr: S.partners });
    if (Array.isArray(S.customers)) partnerArrays.push({ key: "customers", arr: S.customers });
    if (Array.isArray(S.suppliers)) partnerArrays.push({ key: "suppliers", arr: S.suppliers });
    if (Array.isArray(S.clients)) partnerArrays.push({ key: "clients", arr: S.clients });
    for (const { key, arr } of partnerArrays) {
      for (const p of arr) {
        const name = String(getField(p, ["name", "nm", "title"]) || "");
        if (!name || isAccountName(name)) continue;
        const typeStr = String(getField(p, ["type", "kind", "cat", "category"]) || "").toLowerCase();
        if (typeStr.includes("account") || typeStr.includes("coa") || typeStr.includes("chart") || typeStr.includes("حساب")) continue;
        const isSup = typeStr.includes("supp") || typeStr.includes("مورد") || p.isSupplier === true || key === "suppliers";
        if (!canWrite(isSup ? "suppliers" : "customers")) continue;
        const table = isSup ? "suppliers" : "customers";
        const row = {
          user_id: owner,
          ...(p.id != null && !p.cloudId ? { cloudId: String(p.id) } : {}),
          external_id: String(p.cloudId || getField(p, ["id", "no", "code"]) || name),
          name,
          phone: String(getField(p, ["phone", "tel", "mobile", "ph"]) || "") || null,
          email: String(getField(p, ["email", "mail"]) || "") || null,
          address: String(getField(p, ["addr", "address", "add"]) || "") || null
        };
        const { error } = await supabase.from(table).upsert(row, { onConflict: "user_id,external_id" });
        if (error) errors.push(table + ": " + error.message);
      }
    }

    const docs = S.docs || S.invoices || [];
    let invoiceVersionsChanged = false;
    if (canWrite("invoices") && Array.isArray(docs)) {
      for (const d of docs) {
        if (!d || !["sale", "pur"].includes(d.t)) continue;
        const extId = String(getField(d, ["id", "no", "num", "code", "invNo"]) || "");
        if (!extId) { errors.push("invoice skipped: missing stable ID"); continue; }
        const custName = String(getField(d, ["customer", "cust", "partner", "client", "name"]) || "");
        if (custName && isAccountName(custName)) continue;
        const total = Number(getField(d, ["total", "tot", "grandTotal", "amount", "sum"]) || 0) || 0;
        const rawDoc = { ...d };
        delete rawDoc._cloudVersion;
        delete rawDoc._cloudUpdatedAt;
        delete rawDoc._cloudConflict;
        rawDoc.customer_name = custName || null;
        const invoiceItems = Array.isArray(d.lines) ? d.lines : (Array.isArray(d.items) ? d.items : []);
        const payloadItems = invoiceItems.map(it => ({
          name: String(getField(it, ["name", "product", "item", "title"]) || "بند بدون اسم"),
          variant: String(getField(it, ["v", "variant"]) || "-"),
          qty: Number(getField(it, ["qty", "q", "quantity"]) || 1) || 1,
          price: Number(getField(it, ["price", "pr", "unit"]) || 0) || 0,
          total: Number(getField(it, ["total", "tot", "amount"]) || ((Number(it.qty || it.q || it.quantity || 1) || 1) * (Number(it.price || it.pr || it.unit || 0) || 0))),
          note: String(getField(it, ["note", "desc"]) || "") || null
        }));
        const { data, error } = await supabase.rpc("sync_invoice", {
          p_external_id: extId,
          p_invoice_no: String(d.no || extId),
          p_invoice_type: d.t === "sale" ? "sale" : "purchase",
          p_invoice_date: d.date || null,
          p_total: total,
          p_discount: Number(d.disc || 0),
          p_note: d.note || null,
          p_raw: rawDoc,
          p_expected_version: d._cloudVersion === undefined ? 0 : Number(d._cloudVersion),
          p_items: payloadItems
        });
        if (error) {
          errors.push("invoice " + extId + ": " + (error.code === "40001"
            ? "تعارض تعديل: توجد نسخة أحدث على السحابة؛ لم يتم استبدالها"
            : error.message));
          continue;
        }
        const syncRow = Array.isArray(data) ? data[0] : data;
        if (!syncRow?.sync_version) {
          errors.push("invoice " + extId + ": server returned no synchronization version");
          continue;
        }
        d._cloudVersion = Number(syncRow.sync_version);
        d._cloudUpdatedAt = syncRow.updated_at || null;
        invoiceVersionsChanged = true;
      }
    }
    let detailVersionsChanged = false;

    if (canWrite("invoices")) {
      for (const d of (Array.isArray(S.docs) ? S.docs : [])) {
        if (!d || !["sret", "pret"].includes(d.t)) continue;
        if (d._cloudConflict) { errors.push("return " + String(d.no || d.id) + ": conflict with a newer cloud copy; resolve before uploading"); continue; }
        const externalId = String(getField(d, ["id", "no"]) || "");
        if (!externalId) { errors.push("return skipped: missing stable ID"); continue; }
        const raw = { ...d }; delete raw._cloudUpdatedAt; delete raw._cloudConflict;
        const row = {
          user_id: owner, external_id: externalId,
          return_no: String(d.no || externalId),
          return_type: d.t === "sret" ? "sale_return" : "purchase_return",
          return_date: String(d.date || new Date().toISOString()).slice(0, 10),
          total: Number(d.total || 0) || 0, note: d.note || null,
          raw, updated_at: new Date().toISOString()
        };
        const { data, error } = await supabase.from("returns")
          .upsert(row, { onConflict: "user_id,external_id" }).select("updated_at").single();
        if (error) errors.push("returns " + externalId + ": " + error.message);
        else if (data?.updated_at) { d._cloudUpdatedAt = data.updated_at; detailVersionsChanged = true; }
      }

      for (const v of (Array.isArray(S.vch) ? S.vch : [])) {
        if (!v) continue;
        if (v._cloudConflict) { errors.push("voucher " + String(v.no || v.id) + ": conflict with a newer cloud copy; resolve before uploading"); continue; }
        const externalId = String(getField(v, ["id", "no"]) || "");
        if (!externalId) { errors.push("voucher skipped: missing stable ID"); continue; }
        const raw = { ...v }; delete raw._cloudUpdatedAt; delete raw._cloudConflict;
        const row = {
          user_id: owner, external_id: externalId,
          voucher_no: String(v.no || externalId),
          direction: v.dir === "in" ? "in" : "out",
          account: String(v.title || v.desc || "سند"),
          voucher_date: String(v.date || new Date().toISOString()).slice(0, 10),
          amount: Number(v.total || 0) || 0,
          note: v.desc || null, raw, updated_at: new Date().toISOString()
        };
        const { data, error } = await supabase.from("vouchers")
          .upsert(row, { onConflict: "user_id,external_id" }).select("updated_at").single();
        if (error) errors.push("vouchers " + externalId + ": " + error.message);
        else if (data?.updated_at) { v._cloudUpdatedAt = data.updated_at; detailVersionsChanged = true; }
      }
    }

    if (canWrite("production")) {
      for (const o of (Array.isArray(S.po) ? S.po : [])) {
        if (!o) continue;
        if (o._cloudConflict) { errors.push("production order " + String(o.no || o.id) + ": conflict with a newer cloud copy; resolve before uploading"); continue; }
        const externalId = String(getField(o, ["id", "no"]) || "");
        if (!externalId) { errors.push("production order skipped: missing stable ID"); continue; }
        const raw = { ...o }; delete raw._cloudUpdatedAt; delete raw._cloudConflict;
        const extraCost = (Array.isArray(o.x) ? o.x : []).reduce((sum, item) => sum + (Number(item?.amt) || 0), 0);
        const purchaseCost = (Array.isArray(S.docs) ? S.docs : [])
          .filter(d => d?.t === "pur" && String(d.dest) === String(o.id))
          .reduce((sum, d) => sum + (Number(d.total) || 0), 0);
        const row = {
          user_id: owner, external_id: externalId,
          order_no: String(o.no || externalId),
          item_name: String(o.iname || o.name || "أمر إنتاج"),
          description: o.desc || null,
          status: Number(o.st) === 2 ? "delivered" : Number(o.st) === 1 ? "in_progress" : "new",
          breakdown: { subs: o.subs || [], received: o.rec || [], materials: o.mats || [], extra_costs: o.x || [], stage: Number(o.st) || 0, warehouse: o.wh ?? null },
          total_cost: (Number(o.matCost) || 0) + (Number(o.wc) || 0) + extraCost + purchaseCost,
          order_date: String(o.date || new Date().toISOString()).slice(0, 10),
          raw, updated_at: new Date().toISOString()
        };
        const { data, error } = await supabase.from("production_orders")
          .upsert(row, { onConflict: "user_id,external_id" }).select("updated_at").single();
        if (error) errors.push("production_orders " + externalId + ": " + error.message);
        else if (data?.updated_at) { o._cloudUpdatedAt = data.updated_at; detailVersionsChanged = true; }
      }
    }

    if (invoiceVersionsChanged || detailVersionsChanged) {
      // Persist server versions without triggering another autosave/upload cycle.
      Object.getPrototypeOf(localStorage).setItem.call(localStorage, "mgr6", JSON.stringify(S));
    }

    // The live app's inventory master array is S.items (each item carries stock by variant in item.st).
    // Keep the older S.products / S.prods shapes as compatibility sources for earlier builds.
    if (canWrite("inventory")) {
      const productMap = new Map();
      for (const arr of [S.items, S.products, S.prods]) {
        if (!Array.isArray(arr)) continue;
        for (const pr of arr) {
          if (!pr || typeof pr !== "object") continue;
          const name = String(getField(pr, ["name", "title", "product"]) || "");
          if (!name || isAccountName(name)) continue;
          if (pr.id != null && !pr.cloudId) pr.cloudId = String(pr.id);
          const externalId = String(pr.cloudId || getField(pr, ["id", "code", "sku"]) || name);
          if (!productMap.has(externalId)) productMap.set(externalId, pr);
        }
      }
      for (const [externalId, pr] of productMap) {
        const name = String(getField(pr, ["name", "title", "product"]) || "");
        const variants = pr.st && typeof pr.st === "object" && !Array.isArray(pr.st) ? pr.st : null;
        const qty = variants
          ? Object.values(variants).reduce((sum, value) => sum + (Number(value) || 0), 0)
          : (Number(getField(pr, ["qty", "q", "stock", "balance"]) || 0) || 0);
        const buyPrice = Number(getField(pr, ["buy", "buy_price", "price", "pr"]) || 0) || 0;
        const warehouse = Array.isArray(S.wh)
          ? (S.wh.find(w => String(w.id) === String(pr.wh)) || {}).name
          : "";
        const row = {
          user_id: owner,
          external_id: externalId,
          name,
          sku: String(getField(pr, ["sku", "code"]) || "") || null,
          unit: String(getField(pr, ["unit", "u"]) || "قطعة"),
          warehouse: warehouse || (pr.wh == null ? null : String(pr.wh)),
          buy_price: buyPrice,
          retail_price: Number(getField(pr, ["retail", "retail_price"]) || 0) || 0,
          wholesale_price: Number(getField(pr, ["wholesale", "wholesale_price"]) || 0) || 0,
          qty,
          price: buyPrice,
          image_url: String(getField(pr, ["img", "image_url"]) || "") || null,
          raw: pr
        };
        const { error } = await supabase.from("products").upsert(row, { onConflict: "user_id,external_id" });
        if (error) errors.push("products " + externalId + ": " + error.message);
      }
    }


    // Publish the immutable opening baseline only after master records were synced.
    // Missing RPC means the draft migration has not been applied yet; keep legacy sync operational.
    if (admin) {
      const existingBaseline = await supabase.rpc("get_factory_baseline", { p_section: "inventory" });
      const baselineRpcMissing = existingBaseline.error &&
        ["PGRST202", "42883"].includes(String(existingBaseline.error.code || ""));
      if (existingBaseline.error && !baselineRpcMissing) {
        errors.push("factory baseline read: " + existingBaseline.error.message);
      } else if (!baselineRpcMissing && !(Array.isArray(existingBaseline.data) && existingBaseline.data.length)) {
        const baseline = buildFactoryBaseline(S);
        if (baseline.invalid.length) {
          errors.push("factory baseline not publishable: " + baseline.invalid.map(x => x.reason).join(", "));
        } else {
          const inventorySection = { baselineVersion: 1, stock: baseline.stock,
            openingMovements: baseline.openingMovements };
          const accountingSection = { baselineVersion: 1, accounts: baseline.accounts,
            partners: baseline.partners, openingLedger: baseline.openingLedger };
          const published = await supabase.rpc("publish_factory_baseline", {
            p_expected_version: 0, p_inventory_section: inventorySection,
            p_accounting_section: accountingSection
          });
          if (published.error && published.error.code !== "23505") {
            errors.push("factory baseline publish: " + published.error.message);
          }
        }
      }
    }


    // Synchronize source-scoped ledger/stock effects only when this client can write both sections.
    if (canWrite("inventory") && ["invoices", "production", "settings"].some(canWrite)) {
      const remoteResult = await supabase.rpc("get_source_effects");
      const missingEffectsRpc = remoteResult.error && ["PGRST202", "42883"].includes(String(remoteResult.error.code || ""));
      if (remoteResult.error && !missingEffectsRpc) errors.push("source effects read before write: " + remoteResult.error.message);
      else if (!missingEffectsRpc) {
        let versions = {};
        try { versions = JSON.parse(localStorage.getItem("mgr6-source-effect-versions") || "{}") || {}; } catch(e) {}
        const plan = planSourceEffectSync(S, remoteResult.data || [], versions, []);
        if (plan.invalid.length) errors.push("source effects invalid: " + plan.invalid.map(x => x.reason).join(", "));
        else {
          if (plan.conflicts.length) localStorage.setItem("mgr6-source-effect-conflicts", JSON.stringify(plan.conflicts));
          for (const action of plan.actions) {
            if (action.op !== "upsert") continue;
            const permission = ({ doc: "invoices", po: "production", vch: "invoices", je: "settings", wo: "inventory" })[action.effect.sourceType];
            if (!canWrite(permission)) continue;
            const payload = { ...action.effect, ledgerIncluded: true, movementsIncluded: true };
            const saved = await supabase.rpc("sync_source_effect", {
              p_source_type: action.effect.sourceType, p_source_id: action.effect.sourceId,
              p_expected_version: action.expectedVersion, p_payload: payload, p_deleted: false
            });
            if (saved.error) {
              if (saved.error.code === "40001") {
                const conflicts = JSON.parse(localStorage.getItem("mgr6-source-effect-conflicts") || "[]");
                conflicts.push({ sourceType: action.effect.sourceType, sourceId: action.effect.sourceId, reason: "write_version_conflict" });
                localStorage.setItem("mgr6-source-effect-conflicts", JSON.stringify(conflicts));
              } else errors.push("source effect " + action.effect.sourceType + "/" + action.effect.sourceId + ": " + saved.error.message);
              continue;
            }
            const row = Array.isArray(saved.data) ? saved.data[0] : saved.data;
            if (row?.sync_version) versions[JSON.stringify([action.effect.sourceType, action.effect.sourceId])] = Number(row.sync_version);
          }
          localStorage.setItem("mgr6-source-effect-versions", JSON.stringify(versions));
        }
      }
    }

    if (errors.length) {
      syncState = localStorage.getItem("mgr6-cloud-snapshot-conflict") ? "conflict" : "idle"; drawAll();
      const msg = (snapshotError
        ? T("فشل حفظ النسخة الكاملة وبعض الجداول:\n", "Full backup and some table writes failed:\n")
        : T("بعض عمليات المزامنة فشلت:\n", "Some sync operations failed:\n")) + errors.join("\n");
      if (showAlert) alert(msg);
      return msg;
    }
    const hasSnapshotConflict = snapshotConflict || !!localStorage.getItem("mgr6-cloud-snapshot-conflict");
    const latestPend = Number(getCachedState().pend || 0);
    if (!hasSnapshotConflict && latestPend === Number(S.pend || 0)) localStorage.removeItem(PENDING_SYNC_KEY);
    else if (!hasSnapshotConflict) scheduleAutoSync(400);
    // Employee detail-only sync is deliberately not labelled fully synchronized.
    syncState = hasSnapshotConflict ? "conflict" : (admin ? "synced" : "partial");
    lastSyncTime = new Date().toLocaleTimeString(isEN() ? "en-US" : "ar-EG");
    drawAll();
    const msg = hasSnapshotConflict
      ? T("تمت مزامنة السجلات التفصيلية المتاحة، لكن النسخة الكاملة بها تعارض محفوظ ولم يتم استبدالها.", "Available detail records were synchronized; the full snapshot conflict was preserved without overwriting it.")
      : admin
        ? T("تم حفظ نسخة المصنع الكاملة ومزامنة الجداول التفصيلية", "Full factory backup saved and detail tables synchronized")
        : T("تم رفع الجداول المسموح بها فقط. مزامنة القيود والحركات المحاسبية الكاملة لحساب الموظف لم تكتمل بعد.", "Only permitted detail tables were uploaded. Full accounting-ledger synchronization for employee accounts is not complete yet.");
    if (showAlert) alert(msg);
    return msg;
  } catch(e) {
    console.error(e); syncState = "idle"; drawAll();
    if (showAlert) alert(e.message);
    return "خطأ: " + e.message;
  } finally {
    uploadRunning = false;
  }
}

// ===== التحميل - دمج آمن، مع نسخة احتياطية قبل أي كتابة =====
async function loadFromTablesMerge(isAuto = false) {
  if (autoLoadRunning) return "already running";
  autoLoadRunning = true;
  try {
    const owner = await getOwnerId();
    if (!owner) return "no user";
    const profile = await getMyProfile();
    if (!profile) throw new Error("تعذر تحديد صلاحيات الحساب");
    const admin = profile.is_admin === true;
    const canRead = key => admin || profile.permissions?.[key] === true || profile.permissions?.reports === true;

    let restoredSnapshot = false;
    if (admin) {
      const { data: snapshot, error } = await supabase.from("factory_state")
        .select("state,updated_at,sync_version").eq("user_id", owner).maybeSingle();
      if (error) throw error;
      const localState = getCachedState();
      const localVersion = Number(localStorage.getItem("mgr6-cloud-snapshot-version") || 0);
      const baselinePend = localStorage.getItem("mgr6-cloud-snapshot-pend");
      const currentPend = String(Number(localState?.pend || 0));
      if (snapshot?.state && typeof snapshot.state === "object" && !Array.isArray(snapshot.state)) {
        const remoteVersion = Number(snapshot.sync_version || 1);
        let restoreRemote = false;
        let snapshotConflict = false;
        if (isLocalEmpty()) {
          restoreRemote = true;
        } else if (localVersion === 0) {
          if (stableJson(localState) === stableJson(snapshot.state)) {
            localStorage.setItem("mgr6-cloud-snapshot-version", String(remoteVersion));
            localStorage.setItem("mgr6-cloud-snapshot-pend", String(Number(localState.pend || 0)));
          } else snapshotConflict = true;
        } else if (remoteVersion > localVersion) {
          const localChanged = baselinePend === null || currentPend !== baselinePend;
          if (localChanged) snapshotConflict = true;
          else restoreRemote = true;
        } else if (remoteVersion < localVersion) {
          snapshotConflict = true;
        }
        if (snapshotConflict) {
          localStorage.setItem("mgr6-cloud-snapshot-conflict", JSON.stringify({
            reason: "concurrent_snapshot", remoteVersion, remoteUpdatedAt: snapshot.updated_at || null
          }));
          syncState = "conflict"; drawAll();
          return "cloud snapshot conflict";
        }
        if (restoreRemote) {
          try { localStorage.setItem("mgr6-backup-before-cloud-restore", localStorage.getItem("mgr6") || ""); }
          catch(e) { throw new Error("تعذر حفظ نسخة احتياطية محلية؛ لم يتم استبدال بيانات الجهاز"); }
          Object.getPrototypeOf(localStorage).setItem.call(localStorage, "mgr6", JSON.stringify(snapshot.state));
          localStorage.setItem("mgr6-cloud-snapshot-version", String(remoteVersion));
          localStorage.setItem("mgr6-cloud-snapshot-pend", String(Number(snapshot.state.pend || 0)));
          localStorage.removeItem("mgr6-cloud-snapshot-conflict");
          restoredSnapshot = true;
        }
      } else if (localVersion > 0) {
        localStorage.setItem("mgr6-cloud-snapshot-conflict", JSON.stringify({ reason: "missing_remote_snapshot" }));
        syncState = "conflict"; drawAll();
        return "cloud snapshot conflict";
      }
    }

    if (!["customers","suppliers","invoices","inventory","production","reports"].some(canRead)) {
      return T("لا توجد صلاحيات لقراءة بيانات السحابة", "No permission to read cloud data");
    }
    // Preserve a rollback copy, then merge remote records without replacing local master data.
    try { localStorage.setItem("mgr6-backup-before-cloud-restore", localStorage.getItem("mgr6") || ""); } catch(e){}

    const emptyResult = { data: [], error: null };
    const results = await Promise.all([
      canRead("customers") ? supabase.from("customers").select("*").eq("user_id", owner) : Promise.resolve(emptyResult),
      canRead("suppliers") ? supabase.from("suppliers").select("*").eq("user_id", owner) : Promise.resolve(emptyResult),
      canRead("invoices") ? supabase.from("invoices").select("*").eq("user_id", owner) : Promise.resolve(emptyResult),
      canRead("inventory") ? supabase.from("products").select("*").eq("user_id", owner) : Promise.resolve(emptyResult),
      canRead("invoices") ? supabase.from("returns").select("*").eq("user_id", owner) : Promise.resolve(emptyResult),
      canRead("invoices") ? supabase.from("vouchers").select("*").eq("user_id", owner) : Promise.resolve(emptyResult),
      canRead("production") ? supabase.from("production_orders").select("*").eq("user_id", owner) : Promise.resolve(emptyResult),
    ]);
    const failed = results.find(r => r.error);
    if (failed) return isAuto ? "cloud read failed" : T("تعذر قراءة البيانات من السحابة: " + failed.error.message, "Cloud read failed: " + failed.error.message);

    const baselineMissing = error => error && ["PGRST202", "42883"].includes(String(error.code || ""));
    const [inventoryBaselineResult, accountingBaselineResult] = await Promise.all([
      canRead("inventory") ? supabase.rpc("get_factory_baseline", { p_section: "inventory" }) : Promise.resolve(emptyResult),
      canRead("settings") ? supabase.rpc("get_factory_baseline", { p_section: "accounting" }) : Promise.resolve(emptyResult)
    ]);
    if (inventoryBaselineResult.error && !baselineMissing(inventoryBaselineResult.error))
      return isAuto ? "cloud baseline read failed" : T("تعذر قراءة أساس المخزون: " + inventoryBaselineResult.error.message, "Inventory baseline read failed: " + inventoryBaselineResult.error.message);
    if (accountingBaselineResult.error && !baselineMissing(accountingBaselineResult.error))
      return isAuto ? "cloud baseline read failed" : T("تعذر قراءة الأساس المحاسبي: " + accountingBaselineResult.error.message, "Accounting baseline read failed: " + accountingBaselineResult.error.message);
    const inventoryBaselineRow = !inventoryBaselineResult.error && Array.isArray(inventoryBaselineResult.data) ? inventoryBaselineResult.data[0] : null;
    const accountingBaselineRow = !accountingBaselineResult.error && Array.isArray(accountingBaselineResult.data) ? accountingBaselineResult.data[0] : null;
    const [{ data: custs }, { data: supps }, { data: invs }, { data: prods }, { data: returns }, { data: vouchers }, { data: productionOrders }] = results;
    if (!custs?.length && !supps?.length && !invs?.length && !prods?.length && !returns?.length && !vouchers?.length && !productionOrders?.length && !inventoryBaselineRow && !accountingBaselineRow) {
      if (restoredSnapshot && isAuto) setTimeout(() => location.reload(), 500);
      return restoredSnapshot
        ? T("تمت استعادة نسخة المصنع الكاملة من السحابة", "Full factory backup restored from cloud")
        : (isAuto ? "cloud empty - keep local" : T("مفيش بيانات في السحابة", "No data in cloud"));
    }

    const S = getCachedState();
    if (!S || typeof S !== "object" || Array.isArray(S)) return "bad local";
    let totalAdded = 0;
    let recordConflicts = 0;
    const cloudPartners = [
      ...(custs || []).map(c => ({ id: c.external_id, cloudId: c.external_id, name: c.name, phone: c.phone, email: c.email, addr: c.address, kind: "customer" })),
      ...(supps || []).map(s => ({ id: s.external_id, cloudId: s.external_id, name: s.name, phone: s.phone, email: s.email, addr: s.address, kind: "supplier" })),
    ];
    if (cloudPartners.length) {
      const m = mergeCloudPartners(S.partners || [], cloudPartners);
      S.partners = m.arr; totalAdded += m.added; recordConflicts += m.conflicts;
    }
    if (invs?.length) {
      const cloudDocs = invs
        .filter(inv => inv.raw && ["sale", "pur"].includes(inv.raw.t))
        .map(inv => ({ ...inv.raw, _cloudVersion: Number(inv.sync_version || 1), _cloudUpdatedAt: inv.updated_at || null }));
      if (!Array.isArray(S.docs)) S.docs = [];
      const m = mergeCloudInvoices(S.docs, cloudDocs);
      S.docs = m.arr; totalAdded += m.added; recordConflicts += m.conflicts;
    }
    if (returns?.length) {
      const cloudReturns = returns.map(row => row.raw && typeof row.raw === "object" ? ({ ...row.raw, _cloudUpdatedAt: row.updated_at }) : ({
        id: row.external_id || row.id, no: row.return_no,
        t: row.return_type === "sale_return" ? "sret" : "pret",
        date: row.return_date, total: Number(row.total || 0), note: row.note || ""
      }));
      const merged = mergeCloudRecords(S.docs || [], cloudReturns);
      S.docs = merged.arr; totalAdded += merged.added; recordConflicts += merged.conflicts;
    }
    if (vouchers?.length) {
      const cloudVouchers = vouchers.map(row => row.raw && typeof row.raw === "object" ? ({ ...row.raw, _cloudUpdatedAt: row.updated_at }) : ({
        id: row.external_id || row.id, no: row.voucher_no, dir: row.direction,
        date: row.voucher_date, title: row.account, desc: row.note || "", total: Number(row.amount || 0), ac: [], ln: []
      }));
      const merged = mergeCloudRecords(S.vch || [], cloudVouchers);
      S.vch = merged.arr; totalAdded += merged.added; recordConflicts += merged.conflicts;
    }
    if (productionOrders?.length) {
      const cloudOrders = productionOrders.map(row => {
        if (row.raw && typeof row.raw === "object") return { ...row.raw, _cloudUpdatedAt: row.updated_at };
        const breakdown = row.breakdown && typeof row.breakdown === "object" ? row.breakdown : {};
        return {
          id: row.external_id || row.id, no: row.order_no, iname: row.item_name,
          desc: row.description || "", date: row.order_date,
          st: row.status === "delivered" ? 2 : row.status === "in_progress" ? 1 : 0,
          subs: breakdown.subs || [], rec: breakdown.received || [],
          mats: breakdown.materials || [], x: breakdown.extra_costs || [],
          wh: breakdown.warehouse || null, matCost: Number(row.total_cost || 0), wc: 0
        };
      });
      const merged = mergeCloudRecords(S.po || [], cloudOrders);
      S.po = merged.arr; totalAdded += merged.added; recordConflicts += merged.conflicts;
    }
    if (prods?.length) {
      const cloudProducts = prods.map(p => {
        if (p.raw && typeof p.raw === "object" && !Array.isArray(p.raw)) {
          const raw = { ...p.raw };
          if (!raw.cloudId) raw.cloudId = String(p.external_id || raw.id || p.id);
          if (!raw.st || typeof raw.st !== "object" || Array.isArray(raw.st)) raw.st = {};
          return raw;
        }
        const qty = Number(p.qty || 0) || 0;
        const buy = Number(p.buy_price ?? p.price ?? 0) || 0;
        return {
          id: p.external_id || p.id, name: p.name, sku: p.sku || p.external_id || "",
          unit: p.unit || "قطعة", wh: p.warehouse || null,
          buy, retail: Number(p.retail_price || 0) || 0,
          wholesale: Number(p.wholesale_price || 0) || 0,
          img: p.image_url || "", st: qty ? { "-": qty } : {}, val: qty * buy
        };
      });
      if (!Array.isArray(S.items)) S.items = [];
      const m = mergeCloudProducts(S.items, cloudProducts);
      S.items = m.arr; totalAdded += m.added; recordConflicts += m.conflicts;
    }

    // Apply each authorized baseline section independently. A failed section does not advance its cursor.
    for (const [sectionName, row, applySection] of [
      ["inventory", inventoryBaselineRow, applyInventoryBaselineSection],
      ["accounting", accountingBaselineRow, applyAccountingBaselineSection]
    ]) {
      if (!row) continue;
      const cursorKey = "mgr6-cloud-baseline-" + sectionName + "-version";
      const localVersion = Number(localStorage.getItem(cursorKey) || 0);
      const remoteVersion = Number(row.baseline_version || 0);
      if (remoteVersion < localVersion) {
        recordConflicts++;
        continue;
      }
      if (remoteVersion === localVersion) continue;
      if (remoteVersion !== 1 || !row.section_payload || !applySection) {
        recordConflicts++;
        continue;
      }
      const applied = applySection(S, { ...row.section_payload, baselineVersion: remoteVersion,
        fingerprint: row.fingerprint });
      if (!applied.applied) {
        recordConflicts++;
        console.warn("Factory baseline section was not applied:", sectionName, applied.reason);
        continue;
      }
      localStorage.setItem(cursorKey, String(remoteVersion));
      totalAdded += Number(applied.movementsAdded || applied.accountsAdded || 0);
    }

    // Download role-redacted source effects after master records and baseline sections are ready.
    const effectsResult = await supabase.rpc("get_source_effects");
    const effectsRpcMissing = effectsResult.error && ["PGRST202", "42883"].includes(String(effectsResult.error.code || ""));
    if (effectsResult.error && !effectsRpcMissing) {
      return isAuto ? "cloud source effects read failed" : T("تعذر قراءة حركات المستندات: " + effectsResult.error.message, "Source effects read failed: " + effectsResult.error.message);
    }
    if (!effectsRpcMissing && Array.isArray(effectsResult.data) && effectsResult.data.length) {
      let versions = {};
      try { versions = JSON.parse(localStorage.getItem("mgr6-source-effect-versions") || "{}") || {}; } catch(e) {}
      const plan = planRemoteSourceEffectApply(S, effectsResult.data, versions);
      if (plan.invalid.length) {
        recordConflicts += plan.invalid.length;
      } else {
        for (const action of plan.actions) {
          const applied = applyCanonicalSourceEffect(S, action.effect);
          if (!applied.applied) {
            recordConflicts++;
            console.warn("Source effect was not applied:", action.effect.sourceType, action.effect.sourceId, applied.reason);
            continue;
          }
          versions[JSON.stringify([action.effect.sourceType, action.effect.sourceId])] = Number(action.version);
        }
        Object.assign(versions, plan.adoptedVersions);
        if (plan.conflicts.length) {
          recordConflicts += plan.conflicts.length;
          localStorage.setItem("mgr6-source-effect-conflicts", JSON.stringify(plan.conflicts));
        }
        localStorage.setItem("mgr6-source-effect-versions", JSON.stringify(versions));
      }
    }
    Object.getPrototypeOf(localStorage).setItem.call(localStorage, "mgr6", JSON.stringify(S));
    if (restoredSnapshot && isAuto) setTimeout(() => location.reload(), 500);
    if (recordConflicts) {
      return T("تم تحميل " + totalAdded + " سجل جديد. يوجد " + recordConflicts + " سجل بتعارض إصدار؛ احتفظنا بالنسختين ولم نستبدل بياناتك المحلية.", "Loaded " + totalAdded + " new records. " + recordConflicts + " cloud record conflict(s) were preserved without overwriting local data.");
    }
    if (isAuto) return "auto merged " + totalAdded;
    return T("تم التحميل - اتضاف " + totalAdded + " جديد", "Loaded - " + totalAdded + " new records");
  } catch(e) { console.error(e); return e.message; }
  finally { autoLoadRunning = false; }
}

// ===== التحميل التلقائي أول ما النت يرجع - زي ما اتفقنا =====
async function onInternetBack() {
  if (autoLoadRunning || uploadRunning) { scheduleAutoSync(1400); return "sync busy"; }
  // Revalidate the session profile before using cached offline permissions for cloud writes.
  myProfile = null; ownerIdCache = null; window.__factoryAuthProfile = null;
  const freshProfile = await getMyProfile();
  if (!freshProfile) { syncState = "idle"; drawAll(); return "profile revalidation failed"; }
  window.__factoryOfflineMode = false;
  syncState = "saving"; drawAll();
  // Pull first, but never let a snapshot conflict block independent detail-table uploads.
  const pulled = await loadFromTablesMerge(true);
  if (pulled === "cloud read failed" || String(pulled).startsWith("تعذر قراءة")) {
    syncState = "idle"; drawAll(); return pulled;
  }
  const pushed = await uploadToTables(false);
  if (String(pushed).startsWith("خطأ:") || String(pushed).includes("فشلت")) {
    syncState = localStorage.getItem("mgr6-cloud-snapshot-conflict") ? "conflict" : "idle"; drawAll();
    if (!localStorage.getItem("mgr6-cloud-snapshot-conflict")) scheduleAutoSync(2500);
    return pushed;
  }
  if (localStorage.getItem(PENDING_SYNC_KEY) && !localStorage.getItem("mgr6-cloud-snapshot-conflict")) scheduleAutoSync(800);
  return pushed;
}
const _origSetItem = localStorage.setItem.bind(localStorage);
localStorage.setItem = function(key, value) {
  _origSetItem(key, value);
  if (key === "mgr6") {
    markPendingSync();
    if (!navigator.onLine) { syncState = "offline"; drawAll(); }
    else scheduleAutoSync(1500);
  }
  if (key === "mgr6pref") setTimeout(drawAll, 100);
};
window.addEventListener("online", () => { retryCount = 0; scheduleAutoSync(500); });
window.addEventListener("offline", () => { syncState = "offline"; drawAll(); });
window.addEventListener("focus", () => { if (navigator.onLine && localStorage.getItem(PENDING_SYNC_KEY)) scheduleAutoSync(500); });
document.addEventListener("visibilitychange", () => { if (!document.hidden && navigator.onLine && localStorage.getItem(PENDING_SYNC_KEY)) scheduleAutoSync(500); });
setInterval(() => { if (navigator.onLine && localStorage.getItem(PENDING_SYNC_KEY) && !localStorage.getItem("mgr6-cloud-snapshot-conflict")) scheduleAutoSync(0); }, 60000);
if (navigator.onLine) {
  // Always refresh remote data on launch; pending local writes are retried automatically.
  scheduleAutoSync(1200);
}
window.restoreCloud = async function() {
  if (!confirm(T("هتحمّل البيانات من الجداول؟ هيتضاف الناقص بس، مش هيمسح حاجة", "Load from tables? Only missing will be added, nothing will be deleted"))) return;
  const r = await loadFromTablesMerge(false);
  alert(r);
  location.reload();
};
window.resolveCloudSnapshotConflict = async function() {
  if (!confirm(T("يوجد تعارض بين بيانات هذا الجهاز والنسخة السحابية. سيتم حفظ نسخة محلية احتياطية ثم استعادة النسخة السحابية. هل تريد المتابعة؟", "A conflict exists between this device and the cloud snapshot. A local backup will be saved before restoring the cloud copy. Continue?"))) return;
  if (!navigator.onLine || !supabase) return alert(T("يلزم اتصال بالإنترنت", "Internet connection required"));
  const profile = await getMyProfile();
  if (!profile?.is_admin) return alert(T("الاستعادة متاحة لمدير النظام فقط", "Only the administrator can resolve the full snapshot"));
  const owner = await getOwnerId();
  const { data: snapshot, error } = await supabase.from("factory_state")
    .select("state,sync_version").eq("user_id", owner).maybeSingle();
  if (error || !snapshot?.state) return alert(error?.message || T("لا توجد نسخة سحابية للاستعادة", "No cloud snapshot found"));
  try {
    localStorage.setItem("mgr6-backup-before-cloud-restore", localStorage.getItem("mgr6") || "");
  } catch(e) {
    return alert(T("تعذر حفظ النسخة الاحتياطية؛ لم يتم استبدال البيانات", "Could not save the local backup; no data was replaced"));
  }
  Object.getPrototypeOf(localStorage).setItem.call(localStorage, "mgr6", JSON.stringify(snapshot.state));
  localStorage.setItem("mgr6-cloud-snapshot-version", String(snapshot.sync_version || 1));
  localStorage.setItem("mgr6-cloud-snapshot-pend", String(Number(snapshot.state.pend || 0)));
  localStorage.removeItem("mgr6-cloud-snapshot-conflict");
  location.reload();
};
window.backupNowManual = function() { uploadToTables(true); };
window.testSync = async function() { const r = await uploadToTables(true); alert(r); return r; };

// ===== صلاحيات - متوقفة مؤقتاً عشان ترجع القايمة - مش بتخفي حاجة دلوقتي =====
async function enforcePermissions() {
  try {
    const profile = await getMyProfile();
    if (profile && typeof window.setFactoryAuthProfile === "function") window.setFactoryAuthProfile(profile);
    const card = document.getElementById("ms-emp-in-tab");
    if (card && !isAdmin()) card.remove();
  } catch(e) { console.error("Permission enforcement failed:", e); }
}

// ===== الموظفين من تابة الموظفين - للمدير بس =====
const PERMS = [
  { key: "invoices", ar: "الفواتير", en: "Invoices" },
  { key: "inventory", ar: "المخزون", en: "Inventory" },
  { key: "customers", ar: "العملاء", en: "Customers" },
  { key: "suppliers", ar: "الموردين", en: "Suppliers" },
  { key: "production", ar: "الإنتاج", en: "Production" },
  { key: "reports", ar: "التقارير", en: "Reports" },
  { key: "settings", ar: "الإعدادات", en: "Settings" },
];
function isEmployeesTabOpen() {
  const m = document.getElementById("m");
  if (!m) return false;
  const txt = m.textContent || "";
  const activeTab = document.querySelector('[data-tab="emp"], [data-tab="employees"], .tab.active');
  if (activeTab && (activeTab.textContent.includes("موظف") || activeTab.textContent.includes("Employee"))) return true;
  return txt.includes("الموظفين") || txt.includes("Employees") || txt.includes("إضافة موظف") || txt.includes("Add Employee");
}
async function employeeErrorText(error) {
  try {
    const body = await error.context.json();
    if (body?.error) return body.error;
  } catch(e){}
  return error.message;
}
async function injectEmployeeAccountForm() {
  if (!isEmployeesTabOpen()) return;
  const p = await getMyProfile();
  if (!p || !isAdmin()) return;
  const m = document.getElementById("m");
  if (!m) return;
  if (document.getElementById("ms-emp-in-tab")) return;
  const box = document.createElement("div");
  box.id = "ms-emp-in-tab";
  box.style.cssText = "background:#f0fdfa;border:2px solid #0f766e;border-radius:16px;padding:16px;margin:0 0 16px 0;direction:" + (isEN() ? "ltr" : "rtl") + ";";
  box.innerHTML = `
    <h3 style="margin:0 0 8px;color:#0f766e;">${T("🔑 عمل حساب دخول لموظف", "🔑 Create login account for employee")}</h3>
    <p style="margin:0 0 12px;color:#666;font-size:13px;">${T("الموظف هيدخل بالاسم مش بالإيميل، وهيطلب منه باسورد جديد أول مرة", "Employee logs in with username, not email, and will be asked for a new password on first login")}</p>
    <div style="display:grid;gap:10px;grid-template-columns:${isMobile() ? "1fr" : "1fr 1fr"};">
      <input id="ms-emp-user" placeholder="${T("اسم المستخدم - مثال: ahmed.ali", "Username - e.g. ahmed.ali")}" style="padding:10px;border:1px solid #ddd;border-radius:10px;width:100%;box-sizing:border-box;" />
      <input id="ms-emp-full" placeholder="${T("الاسم الكامل - أحمد علي", "Full Name - Ahmed Ali")}" style="padding:10px;border:1px solid #ddd;border-radius:10px;width:100%;box-sizing:border-box;" />
      <input id="ms-emp-pass" type="password" autocomplete="new-password" placeholder="${T("كلمة مرور مؤقتة (10 أحرف على الأقل)", "Temporary password (10+ characters)")}" style="padding:10px;border:1px solid #ddd;border-radius:10px;width:100%;box-sizing:border-box;" />
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        ${PERMS.map(p => `<label style="background:#fff;padding:5px 10px;border-radius:20px;cursor:pointer;font-size:12px;border:1px solid #ddd;"><input type="checkbox" value="${p.key}" checked style="margin-inline-end:5px;">${isEN() ? p.en : p.ar}</label>`).join("")}
      </div>
    </div>
    <button id="ms-emp-create" style="margin-top:12px;background:#0f766e;color:#fff;border:none;padding:12px 20px;border-radius:12px;font-weight:bold;cursor:pointer;width:${isMobile() ? "100%" : "auto"};">${T("إنشاء حساب دخول ✅", "Create Login Account ✅")}</button>
    <p id="ms-emp-msg" style="margin:8px 0 0;color:#0f766e;font-weight:bold;font-size:13px;"></p>
  `;
  m.prepend(box);
  document.getElementById("ms-emp-create").onclick = async () => {
    const username = document.getElementById("ms-emp-user").value.trim().toLowerCase();
    const fullName = document.getElementById("ms-emp-full").value.trim();
    const pass = document.getElementById("ms-emp-pass").value;
    const msg = document.getElementById("ms-emp-msg");
    if (!username) return msg.textContent = T("اكتب اسم المستخدم", "Enter username");
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) return msg.textContent = T("اسم المستخدم يجب أن يكون من 3 إلى 40 حرفاً إنجليزياً أو رقماً أو . _ -", "Username must be 3-40 characters: a-z, 0-9, dot, underscore or hyphen");
    if (pass.length < 10) return msg.textContent = T("كلمة المرور يجب ألا تقل عن 10 أحرف", "Password must contain at least 10 characters");
    const perms = {};
    box.querySelectorAll("input[type=checkbox]:checked").forEach(c => perms[c.value] = true);
    msg.textContent = T("جارٍ الإنشاء...", "Creating...");
    try {
      const { data, error } = await supabase.functions.invoke("create-employee-account", {
        body: { username, full_name: fullName, password: pass, permissions: perms }
      });
      if (error) throw new Error(await employeeErrorText(error));
      if (!data?.success) throw new Error(data?.error || T("تعذر إنشاء الحساب", "Could not create account"));
      msg.textContent = T("تم إنشاء الحساب " + username + " بنجاح. سلّم كلمة المرور له بشكل منفصل.", "Account " + username + " created. Share the password securely and separately.");
      document.getElementById("ms-emp-pass").value = "";
    } catch(e) { msg.textContent = e.message; console.error(e); }
  };
}
setInterval(() => {
  if (isEmployeesTabOpen()) injectEmployeeAccountForm();
  else { const old = document.getElementById("ms-emp-in-tab"); if (old) old.remove(); }
  enforcePermissions();
}, 2000);

// ===== الشريط زي ما هو - حباية + ✕ بس =====
async function doLogout() {
  if (!confirm(T("متأكد عايز تسجل خروج؟", "Are you sure you want to logout?"))) return;
  try { await supabase.auth.signOut(); } catch(e){}
  sessionStorage.removeItem("ms-loaded-from-tables");
  location.href = "auth.html";
}
// إخفاء شريط مسجل الدخول - النسخة الصح: بنخفي الشريط كله مش السطر بس
function purgeLoggedInText() {
  try {
    const all = document.querySelectorAll("body *");
    for (const el of all) {
      if (el.id === "ms-topbar" || el.closest("#ms-topbar") || el.id === "ms-recovery") continue;
      const txt = el.textContent || "";
      if (txt.includes("مسجل الدخول باسم")) {
        // اطلع لفوق لحد ما نلاقي الشريط - الشريط ارتفاعه صغير وعرضه كبير
        let bar = el;
        let guard = 0;
        while (bar.parentElement && bar.parentElement !== document.body && guard < 6) {
          const parent = bar.parentElement;
          const parentTxt = parent.textContent || "";
          if (!parentTxt.includes("مسجل الدخول باسم")) break;
          // لو الأب هو body أو #m أو كبير جداً، وقف
          if (parent.id === "m" || parent.id === "app" || parent.tagName === "MAIN") break;
          bar = parent;
          guard++;
          try {
            const h = bar.getBoundingClientRect().height;
            if (h > 100) break;
          } catch(e){}
        }
        try {
          const rect = bar.getBoundingClientRect();
          // متخفيش حاجة كبيرة - الشريط بس اللي ارتفاعه أقل من 100
          if (rect.height < 100 && rect.width > 200) {
            bar.style.display = "none";
            bar.style.visibility = "hidden";
            bar.style.height = "0px";
            bar.style.padding = "0";
            bar.style.margin = "0";
            bar.style.overflow = "hidden";
          }
        } catch(e){}
      }
      // زرار تسجيل خروج اللي جوه الشريط ده - اخفيه برضه
      if ((el.textContent || "").trim() === "تسجيل خروج" && el.closest("div")) {
        const p = el.closest("div");
        if (p && (p.textContent || "").includes("مسجل الدخول باسم")) {
          p.style.display = "none";
        }
      }
    }
  } catch(e){}
}
const observer = new MutationObserver(() => { purgeLoggedInText(); });
try { observer.observe(document.body, { childList: true, subtree: true, characterData: true }); } catch(e){}

// ===== زرار إصلاح لو الشاشة فضلت بيضا =====
function checkWhiteScreen() {
  try {
    const m = document.getElementById("m");
    if (!m) return;
    const isEmpty = (m.innerText || "").trim().length < 20 && m.children.length <= 1;
    if (!isEmpty) {
      const old = document.getElementById("ms-recovery");
      if (old) old.remove();
      return;
    }
    if (document.getElementById("ms-recovery")) return;
    const box = document.createElement("div");
    box.id = "ms-recovery";
    box.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:999999;background:#fff;border:2px solid #ef4444;border-radius:16px;padding:16px;box-shadow:0 10px 30px rgba(0,0,0,.3);text-align:center;max-width:92%;direction:" + (isEN() ? "ltr" : "rtl");
    box.innerHTML = `
      <div style="font-weight:bold;color:#ef4444;margin-bottom:8px;">${T("⚠️ الشاشة فاضية - الكاش بايظ", "⚠️ Blank screen - cache is broken")}</div>
      <div style="font-size:13px;color:#555;margin-bottom:12px;">${T("دوس هنا هنرجع الداتا من السحابة، ومش هنمسح حاجة", "Click here to restore from cloud, nothing will be deleted")}</div>
      <button id="ms-recovery-btn" style="background:#0f766e;color:#fff;border:none;padding:12px 20px;border-radius:12px;font-weight:bold;cursor:pointer;width:100%;">${T("🔧 إصلاح واستعادة من السحابة", "🔧 Fix & Restore from Cloud")}</button>
    `;
    document.body.appendChild(box);
    document.getElementById("ms-recovery-btn").onclick = async () => {
      const btn = document.getElementById("ms-recovery-btn");
      btn.textContent = T("جارٍ الاستعادة...", "Restoring...");
      // امسح الكاش البايظ وخلي التلقائي يحمل من السحابة
      try {
        const cur = localStorage.getItem("mgr6");
        if (cur) localStorage.setItem("mgr6-backup-v28", cur);
        localStorage.removeItem("mgr6");
      } catch(e){}
      const r = await loadFromTablesMerge(false);
      alert(r);
      location.reload();
    };
  } catch(e){}
}
setInterval(checkWhiteScreen, 3000);
setTimeout(checkWhiteScreen, 4000);

function drawAll() {
  purgeLoggedInText();
  // Keep logout available, but remove the synchronization toolbar and manual controls.
  let logout = document.getElementById('ms-logout-btn');
  if (!logout) {
    logout = document.createElement('button');
    logout.id = 'ms-logout-btn';
    logout.type = 'button';
    logout.onclick = doLogout;
    document.body.appendChild(logout);
  }
  logout.textContent = '↪';
  logout.title = T('تسجيل الخروج', 'Logout');
  logout.setAttribute('aria-label', logout.title);
  logout.style.cssText = 'position:fixed;top:8px;' + (isEN() ? 'right:8px;left:auto;' : 'left:8px;right:auto;') + 'width:34px;height:34px;min-width:34px;padding:0;z-index:100000;background:#ef4444;color:#fff;border:0;border-radius:8px;font-size:19px;font-weight:bold;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.18);';
  const netStatus = document.getElementById('net-status');
  if (netStatus) netStatus.textContent = navigator.onLine ? '🟢 متصل' : '🔴 غير متصل';
  const syncIcon = document.getElementById('sync-icon');
  if (syncIcon) { syncIcon.classList.toggle('syncing', syncState === 'saving'); syncIcon.title = syncState === 'saving' ? T('جارٍ المزامنة', 'Synchronizing') : T('المزامنة التلقائية', 'Automatic sync'); }
  const oldToolbar = document.getElementById('ms-topbar');
  if (oldToolbar) oldToolbar.remove();
  document.body.style.paddingTop = '';
  lastLang = isEN() ? 'en' : 'ar';
  lastMode = isMobile() ? 'mobile' : 'desktop';
}
setInterval(() => {
  const logout = document.getElementById("ms-logout-btn");
  const cur = isEN() ? "en" : "ar";
  const mode = isMobile() ? "mobile" : "desktop";
  if (!logout || cur !== lastLang || mode !== lastMode) drawAll();
  else purgeLoggedInText();
}, 500);
window.addEventListener("resize", () => drawAll());
drawAll();
console.log("☁️ Cloud Sync V28 شغال - إصلاح الشاشة البيضا");
