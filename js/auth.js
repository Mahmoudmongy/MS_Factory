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

function showSession(session) {
  const signedIn = Boolean(session);
  if(form) form.hidden = signedIn;
  const s = $('auth-session');
  if(s) s.hidden = !signedIn;
  const u = $('auth-user');
  if(u) u.textContent = session?.user?.email || '';
}

if (!supabase) {
  if(status) status.textContent = 'غير متصل';
  say('غير متصل');
} else {
  if(status) status.textContent = 'متصل بـ Supabase ✅';

  supabase.auth.getSession().then(({ data }) => {
    showSession(data?.session ?? null);
  });

  supabase.auth.onAuthStateChange((_e, session) => showSession(session));

  $('auth-login').addEventListener('click', async (e) => {
    e.preventDefault();
    const { email, password } = credentials();
    if (!email || !password) return say('أدخل البريد الإلكتروني وكلمة المرور');
    say('جاري تسجيل الدخول...', false);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return say('خطأ دخول: ' + error.message);
    say('تم الدخول بنجاح ✅', false);
    setTimeout(()=> location.href='index.html', 800);
  });

  $('auth-logout').addEventListener('click', async () => {
  await supabase.auth.signOut();
  // امسح الخانات
  $('auth-email').value = '';
  $('auth-password').value = '';
  // امسح اللي المتصفح حافظه
  $('auth-email').setAttribute('autocomplete', 'off');
  $('auth-password').setAttribute('autocomplete', 'off');
  location.reload();
});
}
