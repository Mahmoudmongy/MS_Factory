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

    // Only the administrator may upload the complete factory snapshot.
    // Optimistic locking prevents a stale device from replacing a newer device snapshot.
    if (admin) {
      if (localStorage.getItem("mgr6-cloud-snapshot-conflict")) {
        syncState = "conflict"; drawAll();
        return T("توجد نسخة سحابية أحدث. لم يتم رفع بيانات هذا الجهاز حتى لا نفقد أي تغييرات.", "A newer cloud snapshot exists. This device was not uploaded to avoid data loss.");
      }
      const expectedVersion = Number(localStorage.getItem("mgr6-cloud-snapshot-version") || 0);
      const result = await supabase.rpc("sync_factory_state", {
        p_expected_version: expectedVersion,
        p_state: S
      });
      snapshotError = result.error;
      if (snapshotError) {
        if (snapshotError.code === "40001") {
          localStorage.setItem("mgr6-cloud-snapshot-conflict", JSON.stringify({ reason: "stale_snapshot", at: new Date().toISOString() }));
        }
        errors.push("factory_state: " + (snapshotError.code === "40001"
          ? "تعارض نسخة: توجد نسخة أحدث على السحابة؛ لم يتم استبدالها"
          : snapshotError.message));
      } else {
        const snapshotRow = Array.isArray(result.data) ? result.data[0] : result.data;
        if (!snapshotRow?.sync_version) errors.push("factory_state: server returned no snapshot version");
        else {
          localStorage.setItem("mgr6-cloud-snapshot-version", String(snapshotRow.sync_version));
          localStorage.setItem("mgr6-cloud-snapshot-pend", String(Number(S.pend || 0)));
          localStorage.removeItem("mgr6-cloud-snapshot-conflict");
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
          external_id: String(getField(p, ["id", "no", "code"]) || name),
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
          const externalId = String(getField(pr, ["id", "code", "sku"]) || name);
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

    if (errors.length) {
      syncState = "idle"; drawAll();
      const msg = snapshotError
        ? T("فشل حفظ النسخة الكاملة وبعض الجداول:\n", "Full backup and some table writes failed:\n") + errors.join("\n")
        : T("بعض عمليات المزامنة فشلت:\n", "Some sync operations failed:\n") + errors.join("\n");
      if (showAlert) alert(msg);
      return msg;
    }
    // Non-admin accounts still lack cloud persistence for the complete accounting ledger and several modules.
    // Never display the green "Synced" state for a detail-only employee sync.
    syncState = admin ? "synced" : "partial";
    lastSyncTime = new Date().toLocaleTimeString(isEN() ? "en-US" : "ar-EG");
    drawAll();
    const msg = admin
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
    const [{ data: custs }, { data: supps }, { data: invs }, { data: prods }, { data: returns }, { data: vouchers }, { data: productionOrders }] = results;
    if (!custs?.length && !supps?.length && !invs?.length && !prods?.length && !returns?.length && !vouchers?.length && !productionOrders?.length) {
      if (restoredSnapshot && isAuto) setTimeout(() => location.reload(), 500);
      return restoredSnapshot
        ? T("تمت استعادة نسخة المصنع الكاملة من السحابة", "Full factory backup restored from cloud")
        : (isAuto ? "cloud empty - keep local" : T("مفيش بيانات في السحابة", "No data in cloud"));
    }

    const S = getCachedState();
    if (!S || typeof S !== "object" || Array.isArray(S)) return "bad local";
    let totalAdded = 0;
    const cloudPartners = [
      ...(custs || []).map(c => ({ id: c.external_id, name: c.name, phone: c.phone, email: c.email, addr: c.address, type: "customer" })),
      ...(supps || []).map(s => ({ id: s.external_id, name: s.name, phone: s.phone, email: s.email, addr: s.address, type: "supplier" })),
    ];
    if (cloudPartners.length) {
      const m = mergeByKey(S.partners || [], cloudPartners, x => x.id || x.name);
      S.partners = m.arr; totalAdded += m.added;
    }
    let recordConflicts = 0;
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
      const m = mergeByKey(S.items, cloudProducts, x => x.id || x.sku || x.name);
      S.items = m.arr; totalAdded += m.added;
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
  if (autoLoadRunning || syncState === "saving") return;
  // Revalidate the session profile before using cached offline permissions for cloud writes.
  myProfile = null; ownerIdCache = null; window.__factoryAuthProfile = null;
  const freshProfile = await getMyProfile();
  if (!freshProfile) { syncState = "idle"; drawAll(); return "profile revalidation failed"; }
  window.__factoryOfflineMode = false;
  syncState = "saving"; drawAll();
  // Always pull first: localStorage is the offline workspace, not proof it is newer.
  // The merge is append-only for master data and version-aware for invoices.
  const pulled = await loadFromTablesMerge(true);
  if (pulled === "cloud snapshot conflict") {
    syncState = "conflict"; drawAll(); return pulled;
  }
  if (pulled === "cloud read failed" || String(pulled).startsWith("تعذر قراءة")) {
    syncState = "idle"; drawAll(); return pulled;
  }
  // Then upload the merged local state so offline-created records reach the cloud.
  const pushed = await uploadToTables(false);
  if (String(pushed).startsWith("خطأ:") || String(pushed).includes("فشلت")) {
    syncState = "idle"; drawAll(); return pushed;
  }
  return pushed;
}
const _origSetItem = localStorage.setItem.bind(localStorage);
localStorage.setItem = function(key, value) {
  _origSetItem(key, value);
  if (key === "mgr6") {
    if (!navigator.onLine) { syncState = "offline"; drawAll(); }
    else { clearTimeout(saveTimer); saveTimer = setTimeout(() => uploadToTables(false), 1500); }
  }
  if (key === "mgr6pref") setTimeout(drawAll, 100);
};
window.addEventListener("online", () => onInternetBack());
window.addEventListener("offline", () => { syncState = "offline"; drawAll(); });
if (navigator.onLine) {
  // On every launch, fetch the latest remote records before pushing the device cache.
  setTimeout(() => onInternetBack(), 1200);
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
  const en = isEN();
  const mobile = isMobile();
  let top = document.getElementById("ms-topbar");
  if (!top) { top = document.createElement("div"); top.id = "ms-topbar"; document.body.prepend(top); }
  top.style.cssText = "position:fixed;top:0;left:0;right:0;width:100%;height:36px;z-index:100000;display:flex;align-items:center;justify-content:center;background:transparent;direction:ltr;box-sizing:border-box;";
  top.innerHTML = "";
  const x = document.createElement("button");
  x.id = "ms-logout-btn"; x.textContent = "✕"; x.title = en ? "Logout" : "تسجيل الخروج"; x.onclick = doLogout;
  if (en) x.style.cssText = "position:absolute;top:0;right:0;left:auto;width:36px;height:36px;min-width:36px;max-width:36px;min-height:36px;max-height:36px;background:#ef4444;color:#fff;border:none;border-radius:0;font-size:18px;font-weight:bold;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;";
  else x.style.cssText = "position:absolute;top:0;left:0;right:auto;width:36px;height:36px;min-width:36px;max-width:36px;min-height:36px;max-height:36px;background:#ef4444;color:#fff;border:none;border-radius:0;font-size:18px;font-weight:bold;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;";
  const b = document.createElement("div");
  b.id = "cloud-badge";
  let label = "";
  let bg = "#0f766e";
  if (!navigator.onLine || syncState === "offline") { label = T("💾 محفوظ في الجهاز - مفيش نت", "💾 Saved on device - offline"); bg = "#f59e0b"; }
  else if (syncState === "saving") { label = T("⏳ جاري الرفع...", "⏳ Uploading..."); bg = "#3b82f6"; }
  else if (syncState === "partial") { label = T("⚠️ مزامنة جزئية", "⚠️ Partial sync"); bg = "#b45309"; }
  else if (syncState === "synced") { label = mobile ? T("☁️ متزامن", "☁️ Synced") : `${T("☁️ متزامن", "☁️ Synced")} ${lastSyncTime}`; bg = "#0f766e"; }
  else { label = T("☁️ متصل - في انتظار المزامنة", "☁️ Online - waiting to sync"); bg = "#64748b"; }
  const s1 = document.createElement("span"); s1.textContent = label; s1.style.whiteSpace = "nowrap";
  const s2 = document.createElement("span"); s2.textContent = T("رفع الآن", "Upload Now");
  s2.style.cssText = "background:#fff;color:#0f766e;padding:2px 10px;border-radius:12px;cursor:pointer;white-space:nowrap;" + (mobile ? "font-size:11px;" : "");
  s2.onclick = (e) => { e.stopPropagation(); uploadToTables(true); };
  const s3 = document.createElement("span"); s3.textContent = T("تحميل", "Load");
  s3.style.cssText = "background:#fff;color:#0f766e;padding:2px 10px;border-radius:12px;cursor:pointer;white-space:nowrap;" + (mobile ? "font-size:11px;" : "");
  s3.onclick = (e) => { e.stopPropagation(); window.restoreCloud(); };
  b.appendChild(s1); b.appendChild(s2); b.appendChild(s3);
  b.style.cssText = `background:${bg};color:#fff;padding:6px 12px;border-radius:20px;display:flex;gap:${mobile ? "6px" : "8px"};align-items:center;justify-content:center;flex-wrap:nowrap;white-space:nowrap;font-size:${mobile ? "11px" : "13px"};font-weight:bold;direction:${en ? "ltr" : "rtl"};box-shadow:0 2px 10px rgba(0,0,0,.3);max-width:calc(100% - 80px);overflow:hidden;`;
  top.appendChild(b);
  top.appendChild(x);
  document.body.style.paddingTop = "36px";
  lastLang = en ? "en" : "ar";
  lastMode = mobile ? "mobile" : "desktop";
}
setInterval(() => {
  const top = document.getElementById("ms-topbar");
  const cur = isEN() ? "en" : "ar";
  const mode = isMobile() ? "mobile" : "desktop";
  if (!top || cur !== lastLang || mode !== lastMode) drawAll();
  else purgeLoggedInText();
}, 500);
window.addEventListener("resize", () => drawAll());
drawAll();
console.log("☁️ Cloud Sync V28 شغال - إصلاح الشاشة البيضا");
