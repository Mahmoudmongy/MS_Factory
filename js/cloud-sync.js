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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (error || !data) return null;
  myProfile = data;
  return myProfile;
}
async function getOwnerId() {
  if (ownerIdCache) return ownerIdCache;
  const p = await getMyProfile();
  if (!p) return null;
  ownerIdCache = p.created_by || p.id;
  return ownerIdCache;
}
function isAdmin() { return !!myProfile && !myProfile.created_by; }
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
    if (!S || typeof S !== "object") return true;
    const hasPartners = (Array.isArray(S.partners) && S.partners.length > 0) || (Array.isArray(S.customers) && S.customers.length > 0);
    const hasDocs = Array.isArray(S.docs) && S.docs.length > 0;
    const hasProds = (Array.isArray(S.products) && S.products.length > 0) || (Array.isArray(S.prods) && S.prods.length > 0);
    const hasItems = Array.isArray(S.items) && S.items.length > 0;
    return !(hasPartners || hasDocs || hasProds || hasItems);
  } catch(e){ return true; }
}
function mergeByKey(existing, incoming, keyFn) {
  const map = new Map();
  (existing || []).forEach(it => { try { const k = keyFn(it); if (k) map.set(String(k), it); } catch(e){} });
  let added = 0;
  (incoming || []).forEach(it => { try { const k = keyFn(it); if (k && !map.has(String(k))) { map.set(String(k), it); added++; } } catch(e){} });
  return { arr: [...map.values()], added };
}

// ===== الرفع مرة واحدة على الجداول - الكاش هو الأساس =====
async function uploadToTables(showAlert = false) {
  if (!navigator.onLine) {
    syncState = "offline"; drawAll();
    if (showAlert) alert(T("مفيش إنترنت - محفوظ في الجهاز، وهيترفع أول ما النت يرجع 💾", "No internet - saved on device, will upload when online 💾"));
    return "offline";
  }
  syncState = "saving"; drawAll();
  try {
    const owner = await getOwnerId();
    if (!owner) { syncState = "idle"; drawAll(); return "no user"; }
    const S = getCachedState();
    let c = 0, s = 0, inv = 0, items = 0, prod = 0;
    let errors = [];
    const partnerArrays = [];
    if (Array.isArray(S.partners)) partnerArrays.push({ key: "partners", arr: S.partners });
    if (Array.isArray(S.customers)) partnerArrays.push({ key: "customers", arr: S.customers });
    if (Array.isArray(S.suppliers)) partnerArrays.push({ key: "suppliers", arr: S.suppliers });
    if (Array.isArray(S.clients)) partnerArrays.push({ key: "clients", arr: S.clients });
    for (const { key, arr } of partnerArrays) {
      for (const p of arr) {
        const name = String(getField(p, ["name", "nm", "title"]) || "");
        if (!name || isAccountName(name)) continue;
        const typeStr = (getField(p, ["type", "kind", "cat", "category"]) || "").toString().toLowerCase();
        if (typeStr.includes("account") || typeStr.includes("coa") || typeStr.includes("chart") || typeStr.includes("حساب")) continue;
        const isSup = typeStr.includes("supp") || typeStr.includes("مورد") || p.isSupplier === true || key === "suppliers";
        const row = { user_id: owner, external_id: String(getField(p, ["id", "no", "code"]) || name), name, phone: String(getField(p, ["phone", "tel", "mobile", "ph"]) || "") || null, email: String(getField(p, ["email", "mail"]) || "") || null, address: String(getField(p, ["addr", "address", "add"]) || "") || null };
        const table = isSup ? "suppliers" : "customers";
        const { error } = await supabase.from(table).upsert(row, { onConflict: 'user_id,external_id' });
        if (error) errors.push(table + ": " + error.message);
        else { if (isSup) s++; else c++; }
      }
    }
    const docs = S.docs || S.invoices || [];
    if (Array.isArray(docs)) {
      for (const d of docs) {
        if (!d) continue;
        const extId = String(getField(d, ["id", "no", "num", "code", "invNo"]) || Date.now());
        const custName = String(getField(d, ["customer", "cust", "partner", "client", "name"]) || "");
        if (custName && isAccountName(custName)) continue;
        const total = Number(getField(d, ["total", "tot", "grandTotal", "amount", "sum"]) || 0) || 0;
        if (d.items || d.lines || d.details || total > 0 || custName) {
          const row = { user_id: owner, external_id: extId, customer_name: custName || null, total, raw: d };
          const { error } = await supabase.from('invoices').upsert(row, { onConflict: 'user_id,external_id' });
          if (error) errors.push("invoices: " + error.message);
          else inv++;
          const { data: invRow } = await supabase.from('invoices').select('id').eq('user_id', owner).eq('external_id', extId).maybeSingle();
          if (invRow) {
            await supabase.from('invoice_items').delete().eq('invoice_id', invRow.id);
            const its = d.items || d.lines || d.details || [];
            if (Array.isArray(its) && its.length) {
              const toInsert = its.map(it => ({ user_id: owner, invoice_id: invRow.id, product_name: String(getField(it, ["name", "product", "item", "title"]) || ""), qty: Number(getField(it, ["qty", "q", "quantity"]) || 1) || 1, price: Number(getField(it, ["price", "pr", "unit"]) || 0) || 0, total: Number(getField(it, ["total", "tot", "amount"]) || 0) || 0 }));
              const { error: ie } = await supabase.from('invoice_items').insert(toInsert);
              if (!ie) items += toInsert.length;
            }
          }
        }
      }
    }
    const prodArrays = [];
    if (Array.isArray(S.products)) prodArrays.push(S.products);
    if (Array.isArray(S.prods)) prodArrays.push(S.prods);
    for (const arr of prodArrays) {
      for (const pr of arr) {
        const name = String(getField(pr, ["name", "title", "product"]) || "");
        if (!name || isAccountName(name)) continue;
        const row = { user_id: owner, external_id: String(getField(pr, ["id", "code", "sku"]) || name), name, qty: Number(getField(pr, ["qty", "q", "stock", "balance"]) || 0) || 0, price: Number(getField(pr, ["price", "pr", "unit"]) || 0) || 0, raw: pr };
        const { error } = await supabase.from('products').upsert(row, { onConflict: 'user_id,external_id' });
        if (!error) prod++;
      }
    }
    if (errors.length) { syncState = "idle"; drawAll(); if (showAlert) alert(T("اترفع بس فيه أخطاء:\n" + errors.join("\n"), "Uploaded with errors")); return "errors"; }
    syncState = "synced";
    lastSyncTime = new Date().toLocaleTimeString(isEN() ? 'en-US' : 'ar-EG');
    drawAll();
    const msg = `تم ✅ - ${c} عميل + ${s} مورد + ${inv} فاتورة + ${items} صنف + ${prod} منتج`;
    if (showAlert) alert(msg);
    return msg;
  } catch(e) { console.error(e); syncState = "idle"; drawAll(); if (showAlert) alert(e.message); return "خطأ: " + e.message; }
}

// ===== التحميل - دمج آمن، مع نسخة احتياطية قبل أي كتابة =====
async function loadFromTablesMerge(isAuto = false) {
  if (autoLoadRunning) return "already running";
  autoLoadRunning = true;
  try {
    const owner = await getOwnerId();
    if (!owner) return "no user";
    // نسخة احتياطية قبل أي حاجة - عشان لو الكاش باظ نرجعه
    try {
      const cur = localStorage.getItem("mgr6");
      if (cur) localStorage.setItem("mgr6-backup-v28", cur);
    } catch(e){}
    const results = await Promise.all([
      supabase.from('customers').select('*').eq('user_id', owner),
      supabase.from('suppliers').select('*').eq('user_id', owner),
      supabase.from('invoices').select('*').eq('user_id', owner),
      supabase.from('products').select('*').eq('user_id', owner),
    ]);
    const failed = results.find(r => r.error);
    if (failed) return isAuto ? "cloud read failed" : T("تعذر قراءة البيانات من السحابة: " + failed.error.message, "Cloud read failed: " + failed.error.message);
    const [{ data: custs }, { data: supps }, { data: invs }, { data: prods }] = results;
    if ((!custs?.length && !supps?.length && !invs?.length && !prods?.length)) {
      return isAuto ? "cloud empty - keep local" : T("مفيش بيانات في السحابة", "No data in cloud");
    }
    const S = getCachedState();
    if (!S || typeof S !== "object") return "bad local";
    let totalAdded = 0;
    const cloudPartners = [
      ...(custs || []).map(c => ({ id: c.external_id, name: c.name, phone: c.phone, email: c.email, addr: c.address, type: "customer" })),
      ...(supps || []).map(s => ({ id: s.external_id, name: s.name, phone: s.phone, email: s.email, addr: s.address, type: "supplier" })),
    ];
    if (cloudPartners.length) {
      const m = mergeByKey(S.partners || [], cloudPartners, x => x.id || x.name);
      S.partners = m.arr; totalAdded += m.added;
    }
    if (invs?.length) {
      const cloudDocs = invs.map(inv => inv.raw || { id: inv.external_id, customer: inv.customer_name, total: inv.total, items: [] });
      if (!Array.isArray(S.docs)) S.docs = [];
      const m = mergeByKey(S.docs, cloudDocs, x => x.id || x.no);
      S.docs = m.arr; totalAdded += m.added;
    }
    if (prods?.length) {
      const cloudProds = prods.map(p => p.raw || { id: p.external_id, name: p.name, qty: p.qty, price: p.price });
      if (!Array.isArray(S.products)) S.products = [];
      const m = mergeByKey(S.products, cloudProds, x => x.id || x.name);
      S.products = m.arr; totalAdded += m.added;
    }
    Object.getPrototypeOf(localStorage).setItem.call(localStorage, "mgr6", JSON.stringify(S));
    if (isAuto) {
      if (totalAdded > 0) {
        console.log("☁️ Auto-load added", totalAdded);
        setTimeout(() => { if (isLocalEmpty()) location.reload(); }, 800);
      }
      return "auto merged " + totalAdded;
    }
    return T(`تم التحميل - اتضاف ${totalAdded} جديد`, `Loaded - ${totalAdded} new added`);
  } catch(e){ console.error(e); return e.message; }
  finally { autoLoadRunning = false; }
}

// ===== التحميل التلقائي أول ما النت يرجع - زي ما اتفقنا =====
async function onInternetBack() {
  if (isLocalEmpty()) {
    syncState = "saving"; drawAll();
    await loadFromTablesMerge(true);
    syncState = "synced"; drawAll();
  } else {
    await uploadToTables(false);
  }
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
if (navigator.onLine && isLocalEmpty()) {
  setTimeout(() => onInternetBack(), 1200);
}
window.restoreCloud = async function() {
  if (!confirm(T("هتحمّل البيانات من الجداول؟ هيتضاف الناقص بس، مش هيمسح حاجة", "Load from tables? Only missing will be added, nothing will be deleted"))) return;
  const r = await loadFromTablesMerge(false);
  alert(r);
  location.reload();
};
window.backupNowManual = function() { uploadToTables(true); };
window.testSync = async function() { const r = await uploadToTables(true); alert(r); return r; };

// ===== صلاحيات - متوقفة مؤقتاً عشان ترجع القايمة - مش بتخفي حاجة دلوقتي =====
async function enforcePermissions() {
  // V28: وقفنا الإخفاء عشان القايمة كانت بتختفي والشاشة بتبيض
  // بنرجع أي زرار اتخفى قبل كده
  try {
    document.querySelectorAll("nav button, aside button, .sidebar button, [data-tab]").forEach(el => {
      if (el.style.display === "none") el.style.display = "";
    });
    const card = document.getElementById("ms-emp-in-tab");
    // كارت الموظفين هنسيبه للمدير بس، مش هنمسحه من هنا
    await getMyProfile();
    if (card && !isAdmin()) card.remove();
  } catch(e){}
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
      <input id="ms-emp-pass" value="123456" style="padding:10px;border:1px solid #ddd;border-radius:10px;width:100%;box-sizing:border-box;" />
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
    const pass = document.getElementById("ms-emp-pass").value || "123456";
    const msg = document.getElementById("ms-emp-msg");
    if (!username) return msg.textContent = T("اكتب اسم المستخدم", "Enter username");
    if (!/^[a-z0-9._-]+$/.test(username)) return msg.textContent = T("الاسم لازم حروف إنجليزي وأرقام ونقطة بس", "Username must be english letters, numbers and dots only");
    const perms = {};
    box.querySelectorAll("input[type=checkbox]:checked").forEach(c => perms[c.value] = true);
    msg.textContent = T("جارٍ الإنشاء...", "Creating...");
    try {
      const { error } = await supabase.functions.invoke('create-employee', { body: { username, full_name: fullName, password: pass, permissions: perms } });
      if (error) throw new Error(await employeeErrorText(error));
      msg.textContent = T(`تم ✅ - يدخل بالاسم: ${username} والباسورد: ${pass}`, `Done ✅ - Login with: ${username} / ${pass}`);
      alert(T(`تم إضافة ${username} ✅`, `Added ${username} ✅`));
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
  else if (syncState === "synced") { label = mobile ? T("☁️ متزامن", "☁️ Synced") : `${T("☁️ متزامن", "☁️ Synced")} ${lastSyncTime}`; bg = "#0f766e"; }
  else { label = T("☁️ متزامن", "☁️ Synced"); bg = "#0f766e"; }
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
