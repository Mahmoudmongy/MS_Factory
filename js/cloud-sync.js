// js/cloud-sync.js - V13 - FINAL - ✕ بتاعنا احنا، مش بتاع index - Dynamic + AR/EN + PC/Mobile
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

// ===== زرار الخروج بتاعنا - مش بنستخدم بتاع index خالص =====
async function doLogout() {
  if (!confirm(T("متأكد عايز تسجل خروج؟", "Are you sure you want to logout?"))) return;
  try { await supabase.auth.signOut(); } catch(e){}
  try { localStorage.removeItem("mgr6"); } catch(e){}
  location.href = "auth.html";
}

// ===== اخفي أي حاجة قديمة فيها "مسجل الدخول" أو الإيميل أو زرار خروج قديم =====
function hideOldUserBar() {
  document.querySelectorAll("button, a, span, div, p, small").forEach(el => {
    if (el.id === "cloud-badge" || el.id === "ms-logout-btn" || el.closest("#cloud-badge") || el.closest("#ms-logout-btn")) return;
    const txt = (el.textContent || "");
    // لو العنصر ده فيه "مسجل الدخول" أو إيميل، وكان صغير (مش الصفحة كلها)، اخفيه
    if ((txt.includes("مسجل الدخول") || txt.includes("Logged in as")) && el.children.length === 0) {
      el.style.display = "none";
    }
    // اخفي زرار الخروج القديم نفسه، عشان احنا عندنا واحد جديد
    const id = (el.id || "").toLowerCase();
    const t = txt.trim();
    if ((id.includes("logout") || t === "تسجيل خروج" || t === "Logout") && el.id !== "ms-logout-btn") {
      el.style.display = "none";
    }
  });
  // امسح أي Text Node فيها إيميل من الـ body مباشرة
  Array.from(document.body.childNodes).forEach(n => {
    if (n.nodeType === 3 && (n.textContent.includes("مسجل") || n.textContent.includes("@"))) n.textContent = "";
  });
}

// ===== ارسم الشريط + مربع ✕ =====
function drawAll(text) {
  hideOldUserBar();
  const en = isEN();
  const mobile = isMobile();

  // 1. مربع ✕ - بتاعنا، في أقصى الطرف، فوق خالص
  let x = document.getElementById("ms-logout-btn");
  if (!x) {
    x = document.createElement("button");
    x.id = "ms-logout-btn";
    x.onclick = doLogout;
    document.body.appendChild(x);
  }
  x.textContent = "✕";
  x.title = en ? "Logout" : "تسجيل الخروج";
  if (en) x.style.cssText = "position:fixed;top:0;right:0;left:auto;z-index:100001;background:#ef4444;color:#fff;border:none;width:36px;height:36px;border-radius:0;font-size:18px;font-weight:bold;cursor:pointer;display:flex;align-items:center;justify-content:center;";
  else x.style.cssText = "position:fixed;top:0;left:0;right:auto;z-index:100001;background:#ef4444;color:#fff;border:none;width:36px;height:36px;border-radius:0;font-size:18px;font-weight:bold;cursor:pointer;display:flex;align-items:center;justify-content:center;";

  // 2. شريط السحابة
  let b = document.getElementById("cloud-badge");
  if (!b) { b = document.createElement("div"); b.id = "cloud-badge"; document.body.appendChild(b); }
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

  if (mobile) {
    const pad = en ? "padding:5px 40px 5px 8px;" : "padding:5px 8px 5px 40px;";
    b.style.cssText = "position:fixed;top:0;left:0;right:0;width:100%;z-index:99999;background:#0f766e;color:#fff;font-size:11px;font-weight:bold;display:flex;gap:6px;align-items:center;justify-content:center;flex-wrap:wrap;direction:" + (en ? "ltr" : "rtl") + ";border-radius:0;box-shadow:0 2px 8px rgba(0,0,0,.3);" + pad;
    document.body.style.paddingTop = "28px";
  } else {
    document.body.style.paddingTop = "";
    if (en) b.style.cssText = "position:fixed;top:0;left:0;right:36px;z-index:99999;background:#0f766e;color:#fff;padding:6px 12px;font-size:13px;font-weight:bold;display:flex;gap:8px;align-items:center;justify-content:center;direction:ltr;border-radius:0;";
    else b.style.cssText = "position:fixed;top:0;left:36px;right:0;z-index:99999;background:#0f766e;color:#fff;padding:6px 12px;font-size:13px;font-weight:bold;display:flex;gap:8px;align-items:center;justify-content:center;direction:rtl;border-radius:0;";
  }

  lastLang = en ? "en" : "ar";
  lastMode = mobile ? "mobile" : "desktop";
  return b;
}

setInterval(() => {
  const b = document.getElementById("cloud-badge");
  const x = document.getElementById("ms-logout-btn");
  const cur = isEN() ? "en" : "ar";
  const mode = isMobile() ? "mobile" : "desktop";
  if (!b || !x || cur !== lastLang || mode !== lastMode) drawAll();
  else hideOldUserBar();
}, 500);

window.addEventListener("resize", () => drawAll());
drawAll();
console.log("☁️ Cloud Sync V13 شغال - ✕ بتاعنا");
