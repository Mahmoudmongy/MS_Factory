// js/cloud-sync.js - V15 - بيمسح "مسجل الدخول" أول ما يظهر - Dynamic + AR/EN + PC/Mobile
import { supabase } from './supabase.js';

let saveTimer = null;
let lastSyncTime = "";
let lastLang = "";
let lastMode = "";

function isEN() {
  try {
    const pref = JSON.parse(localStorage.getItem("mgr6pref") || "{}");
    if (pref.lang) return pref.lang === "en";
  } catch(e){}
  return document.documentElement.lang === "en";
}
function T(ar, en) { return isEN() ? en : ar; }
function isMobile() { return window.innerWidth <= 640; }

async function backupNow(showAlert = false) {
  try {
    if (!navigator.onLine) { if(showAlert) alert(T("مفيش إنترنت", "No internet")); return; }
    const raw = localStorage.getItem("mgr6");
    if (!raw) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from('factory_state').upsert({
      user_id: user.id,
      state: JSON.parse(raw),
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
    if (error) { if(showAlert) alert(T("فشل الحفظ", "Save failed")); }
    else {
      lastSyncTime = new Date().toLocaleTimeString(isEN() ? 'en-US' : 'ar-EG');
      drawAll();
      if(showAlert) alert(T("تم الحفظ في السحابة ✅", "Saved to cloud ✅"));
    }
  } catch(e){ console.error(e); }
}

const originalSetItem = localStorage.setItem.bind(localStorage);
localStorage.setItem = function(key, value) {
  originalSetItem(key, value);
  if (key === "mgr6") {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => backupNow(false), 1500);
  }
  if (key === "mgr6pref") setTimeout(drawAll, 100);
};

window.restoreCloud = async function() {
  if (!confirm(T("هتستبدل البيانات الحالية بنسخة السحابة؟", "Replace current data with cloud copy?"))) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return alert(T("سجل دخول الأول", "Please login first"));
  const { data, error } = await supabase.from('factory_state').select('state').eq('user_id', user.id).single();
  if (error || !data) return alert(T("مفيش نسخة في السحابة", "No cloud copy found"));
  localStorage.setItem("mgr6", JSON.stringify(data.state));
  alert(T("تمت الاستعادة ✅", "Restored ✅"));
  location.reload();
};
window.backupNowManual = function() { backupNow(true); };

async function doLogout() {
  if (!confirm(T("متأكد عايز تسجل خروج؟", "Are you sure you want to logout?"))) return;
  try { await supabase.auth.signOut(); } catch(e){}
  location.href = "auth.html";
}

// ===== ده اللي بيمسح "مسجل الدخول" والإيميل - شغال طول الوقت =====
function purgeLoggedInText() {
  // 1. امسح أي Text Node في الـ body فيه "مسجل" أو الإيميل، ما عدا الشريط بتاعنا
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
  const toRemove = [];
  let node;
  while (node = walker.nextNode()) {
    if (node.parentElement && node.parentElement.closest("#ms-topbar")) continue;
    const t = node.textContent || "";
    if (t.includes("مسجل الدخول") || t.includes("Logged in as") || t.includes("m.mongy") || t.includes("@gmail")) {
      toRemove.push(node);
    }
  }
  toRemove.forEach(n => { n.textContent = ""; });

  // 2. اخفي أي عنصر فيه الجملة دي، حتى لو كان div كبير على الموبايل
  document.querySelectorAll("div, span, p, small, header, section").forEach(el => {
    if (el.id === "ms-topbar" || el.closest("#ms-topbar")) return;
    const txt = el.textContent || "";
    // لو العنصر ده هو اللي فيه الجملة، وكان صغير (شريط مش الصفحة كلها)، اخفيه
    if ((txt.includes("مسجل الدخول") || txt.includes("Logged in as")) && el.children.length <= 3) {
      // متخفيش الصفحة كلها، اخفي الشريط الصغير بس
      const h = el.getBoundingClientRect ? el.getBoundingClientRect().height : 999;
      if (h < 120) {
        el.style.display = "none";
        el.style.visibility = "hidden";
        el.style.height = "0px";
        el.style.padding = "0px";
        el.style.margin = "0px";
        el.style.overflow = "hidden";
      }
    }
    // اخفي زرار الخروج القديم، احنا عندنا واحد جديد
    const id = (el.id || "").toLowerCase();
    const tt = txt.trim();
    if ((id.includes("logout") || tt === "تسجيل خروج" || tt === "Logout") && el.id !== "ms-logout-btn" && !el.closest("#ms-topbar")) {
      el.style.display = "none";
    }
  });
}

// راقب أي حاجة جديدة بتتضاف للصفحة - أول ما شريط "مسجل الدخول" يظهر على الموبايل، امسحه فوراً
const observer = new MutationObserver(() => { purgeLoggedInText(); });
observer.observe(document.body, { childList: true, subtree: true, characterData: true });

function drawAll(text) {
  purgeLoggedInText();
  const en = isEN();
  const mobile = isMobile();

  let top = document.getElementById("ms-topbar");
  if (!top) {
    top = document.createElement("div");
    top.id = "ms-topbar";
    document.body.prepend(top);
  }

  top.style.cssText = "position:fixed;top:0;left:0;right:0;width:100%;height:36px;z-index:100000;background:#0f766e;color:#fff;display:flex;align-items:center;direction:" + (en ? "ltr" : "rtl") + ";box-shadow:0 2px 8px rgba(0,0,0,.3);";
  top.innerHTML = "";

  const x = document.createElement("button");
  x.id = "ms-logout-btn";
  x.textContent = "✕";
  x.title = en ? "Logout" : "تسجيل الخروج";
  x.onclick = doLogout;
  x.style.cssText = "background:#ef4444;color:#fff;border:none;width:36px;height:36px;min-width:36px;border-radius:0;font-size:18px;font-weight:bold;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;";

  const b = document.createElement("div");
  b.id = "cloud-badge";
  const label = mobile
    ? T("☁️ متزامن", "☁️ Synced")
    : (text || (lastSyncTime ? `${T("☁️ متزامن", "☁️ Synced")} ${lastSyncTime}` : T("☁️ متزامن", "☁️ Synced")));
  const s1 = document.createElement("span"); s1.textContent = label; s1.style.whiteSpace = "nowrap";
  const s2 = document.createElement("span"); s2.textContent = T("حفظ الآن", "Save Now");
  s2.style.cssText = "background:#fff;color:#0f766e;padding:2px 8px;border-radius:12px;cursor:pointer;white-space:nowrap;" + (mobile ? "font-size:11px;" : "");
  s2.onclick = (e) => { e.stopPropagation(); backupNowManual(); };
  const s3 = document.createElement("span"); s3.textContent = T("استرجاع", "Restore");
  s3.style.cssText = "background:#fff;color:#0f766e;padding:2px 8px;border-radius:12px;cursor:pointer;white-space:nowrap;" + (mobile ? "font-size:11px;" : "");
  s3.onclick = (e) => { e.stopPropagation(); restoreCloud(); };

  b.appendChild(s1); b.appendChild(s2); b.appendChild(s3);
  b.style.cssText = "flex:1;display:flex;gap:" + (mobile ? "6px" : "8px") + ";align-items:center;justify-content:center;flex-wrap:nowrap;overflow:hidden;white-space:nowrap;font-size:" + (mobile ? "11px" : "13px") + ";font-weight:bold;direction:" + (en ? "ltr" : "rtl") + ";";

  if (en) { top.appendChild(b); top.appendChild(x); }
  else { top.appendChild(x); top.appendChild(b); }

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
console.log("☁️ Cloud Sync V15 شغال - بيمسح مسجل الدخول على الموبايل");
