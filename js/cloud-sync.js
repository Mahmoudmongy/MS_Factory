// js/cloud-sync.js - V3 - زرار فوق + تصليح صفحة المزامنة
import { supabase } from './supabase.js';

let saveTimer = null;
let lastSaved = "";
let lastSyncTime = "";

async function backupNow(showAlert = false) {
  try {
    if (!navigator.onLine) { if(showAlert) alert("مفيش إنترنت"); return; }
    const raw = localStorage.getItem("mgr6");
    if (!raw) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from('factory_state').upsert({
      user_id: user.id,
      state: JSON.parse(raw),
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
    if (error) { console.error(error); if(showAlert) alert("فشل الحفظ"); }
    else {
      lastSaved = raw;
      lastSyncTime = new Date().toLocaleTimeString('ar-EG');
      console.log('✅ تم الحفظ في السحابة');
      updateBadge();
      if(showAlert) alert("تم الحفظ في السحابة ✅ - افتح جدول factory_state في Supabase هتلاقي الداتا");
    }
  } catch(e){ console.error(e); }
}

const originalSetItem = localStorage.setItem.bind(localStorage);
localStorage.setItem = function(key, value) {
  originalSetItem(key, value);
  if (key === "mgr6") {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => backupNow(false), 1500);
    updateBadge("جارٍ الحفظ...");
  }
};

window.restoreCloud = async function() {
  if (!confirm("هتستبدل البيانات الحالية بنسخة السحابة؟")) return;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return alert("سجل دخول الأول");
    const { data, error } = await supabase.from('factory_state').select('state').eq('user_id', user.id).single();
    if (error || !data) return alert("مفيش نسخة في السحابة");
    localStorage.setItem("mgr6", JSON.stringify(data.state));
    alert("تمت الاستعادة ✅");
    location.reload();
  } catch(e){ alert("حصل خطأ: " + e.message); }
};
window.backupNowManual = function() { backupNow(true); };

// زرار فوق خالص - مش هيتغطى بالقايمة
function updateBadge(text) {
  let b = document.getElementById("cloud-badge");
  if (!b) {
    b = document.createElement("div");
    b.id = "cloud-badge";
    b.style.cssText = "position:fixed;top:52px;left:50%;transform:translateX(-50%);z-index:99999;background:#0f766e;color:#fff;padding:8px 14px;border-radius:20px;font-size:14px;font-weight:bold;box-shadow:0 4px 15px rgba(0,0,0,.4);display:flex;gap:10px;align-items:center;";
    b.innerHTML = `<span id="cloud-txt">☁️ متزامن</span><span style="background:#fff;color:#0f766e;padding:3px 10px;border-radius:12px;cursor:pointer;" onclick="event.stopPropagation();backupNowManual()">حفظ الآن</span><span style="background:#fff;color:#0f766e;padding:3px 10px;border-radius:12px;cursor:pointer;" onclick="event.stopPropagation();restoreCloud()">استرجاع</span>`;
    document.body.appendChild(b);
  }
  const t = document.getElementById("cloud-txt");
  if (t) t.textContent = text || (lastSyncTime ? `☁️ متزامن ${lastSyncTime}` : "☁️ متزامن - السحابة شغالة");
}

// صلّح كلام صفحة المزامنة القديم تلقائياً
function fixSyncPage() {
  document.body.innerHTML = document.body.innerHTML.replace(
    "محلي على هذا الجهاز فقط (Demo)",
    "محلي + سحابة Supabase ✅"
  ).replace(
    "غير مفعّلة — تحتاج Backend فعلي (Supabase)",
    "مفعّلة ✅ - بيتحفظ في جدول factory_state"
  ).replaceAll("عند ربط Supabase", "متزامن ✅");
}
setInterval(fixSyncPage, 2000);

updateBadge();
console.log("☁️ Cloud Sync V3 شغال");
