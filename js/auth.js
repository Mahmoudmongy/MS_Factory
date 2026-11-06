import { supabase } from './supabase.js';

const MESSAGES = {
  invalid: 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
  exists: 'هذا البريد مسجل بالفعل، سجّل الدخول بدلاً من ذلك',
  generic: 'حدث خطأ، حاول مرة أخرى',
  created: 'تم إنشاء الحساب بنجاح',
};

const $ = (id) => document.getElementById(id);
const status = $('auth-status');
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

function start() {
  if (!supabase) {
    status.textContent = 'غير متصل';
    status.style.color = 'var(--rd)';
    form.querySelectorAll('input, button').forEach((el) => (el.disabled = true));
    return;
  }
  status.textContent = 'متصل بـ Supabase';
  status.style.color = 'var(--pr)';
  init(supabase);
}

async function init(client) {
  const { data, error } = await client.auth.getSession();
  if (error) say(MESSAGES.generic);
  showSession(data?.session ?? null);

  client.auth.onAuthStateChange((_event, session) => {
    showSession(session);
  });

  $('auth-login').addEventListener('click', async (e) => {
    e.preventDefault();
    const { email, password } = credentials();
    if (!email || !password) return say('أدخل البريد الإلكتروني وكلمة المرور');
    say('');
    try {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) say(errorText(error));
    } catch {
      say(MESSAGES.generic);
    }
  });

 $('auth-signup').addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const { email, password } = credentials();
    if (!email || !password) return say('أدخل البريد الإلكتروني وكلمة المرور');
    if (password.length < 6) return say('كلمة المرور يجب ألا تقل عن 6 أحرف');
    say('جاري إنشاء الحساب...', false);
    try {
      const { data, error } = await client.auth.signUp({ email, password });
      if (error) {
        alert('خطأ: ' + error.message);
        return say(errorText(error));
      }
      alert('تم إنشاء الحساب بنجاح ✅');
      if (!data.session) say(MESSAGES.created, false);
    } catch (err) {
      alert('حدث خطأ: ' + err.message);
      say(MESSAGES.generic);
    }
    return false;
  });
}

start();
