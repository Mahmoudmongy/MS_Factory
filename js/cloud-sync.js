// js/cloud-sync.js - V14 - شريط واحد فوق خالص فيه السحابة + ✕ - Dynamic + AR/EN + PC/Mobile
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

function hideOldUserBar() {
  document.querySelectorAll("button, a, span, div, p, small").forEach(el => {
    if (el.id === "ms-topbar" || el.closest("#ms-topbar")) return;
    const txt = (el.textContent || "");
    if ((txt.includes("مسجل الدخول") || txt.includes("Logged in as")) && el.children.length === 0) el.style.display = "none";
    const id = (el.id || "").toLowerCase();
    const t = txt.trim();
    if ((id.includes("logout") || t === "تسجيل خروج" || t === "Logout") && el.id !== "ms-logout-btn") el.style.display = "none";
  });
  Array.from(document.body.childNodes).forEach(n => {
    if (n.nodeType === 3 && (n.textContent.includes("مسجل") || n.textContent.includes("@"))) n.textContent = "";
  });
}

function drawAll(text) {
  hideOldUserBar();
  const en = isEN();
  const mobile = isMobile();

  // ===== شريط واحد فوق خالص، فيه السحابة + ✕، نفس الارتفاع =====
  let top = document.getElementById("ms-topbar");
  if (!top) {
    top = document.createElement("div");
    top.id = "ms-topbar";
    document.body.prepend(top);
  }

  // عربي: ✕ شمال خالص | إنجليزي: ✕ يمين خالص
  // بنرتبهم بـ flex-direction عشان الـ ✕ يفضل في الطرف
  top.style.cssText = "position:fixed;top:0;left:0;right:0;width:100%;height:36px;z-index:100000;background:#0f766e;color:#fff;display:flex;align-items:center;direction:" + (en ? "ltr" : "rtl") + ";box-shadow:0 2px 8px rgba(0,0,0,.3);";

  // ننضف الشريط ونرسمه من جديد
  top.innerHTML = "";

  // 1. زرار ✕ - مربع 36x36، نفس ارتفاع الشريط بالظبط
  const x = document.createElement("button");
  x.id = "ms-logout-btn";
  x.textContent = "✕";
  x.title = en ? "Logout" : "تسجيل الخروج";
  x.onclick = doLogout;
  x.style.cssText = "background:#ef4444;color:#fff;border:none;width:36px;height:36px;min-width:36px;border-radius:0;font-size:18px;font-weight:bold;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;";

  // 2. السحابة - في النص، بتاخد باقي المساحة
  const b = document.createElement("div");
  b.id = "cloud-badge";
  // على الموبايل: من غير وقت عشان مفيش مكان، وخط أصغر، وممنوع يلف لسطر تاني
  // على الكمبيوتر: بالوقت عادي
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
  // موبايل: خط 11px وممنوع يلف | كمبيوتر: خط 13px
  b.style.cssText = "flex:1;display:flex;gap:" + (mobile ? "6px" : "8px") + ";align-items:center;justify-content:center;flex-wrap:nowrap;overflow:hidden;white-space:nowrap;font-size:" + (mobile ? "11px" : "13px") + ";font-weight:bold;direction:" + (en ? "ltr" : "rtl") + ";";

  // الترتيب: عربي = ✕ شمال، السحابة بعده | إنجليزي = ✕ يمين، السحابة قبله
  // عشان الشريط direction rtl/ltr، هنحط ✕ الأول دايماً وهو هيروح للطرف الصح
  if (en) { top.appendChild(b); top.appendChild(x); }
  else { top.appendChild(x); top.appendChild(b); }

  // ننزل محتوى البرنامج 36px تحت، عشان الشريط ميغطيش على حاجة - كمبيوتر وموبايل
  document.body.style.paddingTop = "36px";

  lastLang = en ? "en" : "ar";
  lastMode = mobile ? "mobile" : "desktop";
}

setInterval(() => {
  const top = document.getElementById("ms-topbar");
  const cur = isEN() ? "en" : "ar";
  const mode = isMobile() ? "mobile" : "desktop";
  if (!top || cur !== lastLang || mode !== lastMode) drawAll();
  else hideOldUserBar();
}, 500);

window.addEventListener("resize", () => drawAll());
drawAll();
console.log("☁️ Cloud Sync V14 شغال - شريط واحد + موبايل صح");
