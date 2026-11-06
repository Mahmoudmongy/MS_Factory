const MESSAGES = {
  invalid: 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
  exists: 'هذا البريد مسجل بالفعل، سجّل الدخول بدلاً من ذلك',
  generic: 'حدث خطأ، حاول مرة أخرى',
  notConfigured: 'الربط بـ Supabase غير مكتمل. أضف الرابط والمفتاح في ملف الإعدادات ثم أعد تحميل الصفحة',
  created: 'تم إنشاء الحساب بنجاح',
};

const $ = (id) => document.getElementById(id);
const msg = $('auth-msg');
const form = $('auth-form');

function say(text, isError = true) {
  msg.textContent = text;
  msg.style.color = isError ? 'var(--rd)' : 'var(--pr)';
}

function errorText(error) {
  const m = (error?.message || '').toLowerCase();
  if (m.includes('invalid login')) return MESSAGES.invalid;
  if (m.includes('already registered')) return MESSAGES.exists;
  return MESSAGES.generic;
}

function showSession(session) {
  const signedIn = Boolean(session);
  form.hidden = signedIn;
  $('auth-session').hidden = !signedIn;
  $('auth-user').textContent = session?.user?.email || '';
}

function credentials() {
  return {
    email: $('auth-email').value.trim(),
    password: $('auth-password').value,
  };
}

async function init() {
  let supabase;
  try {
    ({ supabase } = await import('./supabase.js'));
  } catch {
    say(MESSAGES.notConfigured);
    form.querySelectorAll('input, button').forEach((el) => (el.disabled = true));
    return;
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) say(MESSAGES.generic);
  showSession(data?.session ?? null);

  supabase.auth.onAuthStateChange((_event, session) => {
    showSession(session);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { email, password } = credentials();
    if (!email || !password) return say('أدخل البريد الإلكتروني وكلمة المرور');
    say('');
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) say(errorText(error));
    } catch {
      say(MESSAGES.generic);
    }
  });

  $('auth-signup').addEventListener('click', async () => {
    const { email, password } = credentials();
    if (!email || !password) return say('أدخل البريد الإلكتروني وكلمة المرور');
    if (password.length < 6) return say('كلمة المرور يجب ألا تقل عن 6 أحرف');
    say('');
    try {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) return say(errorText(error));
      if (!data.session) say(MESSAGES.created, false);
    } catch {
      say(MESSAGES.generic);
    }
  });

  $('auth-logout').addEventListener('click', async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) say(MESSAGES.generic);
    } catch {
      say(MESSAGES.generic);
    }
  });
}

init();
