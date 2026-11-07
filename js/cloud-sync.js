// js/cloud-sync.js - V8 - فوق خالص + موبايل + AR/EN
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
      drawBadge();
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
  if (key === "mgr6pref") setTimeout(drawBadge, 100);
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

function findLogoutBtn() {
  const all = Array.from(document.querySelectorAll("button, a, span"));
  return all.find(el => {
    const t = (el.textContent || "").trim();
    return t === "تسجيل خروج" || t === "خروج" || t === "Logout" || t === "Log out" || t === "Sign out";
  });
}

function drawBadge(text) {
  let b = document.getElementById("cloud-badge");
  if (!b) {
    b = document.createElement("div");
    b.id = "cloud-badge";
    document.body.appendChild(b);
  }
  const en = isEN();
  const mobile = isMobile();
  const label = text || (lastSyncTime ? `${T("☁️ متزامن", "☁️ Synced")} ${lastSyncTime}` : T("☁️ متزامن", "☁️ Synced"));

  b.innerHTML = "";
  const s1 = document.createElement("span"); s1.textContent = label;
  const s2 = document.createElement("span"); s2.textContent = T("حفظ الآن", "Save Now");
  s2.style.cssText = "background:#fff;color:#0f766e;padding:2px 10px;border-radius:12px;cursor:pointer;white-space:nowrap;";
  s2.onclick = (e) => { e.stopPropagation(); backupNowManual(); };
  const s3 = document.createElement("span"); s3.textContent = T("استرجاع", "Restore");
  s3.style.cssText = "background:#fff;color:#0f766e;padding:2px 10px;border-radius:12px;cursor:pointer;white-space:nowrap;";
  s3.onclick = (e) => { e.stopPropagation(); restoreCloud(); };
  b.appendChild(s1); b.appendChild(s2); b.appendChild(s3);

  // ===== موبايل: شريط رفيع فوق خالص بعرض الشاشة، مش زرار عايم =====
  if (mobile) {
    // لو كان جوه سطر تسجيل الخروج، رجعه للـ body
    if (b.parentElement !== document.body) document.body.appendChild(b);
    b.style.cssText = "position:fixed;top:0;left:0;right:0;width:100%;z-index:99999;background:#0f766e;color:#fff;padding:5px 8px;font-size:11px;font-weight:bold;display:flex;gap:6px;align-items:center;justify-content:center;flex-wrap:wrap;direction:" + (en ? "ltr" : "rtl") + ";border-radius:0;box-shadow:0 2px 8px rgba(0,0,0,.3);";
    // ننزل محتوى الصفحة 28px تحت عشان الشريط ميغطيش على حاجة
    document.body.style.paddingTop = "28px";
  } else {
    document.body.style.paddingTop = "";
    // ===== كمبيوتر: في نفس سطر تسجيل الخروج فوق خالص =====
    const logout = findLogoutBtn();
    if (logout && logout.parentElement) {
      const bar = logout.parentElement;
      bar.style.display = "flex";
      bar.style.alignItems = "center";
      bar.style.gap = "8px";
      b.style.cssText = "background:#0f766e;color:#fff;padding:6px 12px;border-radius:20px;font-size:13px;font-weight:bold;display:inline-flex;gap:8px;align-items:center;direction:" + (en ? "ltr" : "rtl") + ";white-space:nowrap;position:static;";
      if (b.parentElement !== bar) {
        if (en) bar.appendChild(b);
        else bar.insertBefore(b, bar.firstChild);
      }
      if (en && bar.firstChild === b) bar.appendChild(b);
      if (!en && bar.lastChild === b) bar.insertBefore(b, bar.firstChild);
    } else {
      // لو زرار الخروج لسه مظهرش، حطه فوق خالص مؤقتاً - مش تحت خالص
      if (b.parentElement !== document.body) document.body.appendChild(b);
      if (en) b.style.cssText = "position:fixed;top:6px;right:12px;z-index:99999;background:#0f766e;color:#fff;padding:6px 12px;border-radius:20px;font-size:13px;font-weight:bold;display:flex;gap:8px;align-items:center;direction:ltr;";
      else b.style.cssText = "position:fixed;top:6px;left:12px;z-index:99999;background:#0f766e;color:#fff;padding:6px 12px;border-radius:20px;font-size:13px;font-weight:bold;display:flex;gap:8px;align-items:center;direction:rtl;";
    }
  }
  lastLang = en ? "en" : "ar";
  lastMode = mobile ? "mobile" : "desktop";
  return b;
}

setInterval(() => {
  const b = document.getElementById("cloud-badge");
  const cur = isEN() ? "en" : "ar";
  const mode = isMobile() ? "mobile" : "desktop";
  const logout = findLogoutBtn();
  const inBar = logout && b && b.parentElement === logout.parentElement;
  if (!b || cur !== lastLang || mode !== lastMode || (!isMobile() && logout && !inBar)) drawBadge();
}, 500);

window.addEventListener("resize", () => drawBadge());
drawBadge();
console.log("☁️ Cloud Sync V8 شغال - فوق خالص + موبايل");
