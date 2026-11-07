// js/cloud-sync.js - مزامنة تلقائية من غير ما نعدل app.js
import { supabase } from './supabase.js';

let saveTimer = null;
let lastSaved = "";

// دي الدالة اللي بتحفظ في السحابة
async function backupNow() {
  try {
    if (!navigator.onLine) return;
    const raw = localStorage.getItem("mgr6");
    if (!raw || raw === lastSaved) return;
    lastSaved = raw;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from('factory_state')
      .upsert({
        user_id: user.id,
        state: JSON.parse(raw),
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });

    if (error) console.error('Backup failed:', error);
    else console.log('✅ تم الحفظ في السحابة');
  } catch (e) {
    console.error('Backup error:', e);
  }
}

// بنراقب أي حفظ بيحصل في localStorage
// أول ما app.js يعمل sv() ويحفظ، احنا نلقطها ونبعتها للسحابة
const originalSetItem = localStorage.setItem.bind(localStorage);
localStorage.setItem = function(key, value) {
  originalSetItem(key, value);
  if (key === "mgr6") {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(backupNow, 1500);
  }
};

// دالة الاستعادة - هتشتغل من زرار في صفحة المزامنة
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
    alert("تمت الاستعادة ✅ - الصفحة هتتعاد تحميلها");
    location.reload();
  } catch (e) {
    alert("حصل خطأ: " + e.message);
  }
};

// دالة حفظ يدوي فوري
window.backupNowManual = function() {
  lastSaved = ""; // عشان يحفظ حتى لو مفيش تغيير
  backupNow();
  alert("جارٍ الحفظ في السحابة...");
};

console.log("☁️ Cloud Sync شغال");
