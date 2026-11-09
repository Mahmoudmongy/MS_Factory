import { supabase } from './supabase.js';

const $ = (id) => document.getElementById(id);
const status = $('auth-status');
const msg = $('auth-msg');
const form = $('auth-form');

function say(text, isError = true) {
  if(!msg) return;
  msg.textContent = text;
  msg.style.color = isError ? 'red' : 'green';
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

function showSession(session) { if (session) location.replace('index.html'); }

if (!supabase) {
  if(status) status.textContent = 'غير متصل';
  say('غير متصل');
} else {
  if(status) status.textContent = 'متصل';

  supabase.auth.getSession().then(({ data }) => { if(data?.session) location.replace('index.html'); });

  supabase.auth.onAuthStateChange((_e, session) => { if(session) location.replace('index.html'); });

  $('auth-login').addEventListener('click', async (e) => {
    e.preventDefault();
    const { email, password } = credentials();
    if (!email || !password) return say('أدخل البريد الإلكتروني وكلمة المرور');
    const remember = $('auth-remember')?.checked !== false;
    try { localStorage.setItem('factory-remember', remember ? '1' : '0'); } catch (_) {}
    const projectRef = new URL(import.meta.env.VITE_SUPABASE_URL || 'https://yvrislcbbhtruwdnuooz.supabase.co').hostname.split('.')[0];
    const storageKey = 'sb-' + projectRef + '-auth-token';
    try { if (remember) sessionStorage.removeItem(storageKey); else localStorage.removeItem(storageKey); } catch (_) {}
    say('جاري تسجيل الدخول...', false);
    $('auth-login').disabled = true;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    $('auth-login').disabled = false;
    if (error) return say('خطأ دخول: ' + error.message);
    say('تم الدخول بنجاح ✅', false);
    setTimeout(()=> location.href='index.html', 800);
  });

}
