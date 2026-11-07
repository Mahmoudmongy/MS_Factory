// js/cloud-sync.js - V9 - فوق خالص + ✕ خروج بس + موبايل + AR/EN
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

// ===== نلاقي زرار الخروج - حتى لو بقى ✕ =====
function findLogoutBtn() {
  const all = Array.from(document.querySelectorAll("button, a"));
  return all.find(el => {
    const t = (el.textContent || "").trim();
    const id = (el.id || "").toLowerCase();
    return id.includes("logout") || id.includes("signout") || t === "تسجيل خروج" || t === "خروج" || t === "Logout" || t === "Log out" || t === "✕" || t === "✕ تسجيل الخروج" || t === "✕ Logout" || t === "X";
  });
}

// ===== ده اللي بيشيل جملة "مسجل الدخول باسم..." =====
function cleanUserBar() {
  // اخفي أي عنصر فيه جملة مسجل الدخول أو الإيميل، وسيب زرار الخروج بس
  const logout = findLogoutBtn();
  document.querySelectorAll("span, div, p, small").forEach(el => {
    const txt = (el.textContent || "");
    if (el === logout || el.contains(logout)) return;
    if (txt.includes("مسجل الدخول") || txt.includes("مسجل الدخول باسم") || txt.includes("Logged in as") || txt.includes("Signed in as")) {
      // لو العنصر ده هو اللي فيه الإيميل بس، اخفيه
      if (el.children.length === 0) el.style.display = "none";
      else {
        // لو فيه الإيميل + الزرار مع بعض، اخفي نص الإيميل بس عن طريق إخفاء الـ span اللي فيه @
        Array.from(el.childNodes).forEach(n => {
          if (n.nodeType === 3 && (n.textContent.includes("@") || n.textContent.includes("مسجل"))) n.textContent = "";
        });
        Array.from(el.children).forEach(ch => {
          if (ch !== logout && (ch.textContent || "").includes("@")) ch.style.display = "none";
        });
      }
    }
  });
  // حول زرار الخروج لـ ✕ بس
  if (logout) {
    logout.textContent = "✕";
    logout.title = isEN() ? "Logout" : "تسجيل الخروج";
    logout.style.cssText = "background:#ef4444;color:#fff;border:none;width:28px;height:28px;border-radius:50%;font-size:14px;font-weight:bold;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;";
  }
}

function drawBadge(text) {
  cleanUserBar();
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

  const logout = findLogoutBtn();

  // ===== موبايل: شريط رفيع فوق خالص، فيه السحابة + ✕ جنب بعض =====
  if (mobile) {
    if (b.parentElement !== document.body) document.body.appendChild(b);
    b.style.cssText = "position:fixed;top:0;left:0;right:0;width:100%;z-index:99999;background:#0f766e;color:#fff;padding:5px 8px;font-size:11px;font-weight:bold;display:flex;gap:6px;align-items:center;justify-content:center;flex-wrap:wrap;direction:" + (en ? "ltr" : "rtl") + ";border-radius:0;box-shadow:0 2px 8px rgba(0,0,0,.3);";
    // حط ✕ جوه نفس الشريط على الموبايل عشان ميغطيش على حاجة
    if (logout && logout.parentElement !== b) b.appendChild(logout);
    document.body.style.paddingTop = "28px";
  } else {
    document.body.style.paddingTop = "";
    // ===== كمبيوتر: جنب ✕ فوق خالص =====
    if (logout && logout.parentElement && logout.parentElement !== b) {
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
      if (b.parentElement !== document.body) document.body.appendChild(b);
      if (en) b.style.cssText = "position:fixed;top:6px;right:12px;z-index:99999;background:#0f766e;color:#fff;padding:6px 12px;border-radius:20px;font-size:13px;font-weight:bold;display:flex;gap:8px;align-items:center;direction:ltr;";
      else b.style.cssText = "position:fixed;top:6px;left:12px;z-index:99999;background:#0f766e;color:#fff;padding:6px 12px;border-radius:20px;font-size:13px;font-weight:bold;display:flex;gap:8px;align-items:center;direction:rtl;";
      // لو ✕ بره، حطه جنب الزرار في نفس السطر
      if (logout && logout.parentElement !== b && logout.parentElement !== document.body) {
        logout.style.position = "fixed";
        logout.style.top = "6px";
        logout.style.zIndex = "99999";
        logout.style.left = en ? "auto" : "12px";
        logout.style.right = en ? "12px" : "auto";
      }
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
  else cleanUserBar();
}, 500);

window.addEventListener("resize", () => drawBadge());
drawBadge();
console.log("☁️ Cloud Sync V9 شغال - ✕ بس");
