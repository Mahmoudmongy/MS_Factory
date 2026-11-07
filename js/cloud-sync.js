// js/cloud-sync.js - V21 - صلاحيات + بيانات مشتركة - Dynamic + AR/EN + PC/Mobile
import { supabase } from './supabase.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

let saveTimer = null;
let lastSyncTime = "";
let lastLang = "";
let lastMode = "";
let myProfile = null;
let ownerIdCache = null;

function isEN() {
  try {
    const pref = JSON.parse(localStorage.getItem("mgr6pref") || "{}");
    if (pref.lang) return pref.lang === "en";
  } catch(e){}
  return document.documentElement.lang === "en";
}
function T(ar, en) { return isEN() ? en : ar; }
function isMobile() { return window.innerWidth <= 640; }
function usernameToEmail(u) { return u.trim().toLowerCase().replace(/\s+/g, ".") + "@ms-factory.local"; }

// ===== مين صاحب البيانات؟ =====
// المدير = نفسه، الموظف = المدير اللي عيّنه
async function getMyProfile() {
  if (myProfile) return myProfile;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  myProfile = data || { id: user.id, is_admin: true };
  return myProfile;
}
async function getOwnerId() {
  if (ownerIdCache) return ownerIdCache;
  const p = await getMyProfile();
  ownerIdCache = (p && p.created_by) ? p.created_by : p?.id;
  return ownerIdCache;
}
function isAdmin() { return !myProfile || myProfile.is_admin === true || !myProfile.created_by; }

// ===== أول ما الموظف يدخل، حمّل بيانات المدير =====
async function loadSharedStateOnce() {
  try {
    if (sessionStorage.getItem("ms-shared-loaded")) return;
    sessionStorage.setItem("ms-shared-loaded", "1");
    const p = await getMyProfile();
    if (!p || !p.created_by) return; // أنا المدير، بياناتي عندي
    const owner = p.created_by;
    const { data } = await supabase.from('factory_state').select('state, updated_at').eq('user_id', owner).single();
    if (data && data.state) {
      const local = localStorage.getItem("mgr6");
      // لو عندي بيانات قديمة أو فاضية، خد بيانات المدير
      if (!local || local === "{}" || local.length < 50) {
        localStorage.setItem("mgr6", JSON.stringify(data.state));
        location.reload();
      }
    }
  } catch(e){ console.error(e); }
}
loadSharedStateOnce();

async function backupNow(showAlert = false) {
  try {
    if (!navigator.onLine) { if(showAlert) alert(T("مفيش إنترنت", "No internet")); return; }
    const raw = localStorage.getItem("mgr6");
    if (!raw) return;
    const owner = await getOwnerId();
    if (!owner) return;
    const state = JSON.parse(raw);
    const { error } = await supabase.from('factory_state').upsert({ user_id: owner, state, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) { if(showAlert) alert(T("فشل الحفظ", "Save failed")); }
    else {
      lastSyncTime = new Date().toLocaleTimeString(isEN() ? 'en-US' : 'ar-EG');
      drawAll();
      syncRealTables(owner, state);
      if(showAlert) alert(T("تم الحفظ في السحابة ✅", "Saved to cloud ✅"));
    }
  } catch(e){ console.error(e); }
}

async function syncRealTables(userId, S) {
  try {
    if (S.partners && Array.isArray(S.partners)) {
      for (const p of S.partners) {
        if (!p || !p.name) continue;
        const isSupplier = (p.type || "").toString().toLowerCase().includes("supp") || (p.type || "").includes("مورد");
        const row = { user_id: userId, external_id: String(p.id || p.name), name: p.name, phone: p.phone || "", email: p.email || "", address: p.addr || p.address || "" };
        const table = isSupplier ? "suppliers" : "customers";
        const { error } = await supabase.from(table).upsert(row, { onConflict: 'user_id,external_id' });
        if (error) await supabase.from(table).insert(row).catch(()=>{});
      }
    }
    if (S.docs && Array.isArray(S.docs)) {
      for (const d of S.docs) {
        if (!d) continue;
        const row = { user_id: userId, external_id: String(d.id || d.no || Date.now()), customer_name: d.customer || d.partner || "", total: Number(d.total || d.tot || 0) || 0, raw: d };
        const { error } = await supabase.from('invoices').upsert(row, { onConflict: 'user_id,external_id' });
        if (error) await supabase.from('invoices').insert(row).catch(()=>{});
      }
    }
  } catch(e){ console.error(e); }
}

// ===== تطبيق الصلاحيات بجد =====
const TAB_PERMS = [
  { key: "invoices", ar: ["فواتير", "فاتورة"], en: ["invoice"] },
  { key: "inventory", ar: ["مخزون", "مخزن"], en: ["inventory", "stock"] },
  { key: "customers", ar: ["عملاء", "عميل"], en: ["customer"] },
  { key: "suppliers", ar: ["موردين", "مورد"], en: ["supplier"] },
  { key: "production", ar: ["إنتاج", "تصنيع"], en: ["production"] },
  { key: "reports", ar: ["تقارير", "تقرير"], en: ["report"] },
  { key: "settings", ar: ["إعدادات", "اعدادات"], en: ["setting"] },
  { key: "employees", ar: ["موظفين", "موظف"], en: ["employee", "staff"] },
];

async function enforcePermissions() {
  const p = await getMyProfile();
  if (!p) return;
  if (isAdmin()) return; // المدير يشوف كل حاجة
  const perms = p.permissions || {};
  // الموظفين تابة مقفولة دايماً للموظف العادي
  document.querySelectorAll("button, a, [data-tab], [data-view], .nav-item, .tab-btn, .sidebar button, nav button, aside button").forEach(el => {
    const txt = (el.textContent || "").trim().toLowerCase();
    if (!txt || txt.length > 30) return;
    for (const tp of TAB_PERMS) {
      const words = isEN() ? tp.en : tp.ar;
      const match = words.some(w => txt.includes(w.toLowerCase()));
      if (match) {
        // لو ماعندوش الصلاحية دي، اخفي الزرار
        if (!perms[tp.key]) el.style.display = "none";
        else el.style.display = "";
      }
    }
  });
  // لو هو في تابة ممنوعة، رجعه للوحة الرئيسية
  const m = document.getElementById("m");
  if (m) {
    const txt = (m.textContent || "").toLowerCase();
    // لو فتح تابة موظفين وهو مش مدير، شيل الكارت
    const card = document.getElementById("ms-emp-in-tab");
    if (card) card.remove();
  }
}

// ===== إضافة حساب دخول من جوه تابة الموظفين - للمدير بس =====
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

async function injectEmployeeAccountForm() {
  if (!isEmployeesTabOpen()) return;
  const p = await getMyProfile();
  if (!p || !isAdmin()) return; // الموظف ميشوفش الكارت ده خالص
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
      const { data: { user } } = await supabase.auth.getUser();
      const SUPA_URL = supabase.supabaseUrl;
      const SUPA_KEY = supabase.supabaseKey;
      const temp = createClient(SUPA_URL, SUPA_KEY, { auth: { storageKey: 'temp-emp', persistSession: false, autoRefreshToken: false } });
      const email = usernameToEmail(username);
      const { data: signup, error: signupErr } = await temp.auth.signUp({ email, password: pass });
      if (signupErr) throw signupErr;
      const newId = signup.user?.id;
      if (!newId) throw new Error(T("فشل إنشاء الحساب", "Failed to create account"));
      const { error: profErr } = await supabase.from('profiles').upsert({ id: newId, username, full_name: fullName || username, must_change_password: true, permissions: perms, created_by: user?.id, is_admin: false });
      if (profErr) console.error(profErr);
      msg.textContent = T(`تم ✅ - يدخل بالاسم: ${username} والباسورد: ${pass}`, `Done ✅ - Login with: ${username} / ${pass}`);
      alert(T(`تم إضافة ${username} ✅\nخليه يدخل بالاسم والباسورد الافتراضي، وهيطلب منه باسورد جديد`, `Added ${username} ✅\nAsk him to login with default password, he will be asked for a new one`));
    } catch(e) { msg.textContent = e.message; console.error(e); }
  };
}

setInterval(() => {
  if (isEmployeesTabOpen()) injectEmployeeAccountForm();
  else {
    const old = document.getElementById("ms-emp-in-tab");
    if (old) old.remove();
  }
  enforcePermissions();
}, 1000);

// ===== الشريط زي ما هو - حباية + ✕ بس =====
const originalSetItem = localStorage.setItem.bind(localStorage);
localStorage.setItem = function(key, value) {
  originalSetItem(key, value);
  if (key === "mgr6") { clearTimeout(saveTimer); saveTimer = setTimeout(() => backupNow(false), 1500); }
  if (key === "mgr6pref") setTimeout(drawAll, 100);
};

window.restoreCloud = async function() {
  if (!confirm(T("هتستبدل البيانات الحالية بنسخة السحابة؟", "Replace current data with cloud copy?"))) return;
  const owner = await getOwnerId();
  const { data, error } = await supabase.from('factory_state').select('state').eq('user_id', owner).single();
  if (error || !data) return alert(T("مفيش نسخة في السحابة", "No cloud copy found"));
  localStorage.setItem("mgr6", JSON.stringify(data.state));
  alert(T("تمت الاستعادة ✅", "Restored ✅"));
  location.reload();
};
window.backupNowManual = function() { backupNow(true); };

async function doLogout() {
  if (!confirm(T("متأكد عايز تسجل خروج؟", "Are you sure you want to logout?"))) return;
  try { await supabase.auth.signOut(); } catch(e){}
  sessionStorage.removeItem("ms-shared-loaded");
  location.href = "auth.html";
}

function purgeLoggedInText() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
  const toRemove = [];
  let node;
  while (node = walker.nextNode()) {
    if (node.parentElement && node.parentElement.closest("#ms-topbar")) continue;
    const t = node.textContent || "";
    if (t.includes("مسجل الدخول") || t.includes("Logged in as") || t.includes("m.mongy") || t.includes("@gmail")) toRemove.push(node);
  }
  toRemove.forEach(n => { n.textContent = ""; });
  document.querySelectorAll("div, span, p, small, header, section").forEach(el => {
    if (el.id === "ms-topbar" || el.closest("#ms-topbar")) return;
    const txt = el.textContent || "";
    if ((txt.includes("مسجل الدخول") || txt.includes("Logged in as")) && el.children.length <= 3) {
      const h = el.getBoundingClientRect ? el.getBoundingClientRect().height : 999;
      if (h < 120) { el.style.display = "none"; el.style.height = "0px"; el.style.padding = "0px"; el.style.margin = "0px"; el.style.overflow = "hidden"; }
    }
    const id = (el.id || "").toLowerCase();
    const tt = txt.trim();
    if ((id.includes("logout") || tt === "تسجيل خروج" || tt === "Logout") && el.id !== "ms-logout-btn" && !el.closest("#ms-topbar")) el.style.display = "none";
  });
}
const observer = new MutationObserver(() => { purgeLoggedInText(); });
observer.observe(document.body, { childList: true, subtree: true, characterData: true });

function drawAll(text) {
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
  const label = mobile ? T("☁️ متزامن", "☁️ Synced") : (text || (lastSyncTime ? `${T("☁️ متزامن", "☁️ Synced")} ${lastSyncTime}` : T("☁️ متزامن", "☁️ Synced")));
  const s1 = document.createElement("span"); s1.textContent = label; s1.style.whiteSpace = "nowrap";
  const s2 = document.createElement("span"); s2.textContent = T("حفظ الآن", "Save Now");
  s2.style.cssText = "background:#fff;color:#0f766e;padding:2px 10px;border-radius:12px;cursor:pointer;white-space:nowrap;" + (mobile ? "font-size:11px;" : "");
  s2.onclick = (e) => { e.stopPropagation(); backupNowManual(); };
  const s3 = document.createElement("span"); s3.textContent = T("استرجاع", "Restore");
  s3.style.cssText = "background:#fff;color:#0f766e;padding:2px 10px;border-radius:12px;cursor:pointer;white-space:nowrap;" + (mobile ? "font-size:11px;" : "");
  s3.onclick = (e) => { e.stopPropagation(); restoreCloud(); };
  b.appendChild(s1); b.appendChild(s2); b.appendChild(s3);
  b.style.cssText = "background:#0f766e;color:#fff;padding:6px 12px;border-radius:20px;display:flex;gap:" + (mobile ? "6px" : "8px") + ";align-items:center;justify-content:center;flex-wrap:nowrap;white-space:nowrap;font-size:" + (mobile ? "11px" : "13px") + ";font-weight:bold;direction:" + (en ? "ltr" : "rtl") + ";box-shadow:0 2px 10px rgba(0,0,0,.3);max-width:calc(100% - 80px);overflow:hidden;";
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
console.log("☁️ Cloud Sync V21 شغال - صلاحيات + بيانات مشتركة");
