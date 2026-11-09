import { createClient } from '@supabase/supabase-js';

const PRODUCTION_URL = 'https://yvrislcbbhtruwdnuooz.supabase.co';
const PRODUCTION_KEY = 'sb_publishable_7y8sqUPYv4mCfmpjin3xRQ_1_X5QJfG';
const PRODUCTION_REF = 'yvrislcbbhtruwdnuooz';
const configuredUrl = import.meta.env.VITE_SUPABASE_URL || '';
const configuredRef = configuredUrl ? (() => {
  try { return new URL(configuredUrl).hostname.split('.')[0]; }
  catch (_) { return ''; }
})() : '';

// Production is pinned deliberately. A QA URL in a local or CI environment
// must never redirect the live factory app to the QA database.
export const supabaseProjectRef = PRODUCTION_REF;
const storage = {
  getItem(key) {
    try {
      return (localStorage.getItem('factory-remember') === '0' ? sessionStorage : localStorage).getItem(key);
    } catch (_) { return null; }
  },
  setItem(key, value) {
    try {
      const persistent = localStorage.getItem('factory-remember') !== '0';
      const target = persistent ? localStorage : sessionStorage;
      (persistent ? sessionStorage : localStorage).removeItem(key);
      target.setItem(key, value);
    } catch (error) { console.warn('Auth session storage failed:', error); }
  },
  removeItem(key) {
    try { localStorage.removeItem(key); sessionStorage.removeItem(key); } catch (_) {}
  }
};
if (configuredRef && configuredRef !== PRODUCTION_REF) {
  console.error('Ignored non-production Supabase endpoint; MS Factory is pinned to production.');
}
export const supabase = createClient(PRODUCTION_URL, PRODUCTION_KEY, {
  auth: { storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
