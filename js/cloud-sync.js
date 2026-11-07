// js/cloud-sync.js - V5 - فوق + ثنائي اللغة بجد
import { supabase } from './supabase.js';

let saveTimer = null;
let lastSaved = "";
let lastSyncTime = "";
let lastLang = "";

function isEN() {
  // البرنامج بيخزن اللغة هنا
  try {
    const pref = JSON.parse(localStorage.getItem("mgr6pref") || "{}");
    if (pref.lang) return pref.lang === "en";
  } catch(e){}
  return document.documentElement.lang === "en" || document.documentElement.dir === "ltr";
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
      console.log('✅ Saved to cloud');
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
    drawBadge(T("جارٍ الحفظ...", "Saving..."));
  }
  // لو اللغة اتغيرت في الإعدادات، ارسم الزرار تاني فوراً
  if (key === "mgr6pref") setTimeout(drawBadge, 100);
};

window.restoreCloud = async function() {
  if (!confirm(T("هتستبدل البيانات الحالية بنسخة السحابة؟", "Replace current data with cloud copy?"))) return;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return alert(T("سجل دخول الأول", "Please login first"));
    const { data, error } = await supabase.from('factory_state').select('state').eq('user_id', user.id).single();
    if (error || !data) return alert(T("مفيش نسخة في السحابة", "No cloud copy found"));
    localStorage.setItem("mgr6", JSON.stringify(data.state));
    alert(T("تمت الاستعادة ✅", "Restored ✅"));
    location.reload();
  } catch(e){ alert(e.message); }
};
window.backupNowManual = function() { backupNow(true); };

// ===== رسم الزرار - المكان بيتغير حسب اللغة =====
function drawBadge(text) {
  let b = document.getElementById("cloud-badge");
  if (!b) {
    b = document.createElement("div");
    b.id = "cloud-badge";
    document.body.appendChild(b);
  }
  const en = isEN();

  // عربي = فوق شمال | إنجليزي = فوق يمين
  // top: 58px عشان يبقى تحت الهيدر الأخضر ومش فوق القايمة
  if (en) {
    b.style.cssText = "position:fixed;top:58px;right:12px;left:auto;z-index:99999;background:#0f766e;color:#fff;padding:8px 12px;border-radius:20px;font-size:13px;font-weight:bold;box-shadow:0 4px 15px rgba(0,0,0,.4);display:flex;gap:8px;align-items:center;direction:ltr;";
  } else {
    b.style.cssText = "position:fixed;top:58px;left:12px;right:auto;z-index:99999;background:#0f766e;color:#fff;padding:8px 12px;border-radius:20px;font-size:13px;font-weight:bold;box-shadow:0 4px 15px rgba(0,0,0,.4);display:flex;gap:8px;align-items:center;direction:rtl;";
  }

  const label = text || (lastSyncTime ? `${T("☁️ متزامن", "☁️ Synced")} ${lastSyncTime}` : T("☁️ متزامن", "☁️ Synced"));
  // بنستخدم innerHTML جديد كل مرة عشان محرك الترجمة بتاع البرنامج ميبوظوش
  b.innerHTML = "";
  const s1 = document.createElement("span");
  s1.textContent = label;
  const s2 = document.createElement("span");
  s2.textContent = T("حفظ الآن", "Save Now");
  s2.style.cssText = "background:#fff;color:#0f766e;padding:3px 10px;border-radius:12px;cursor:pointer;";
  s2.onclick = (e) => { e.stopPropagation(); backupNowManual(); };
  const s3 = document.createElement("span");
  s3.textContent = T("استرجاع", "Restore");
  s3.style.cssText = "background:#fff;color:#0f766e;padding:3px 10px;border-radius:12px;cursor:pointer;";
  s3.onclick = (e) => { e.stopPropagation(); restoreCloud(); };
  b.appendChild(s1); b.appendChild(s2); b.appendChild(s3);
  lastLang = en ? "en" : "ar";
}

// راقب اللغة كل 500ms - لو اتغيرت ارسم الزرار تاني في مكانه الجديد
setInterval(() => {
  const cur = isEN() ? "en" : "ar";
  if (cur !== lastLang) drawBadge();
}, 500);

drawBadge();
console.log("☁️ Cloud Sync V5 شغال - فوق + AR/EN");
