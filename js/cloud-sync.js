// js/cloud-sync.js - V4 - ثنائي اللغة AR / EN
import { supabase } from './supabase.js';

let saveTimer = null;
let lastSaved = "";
let lastSyncTime = "";

// ===== دي اللي بتحدد اللغة الحالية من البرنامج نفسه =====
function isEN() {
  // البرنامج بيحط lang="en" على <html> لما تختار إنجليزي
  return document.documentElement.lang === "en" || document.documentElement.dir === "ltr";
}
// دالة ترجمة صغيرة - عربي / إنجليزي
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
    if (error) { console.error(error); if(showAlert) alert(T("فشل الحفظ", "Save failed")); }
    else {
      lastSaved = raw;
      lastSyncTime = new Date().toLocaleTimeString(isEN() ? 'en-US' : 'ar-EG');
      console.log('✅ Saved to cloud');
      updateBadge();
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
    updateBadge(T("جارٍ الحفظ...", "Saving..."));
  }
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

// ===== الزرار - تحت على الشمال زي ما انت شايفه، بس ثنائي اللغة =====
function updateBadge(text) {
  let b = document.getElementById("cloud-badge");
  if (!b) {
    b = document.createElement("div");
    b.id = "cloud-badge";
    // تحت على الشمال، ومش بيغطي على الجداول
    b.style.cssText = "position:fixed;bottom:12px;left:12px;z-index:99999;background:#0f766e;color:#fff;padding:8px 12px;border-radius:20px;font-size:13px;font-weight:bold;box-shadow:0 4px 15px rgba(0,0,0,.4);display:flex;gap:8px;align-items:center;direction:ltr;";
    document.body.appendChild(b);
  }
  // بنرسم الزرار كل مرة حسب اللغة الحالية
  const label = text || (lastSyncTime ? `${T("☁️ متزامن", "☁️ Synced")} ${lastSyncTime}` : T("☁️ متزامن", "☁️ Synced"));
  b.innerHTML = `<span id="cloud-txt">${label}</span><span style="background:#fff;color:#0f766e;padding:3px 10px;border-radius:12px;cursor:pointer;" onclick="event.stopPropagation();backupNowManual()">${T("حفظ الآن", "Save Now")}</span><span style="background:#fff;color:#0f766e;padding:3px 10px;border-radius:12px;cursor:pointer;" onclick="event.stopPropagation();restoreCloud()">${T("استرجاع", "Restore")}</span>`;
  // منع محرك الترجمة بتاع البرنامج إنه يترجم الزرار غلط
  b.setAttribute("data-no-translate", "1");
}

// أول ما اللغة تتغير في البرنامج، الزرار يتغير معاها
const langObserver = new MutationObserver(() => updateBadge());
langObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang', 'dir'] });

// صلّح كلام صفحة المزامنة القديم - عربي وإنجليزي
function fixSyncPage() {
  if (document.body.innerHTML.includes("محلي على هذا الجهاز فقط")) {
    document.body.innerHTML = document.body.innerHTML
      .replace("محلي على هذا الجهاز فقط (Demo)", "محلي + سحابة Supabase ✅")
      .replace("غير مفعّلة — تحتاج Backend فعلي (Supabase)", "مفعّلة ✅ - بيتحفظ في جدول factory_state")
      .replaceAll("عند ربط Supabase", "متزامن ✅");
  }
  if (document.body.innerHTML.includes("Local on this device only")) {
    document.body.innerHTML = document.body.innerHTML
      .replace("Local on this device only (Demo)", "Local + Supabase Cloud ✅")
      .replace("Not enabled — needs a real backend (Supabase)", "Enabled ✅ - saved in factory_state")
      .replaceAll("When Supabase is connected", "Synced ✅");
  }
}
setInterval(fixSyncPage, 2000);

updateBadge();
console.log("☁️ Cloud Sync V4 AR/EN شغال");
