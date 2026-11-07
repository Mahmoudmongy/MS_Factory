// js/cloud-sync.js - V12 - FINAL - Dynamic + AR/EN + PC/Mobile - الملف الوحيد اللي هتعدله
import { supabase } from './supabase.js';

let saveTimer = null;
let lastSyncTime = "";
let lastLang = "";
let lastMode = "";

// ===== القاعدة 1: اللغة Dynamic - من إعدادات البرنامج نفسه =====
function isEN() {
  try {
    const pref = JSON.parse(localStorage.getItem("mgr6pref") || "{}");
    if (pref.lang) return pref.lang === "en";
  } catch(e){}
  return document.documentElement.lang === "en";
}
function T(ar, en) { return isEN() ? en : ar; }

// ===== القاعدة 2: الموبايل والكمبيوتر Dynamic - بيتحدد لوحده =====
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
  const all = Array.from(document.querySelectorAll("button, a"));
  return all.find(el => {
    const t = (el.textContent || "").trim();
    const id = (el.id || "").toLowerCase();
    return id.includes("logout") || id.includes("signout") || t === "تسجيل خروج" || t === "خروج" || t === "Logout" || t === "Log out" || t === "✕" || t === "✕ تسجيل الخروج" || t === "✕ Logout" || t === "X";
  });
}

// ===== شيل "مسجل الدخول" والإيميل نهائياً - Dynamic =====
function cleanUserBar() {
  const logout = findLogoutBtn();
  if (!logout) return;
  const bar = logout.parentElement;
  if (bar) {
    Array.from(bar.childNodes).forEach(n => {
      if (n.nodeType === 3 && (n.textContent.includes("مسجل") || n.textContent.includes("@") || n.textContent.includes("m.mongy"))) n.textContent = "";
    });
    Array.from(bar.children).forEach(ch => {
      if (ch === logout || ch.id === "cloud-badge") return;
      const txt = ch.textContent || "";
      if (txt.includes("مسجل") || txt.includes("@") || txt.includes("m.mongy") || txt.includes("Logged in")) {
        ch.style.display = "none";
        ch.textContent = "";
      }
    });
    bar.innerHTML = bar.innerHTML.replace(/\|/g, "");
  }
  // ✕ مربع في أقصى الطرف - عربي = شمال خالص | إنجليزي = يمين خالص
  const en = isEN();
  logout.textContent = "✕";
  logout.title = en ? "Logout" : "تسجيل الخروج";
  if (en) logout.style.cssText = "position:fixed;top:0;right:0;left:auto;z-index:100000;background:#ef4444;color:#fff;border:none;width:36px;height:36px;border-radius:0;font-size:18px;font-weight:bold;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;";
  else logout.style.cssText = "position:fixed;top:0;left:0;right:auto;z-index:100000;background:#ef4444;color:#fff;border:none;width:36px;height:36px;border-radius:0;font-size:18px;font-weight:bold;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;";
}

function drawBadge(text) {
  cleanUserBar();
  let b = document.getElementById("cloud-badge");
  if (!b) { b = document.createElement("div"); b.id = "cloud-badge"; document.body.appendChild(b); }
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

  if (mobile) {
    if (b.parentElement !== document.body) document.body.appendChild(b);
    const pad = en ? "padding:5px 40px 5px 8px;" : "padding:5px 8px 5px 40px;";
    b.style.cssText = "position:fixed;top:0;left:0;right:0;width:100%;z-index:99999;background:#0f766e;color:#fff;font-size:11px;font-weight:bold;display:flex;gap:6px;align-items:center;justify-content:center;flex-wrap:wrap;direction:" + (en ? "ltr" : "rtl") + ";border-radius:0;box-shadow:0 2px 8px rgba(0,0,0,.3);" + pad;
    document.body.style.paddingTop = "28px";
  } else {
    document.body.style.paddingTop = "";
    if (b.parentElement !== document.body) document.body.appendChild(b);
    if (en) b.style.cssText = "position:fixed;top:0;left:0;right:36px;z-index:99999;background:#0f766e;color:#fff;padding:6px 12px;font-size:13px;font-weight:bold;display:flex;gap:8px;align-items:center;justify-content:center;direction:ltr;border-radius:0;";
    else b.style.cssText = "position:fixed;top:0;left:36px;right:0;z-index:99999;background:#0f766e;color:#fff;padding:6px 12px;font-size:13px;font-weight:bold;display:flex;gap:8px;align-items:center;justify-content:center;direction:rtl;border-radius:0;";
  }
  lastLang = en ? "en" : "ar";
  lastMode = mobile ? "mobile" : "desktop";
  return b;
}

setInterval(() => {
  const b = document.getElementById("cloud-badge");
  const cur = isEN() ? "en" : "ar";
  const mode = isMobile() ? "mobile" : "desktop";
  if (!b || cur !== lastLang || mode !== lastMode) drawBadge();
  else cleanUserBar();
}, 500);

window.addEventListener("resize", () => drawBadge());
drawBadge();
console.log("☁️ Cloud Sync V12 شغال - Dynamic + AR/EN + PC/Mobile");
