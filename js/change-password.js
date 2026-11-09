import { supabase } from './supabase.js';

const $ = (id) => document.getElementById(id);
const message = $('cp-message');
const form = $('cp-form');
const submit = $('cp-submit');
let currentUser = null;
let currentProfile = null;

function say(text, isError = true) {
  message.textContent = text;
  message.style.color = isError ? '#b91c1c' : '#047857';
  message.style.display = 'block';
}

async function boot() {
  if (!navigator.onLine) {
    say('تغيير كلمة المرور يحتاج اتصال بالإنترنت. اتصل بالإنترنت ثم أعد فتح الصفحة.');
    return;
  }
  if (!supabase) {
    say('تعذر الاتصال بخدمة تسجيل الدخول. راجع إعدادات الاتصال وحاول مرة أخرى.');
    return;
  }
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  currentUser = sessionData?.session?.user || null;
  if (sessionError || !currentUser) {
    location.replace('auth.html');
    return;
  }
  const { data: profile, error } = await supabase.from('profiles')
    .select('id,username,full_name,is_admin,must_change_password')
    .eq('id', currentUser.id).maybeSingle();
  if (error || !profile) {
    say('تعذر التحقق من ملف الحساب. تأكد من اتصال الإنترنت ثم حاول مرة أخرى.');
    return;
  }
  currentProfile = profile;
  if (profile.is_admin === true || profile.must_change_password !== true) {
    location.replace('index.html');
    return;
  }
  $('cp-user').textContent = 'الحساب: ' + (profile.full_name || profile.username || currentUser.email || '');
  form.hidden = false;
}

submit?.addEventListener('click', async () => {
  const password = $('cp-password').value;
  const confirm = $('cp-confirm').value;
  if (password.length < 10) return say('كلمة المرور الجديدة يجب ألا تقل عن 10 أحرف.');
  if (password.length > 128) return say('كلمة المرور طويلة أكثر من اللازم.');
  if (password !== confirm) return say('كلمتا المرور غير متطابقتين.');
  submit.disabled = true;
  say('جارٍ حفظ كلمة المرور...', false);
  const { data, error } = await supabase.functions.invoke('change-initial-password', { body: { password } });
  if (error || data?.error || data?.success !== true) {
    submit.disabled = false;
    return say(data?.error || error?.message || 'تعذر تغيير كلمة المرور. حاول مرة أخرى.');
  }
  if (currentProfile) {
    currentProfile.must_change_password = false;
    try {
      localStorage.setItem('factory-profile:' + currentUser.id, JSON.stringify(currentProfile));
      localStorage.setItem('factory-profile-verified:' + currentUser.id, String(Date.now()));
    } catch (_) {}
  }
  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) {
    say('تم تغيير كلمة المرور. سجّل الدخول مرة أخرى باستخدام كلمة المرور الجديدة.', false);
    setTimeout(async () => {
      await supabase.auth.signOut();
      location.replace('auth.html');
    }, 1200);
    return;
  }
  say('تم تغيير كلمة المرور بنجاح. جاري فتح البرنامج...', false);
  setTimeout(() => location.replace('index.html'), 700);
});

$('cp-logout')?.addEventListener('click', async () => {
  if (supabase) await supabase.auth.signOut();
  location.replace('auth.html');
});

boot().catch((error) => {
  console.error('First-login password change failed:', error);
  say('حدث خطأ غير متوقع. أعد المحاولة بعد التأكد من الاتصال.');
});
