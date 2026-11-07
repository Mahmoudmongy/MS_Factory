// js/cloud-sync.js - V17 - FINAL - ✕ مربع زي ما هو - شمال عربي / يمين إنجليزي - موبايل مظبوط
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

async function doLogout() {
  if (!confirm(T("متأكد عايز تسجل خروج؟", "Are you sure you want to logout?"))) return;
  try { await supabase.auth.signOut(); } catch(e){}
  location.href = "auth.html";
}

function purgeLoggedInText() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
  const toRemove = [];
  let node;
  while (node = walker.nextNode()) {
    if (node.parentElement && node.parentElement.closest("#ms-topbar")) continue;
    const t = node.textContent || "";
    if (t.includes("مسجل الدخول") || t.includes("Logged in as") || t.includes("m.mongy") || t.includes("@gmail")) toRemove.push(node);
  }
  toRemove.forEach(n => { n.textContent = ""; });
  document.querySelectorAll("div, span, p, small, header, section").forEach(el => {
    if (el.id === "ms-topbar" || el.closest("#ms-topbar")) return;
    const txt = el.textContent || "";
    if ((txt.includes("مسجل الدخول") || txt.includes("Logged in as")) && el.children.length <= 3) {
      const h = el.getBoundingClientRect ? el.getBoundingClientRect().height : 999;
      if (h < 120) { el.style.display = "none"; el.style.height = "0px"; el.style.padding = "0px"; el.style.margin = "0px"; el.style.overflow = "hidden"; }
    }
    const id = (el.id || "").toLowerCase();
    const tt = txt.trim();
    if ((id.includes("logout") || tt === "تسجيل خروج" || tt === "Logout") && el.id !== "ms-logout-btn" && !el.closest("#ms-topbar")) el.style.display = "none";
  });
}

const observer = new MutationObserver(() => { purgeLoggedInText(); });
observer.observe(document.body, { childList: true, subtree: true, characterData: true });

function drawAll(text) {
  purgeLoggedInText();
  const en = isEN();
  const mobile = isMobile();

  let top = document.getElementById("ms-topbar");
  if (!top) { top = document.createElement("div"); top.id = "ms-topbar"; document.body.prepend(top); }

  // الشريط نفسه: اتجاهه ثابت ltr عشان الشمال يفضل شمال واليمين يفضل يمين، مش بيتقلب
  top.style.cssText = "position:fixed;top:0;left:0;right:0;width:100%;height:36px;z-index:100000;display:flex;align-items:center;justify-content:center;background:transparent;direction:ltr;box-sizing:border-box;";

  top.innerHTML = "";

  // 1. ✕ مربع زي ما هو - 36x36 بالظبط، مش مفرود، مش دايرة
  const x = document.createElement("button");
  x.id = "ms-logout-btn";
  x.textContent = "✕";
  x.title = en ? "Logout" : "تسجيل الخروج";
  x.onclick = doLogout;
  // عربي = left:0 شمال خالص | إنجليزي = right:0 يمين خالص - بـ absolute عشان ميتقلبش
  if (en) x.style.cssText = "position:absolute;top:0;right:0;left:auto;width:36px;height:36px;min-width:36px;max-width:36px;min-height:36px;max-height:36px;background:#ef4444;color:#fff;border:none;border-radius:0;font-size:18px;font-weight:bold;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;";
  else x.style.cssText = "position:absolute;top:0;left:0;right:auto;width:36px;height:36px;min-width:36px;max-width:36px;min-height:36px;max-height:36px;background:#ef4444;color:#fff;border:none;border-radius:0;font-size:18px;font-weight:bold;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;";

  // 2. حباية السحابة في النص
  const b = document.createElement("div");
  b.id = "cloud-badge";
  const label = mobile ? T("☁️ متزامن", "☁️ Synced") : (text || (lastSyncTime ? `${T("☁️ متزامن", "☁️ Synced")} ${lastSyncTime}` : T("☁️ متزامن", "☁️ Synced")));
  const s1 = document.createElement("span"); s1.textContent = label; s1.style.whiteSpace = "nowrap";
  const s2 = document.createElement("span"); s2.textContent = T("حفظ الآن", "Save Now");
  s2.style.cssText = "background:#fff;color:#0f766e;padding:2px 10px;border-radius:12px;cursor:pointer;white-space:nowrap;" + (mobile ? "font-size:11px;" : "");
  s2.onclick = (e) => { e.stopPropagation(); backupNowManual(); };
  const s3 = document.createElement("span"); s3.textContent = T("استرجاع", "Restore");
  s3.style.cssText = "background:#fff;color:#0f766e;padding:2px 10px;border-radius:12px;cursor:pointer;white-space:nowrap;" + (mobile ? "font-size:11px;" : "");
  s3.onclick = (e) => { e.stopPropagation(); restoreCloud(); };
  b.appendChild(s1); b.appendChild(s2); b.appendChild(s3);
  b.style.cssText = "background:#0f766e;color:#fff;padding:6px 12px;border-radius:20px;display:flex;gap:" + (mobile ? "6px" : "8px") + ";align-items:center;justify-content:center;flex-wrap:nowrap;white-space:nowrap;font-size:" + (mobile ? "11px" : "13px") + ";font-weight:bold;direction:" + (en ? "ltr" : "rtl") + ";box-shadow:0 2px 10px rgba(0,0,0,.3);max-width:calc(100% - 80px);overflow:hidden;";

  top.appendChild(b);
  top.appendChild(x);

  document.body.style.paddingTop = "36px";
  lastLang = en ? "en" : "ar";
  lastMode = mobile ? "mobile" : "desktop";
}

setInterval(() => {
  const top = document.getElementById("ms-topbar");
  const cur = isEN() ? "en" : "ar";
  const mode = isMobile() ? "mobile" : "desktop";
  if (!top || cur !== lastLang || mode !== lastMode) drawAll();
  else purgeLoggedInText();
}, 500);

window.addEventListener("resize", () => drawAll());
drawAll();
console.log("☁️ Cloud Sync V17 شغال - مربع مظبوط");
