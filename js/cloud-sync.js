// js/cloud-sync.js - V2 - مزامنة + استعادة تلقائية + زرار حالة
import { supabase } from './supabase.js';

let saveTimer = null;
let lastSaved = "";
let lastSyncTime = "";

// ===== حفظ في السحابة =====
async function backupNow(showAlert = false) {
  try {
    if (!navigator.onLine) { if(showAlert) alert("مفيش إنترنت"); return; }
    const raw = localStorage.getItem("mgr6");
    if (!raw) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from('factory_state')
      .upsert({
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
      if(showAlert) alert("تم الحفظ في السحابة ✅");
    }
  } catch (e) { console.error(e); }
}

// ===== مراقبة أي حفظ من app.js =====
const originalSetItem = localStorage.setItem.bind(localStorage);
localStorage.setItem = function(key, value) {
  originalSetItem(key, value);
  if (key === "mgr6") {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => backupNow(false), 1500);
    updateBadge("جارٍ الحفظ...");
  }
};

// ===== استعادة من السحابة =====
window.restoreCloud = async function() {
  if (!confirm("هتستبدل البيانات الحالية بنسخة السحابة؟")) return;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return alert("سجل دخول الأول");
    const { data, error } = await supabase
      .from('factory_state')
      .select('state')
      .eq('user_id', user.id)
      .single();
    if (error || !data) return alert("مفيش نسخة في السحابة");
    localStorage.setItem("mgr6", JSON.stringify(data.state));
    alert("تمت الاستعادة ✅");
    location.reload();
  } catch (e) { alert("حصل خطأ: " + e.message); }
};

window.backupNowManual = function() { backupNow(true); };

// ===== زرار الحالة اللي بيظهر فوق =====
function updateBadge(text) {
  let b = document.getElementById("cloud-badge");
  if (!b) {
    b = document.createElement("div");
    b.id = "cloud-badge";
    b.style.cssText = "position:fixed;bottom:12px;left:12px;z-index:9999;background:#0f766e;color:#fff;padding:8px 12px;border-radius:20px;font-size:13px;box-shadow:0 2px 10px rgba(0,0,0,.3);cursor:pointer;display:flex;gap:8px;align-items:center;";
    b.innerHTML = `<span id="cloud-txt">☁️ متزامن</span><span style="background:#fff;color:#0f766e;padding:2px 8px;border-radius:10px;font-size:11px;" onclick="event.stopPropagation();backupNowManual()">حفظ الآن</span><span style="background:#fff;color:#0f766e;padding:2px 8px;border-radius:10px;font-size:11px;" onclick="event.stopPropagation();restoreCloud()">استرجاع</span>`;
    b.onclick = () => { if(confirm("تحب تسترجع آخر نسخة من السحابة؟")) restoreCloud(); };
    document.body.appendChild(b);
  }
  const t = document.getElementById("cloud-txt");
  if (t) t.textContent = text || (lastSyncTime ? `☁️ متزامن ${lastSyncTime}` : "☁️ متزامن");
}

// ===== استعادة تلقائية لو الجهاز جديد =====
async function autoRestoreIfEmpty() {
  // لو مفيش داتا محلية أو الداتا هي الديمو الافتراضية بس، اسأله يسترجع
  const local = localStorage.getItem("mgr6");
  let isEmpty = !local;
  if (local) {
    try {
      const s = JSON.parse(local);
      // لو مفيش غير العميل الافتراضي ومفيش فواتير، اعتبره جديد
      if (s.docs && s.docs.length === 0 && s.partners && s.partners.length <= 3) isEmpty = true;
    } catch(e) {}
  }
  if (!isEmpty) return;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from('factory_state').select('state').eq('user_id', user.id).single();
    if (data && data.state) {
      if (confirm("لقينا نسخة محفوظة في السحابة من جهاز تاني، تحب تسترجعها؟")) {
        localStorage.setItem("mgr6", JSON.stringify(data.state));
        location.reload();
      }
    }
  } catch(e) {}
}

// شغّل
updateBadge();
setTimeout(autoRestoreIfEmpty, 2000);
console.log("☁️ Cloud Sync V2 شغال");
