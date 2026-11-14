import { supabase } from './supabase.js';

const $ = (id) => document.getElementById(id);
const status = $('auth-status');
const msg = $('auth-msg');
const form = $('auth-form');
const rememberBox = $('auth-remember');

function applyFactoryBranding() {
  const nameNode = $('auth-brand-name');
  const logoNode = $('auth-brand-logo');
  if (nameNode) {
    nameNode.textContent = 'مدير المصنع';
    document.title = 'مدير المصنع - تسجيل الدخول';
  }
  if (logoNode) {
    logoNode.hidden = true;
    logoNode.removeAttribute('src');
  }
  try {
    const brand = JSON.parse(localStorage.getItem('factory-branding') || '{}');
    const name = typeof brand.name === 'string' ? brand.name.trim().slice(0, 120) : '';
    if (name && nameNode) {
      nameNode.textContent = name;
      document.title = name + ' - تسجيل الدخول';
    }
    const logo = typeof brand.logo === 'string' ? brand.logo : '';
    if (logoNode && /^data:image\/(?:jpeg|png|webp);base64,/i.test(logo)) {
      logoNode.src = logo;
      logoNode.hidden = false;
      logoNode.onerror = () => { logoNode.hidden = true; logoNode.removeAttribute('src'); };
    }
  } catch (_) {}
}

applyFactoryBranding();
window.addEventListener('storage', (event) => {
  if (event.key === 'factory-branding') applyFactoryBranding();
});
if (rememberBox) rememberBox.checked = localStorage.getItem('factory-remember') !== '0';
try { $('auth-email').value = localStorage.getItem('factory-login-name') || ''; } catch (_) {}

function say(text, isError = true) {
  if(!msg) return;
  msg.textContent = text;
  msg.dataset.kind = isError ? 'error' : 'success';
  msg.style.display = 'block';
  
}

function credentials() {
  const entered = $('auth-email').value.trim();
  const email = entered.includes('@') || !entered ? entered : `${entered.toLowerCase()}@ms-factory.local`;
  return {
    email,
    password: $('auth-password').value,
  };
}

if (!supabase) {
  if(status) status.textContent = 'إعداد تسجيل الدخول غير متاح';
  say('تعذر تهيئة خدمة تسجيل الدخول. أعد تحميل الصفحة أو تواصل مع المسؤول.');
} else {
  if(status) status.textContent = 'جاهز لتسجيل الدخول';

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { email, password } = credentials();
    if (!email || !password) return say('أدخل اسم المستخدم أو البريد الإلكتروني وكلمة المرور');
    const remember = $('auth-remember')?.checked !== false;
    try { localStorage.setItem('factory-remember', remember ? '1' : '0'); if (remember) localStorage.setItem('factory-login-name', $('auth-email').value.trim()); else localStorage.removeItem('factory-login-name'); } catch (_) {}
    const projectRef = new URL('https://amtorqmzctshfzaoiovz.supabase.co').hostname.split('.')[0];
    const storageKey = 'sb-' + projectRef + '-auth-token';
    try { if (remember) sessionStorage.removeItem(storageKey); else localStorage.removeItem(storageKey); } catch (_) {}
    say('جارٍ تسجيل الدخول...', false);
    const button = $('auth-login');
    button.disabled = true;
    try {
      const result = await Promise.race([
        supabase.auth.signInWithPassword({ email, password }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('انتهت مهلة الاتصال. تحقق من الإنترنت وحاول مرة أخرى.')), 12000))
      ]);
      if (result.error) {
        console.warn('Login failed:', result.error);
        const detail = String(result.error.message || '').toLowerCase();
        if (detail.includes('invalid login credentials')) return say('اسم المستخدم أو كلمة المرور غير صحيحة.');
        if (detail.includes('email not confirmed')) return say('الحساب غير مؤكد. تواصل مع المسؤول.');
        return say('تعذر تسجيل الدخول. تحقق من بياناتك واتصال الإنترنت ثم حاول مرة أخرى.');
      }
      say('تم الدخول بنجاح ✅', false);
      location.replace('index.html');
    } catch (error) {
      console.warn('Login request failed:', error);
      say(error?.message?.includes('انتهت مهلة الاتصال') ? error.message : 'تعذر الاتصال بخدمة تسجيل الدخول. تحقق من الإنترنت وحاول مرة أخرى.');
    } finally {
      button.disabled = false;
    }
  });

}
