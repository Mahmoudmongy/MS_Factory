// js/cloud-sync.js - V7 - في نفس سطر تسجيل الخروج فوق خالص + AR/EN
import { supabase } from './supabase.js';

let saveTimer = null;
let lastSaved = "";
let lastSyncTime = "";
let lastLang = "";

function isEN() {
  try {
    const pref = JSON.parse(localStorage.getItem("mgr6pref") || "{}");
    if (pref.lang) return pref.lang === "en";
  } catch(e){}
  return document.documentElement.lang === "en";
}
function T(ar, en) { return isEN() ? en : ar; }

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
      lastSaved = raw;
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

// ===== نلاقي زرار تسجيل الخروج =====
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
  }
  const en = isEN();
  const label = text || (lastSyncTime ? `${T("☁️ متزامن", "☁️ Synced")} ${lastSyncTime}` : T("☁️ متزامن", "☁️ Synced"));

  b.innerHTML = "";
  const s1 = document.createElement("span"); s1.textContent = label;
  const s2 = document.createElement("span"); s2.textContent = T("حفظ الآن", "Save Now");
  s2.style.cssText = "background:#fff;color:#0f766e;padding:2px 10px;border-radius:12px;cursor:pointer;";
  s2.onclick = (e) => { e.stopPropagation(); backupNowManual(); };
  const s3 = document.createElement("span"); s3.textContent = T("استرجاع", "Restore");
  s3.style.cssText = "background:#fff;color:#0f766e;padding:2px 10px;border-radius:12px;cursor:pointer;";
  s3.onclick = (e) => { e.stopPropagation(); restoreCloud(); };
  b.appendChild(s1); b.appendChild(s2); b.appendChild(s3);

  // ===== نحطه في نفس سطر تسجيل الخروج =====
  const logout = findLogoutBtn();
  if (logout && logout.parentElement) {
    const bar = logout.parentElement;
    // خلي السطر نفسه flex عشان يبقوا جنب بعض في نفس الارتفاع
    bar.style.display = "flex";
    bar.style.alignItems = "center";
    bar.style.gap = "8px";
    // عربي = الزرار يبقى شمال | إنجليزي = يمين
    // بنحطه قبل زرار الخروج في العربي، وبعده في الإنجليزي عشان يفضل لازق فيه
    b.style.cssText = "background:#0f766e;color:#fff;padding:6px 12px;border-radius:20px;font-size:13px;font-weight:bold;display:inline-flex;gap:8px;align-items:center;direction:" + (en ? "ltr" : "rtl") + ";white-space:nowrap;";
    if (b.parentElement !== bar) {
      if (en) bar.appendChild(b); // إنجليزي: بعد الخروج على اليمين
      else bar.insertBefore(b, bar.firstChild); // عربي: قبل الخروج على الشمال
    }
    // لو اللغة اتغيرت، انقل مكانه
    if (en && bar.firstChild === b) bar.appendChild(b);
    if (!en && bar.lastChild === b) bar.insertBefore(b, bar.firstChild);
  } else {
    // لو لسه زرار الخروج مظهرش، حطه فوق خالص مؤقتاً لحد ما يظهر
    if (b.parentElement !== document.body) document.body.appendChild(b);
    if (en) b.style.cssText = "position:fixed;top:8px;right:12px;z-index:99999;background:#0f766e;color:#fff;padding:6px 12px;border-radius:20px;font-size:13px;font-weight:bold;display:flex;gap:8px;align-items:center;direction:ltr;";
    else b.style.cssText = "position:fixed;top:8px;left:12px;z-index:99999;background:#0f766e;color:#fff;padding:6px 12px;border-radius:20px;font-size:13px;font-weight:bold;display:flex;gap:8px;align-items:center;direction:rtl;";
  }
  lastLang = en ? "en" : "ar";
  return b;
}

// كل نص ثانية: لو الزرار اتمسح أو اللغة اتغيرت أو زرار الخروج ظهر، رجعه لمكانه الصح
setInterval(() => {
  const b = document.getElementById("cloud-badge");
  const cur = isEN() ? "en" : "ar";
  const logout = findLogoutBtn();
  const inBar = logout && b && b.parentElement === logout.parentElement;
  if (!b || cur !== lastLang || (logout && !inBar)) drawBadge();
}, 500);

drawBadge();
console.log("☁️ Cloud Sync V7 شغال - جنب تسجيل الخروج");
