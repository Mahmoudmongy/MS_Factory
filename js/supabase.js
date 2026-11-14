import { createClient } from '@supabase/supabase-js';

// Production Supabase project (MS Factory).
const PRODUCTION_URL = 'https://amtorqmzctshfzaoiovz.supabase.co';
const PRODUCTION_KEY = 'sb_publishable_bin2D3xyMXQjt_Xis6Gj-g_n7VMil-x';
const PRODUCTION_REF = 'amtorqmzctshfzaoiovz';

const configuredUrl = import.meta.env.VITE_SUPABASE_URL;
const configuredKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const configuredRef = configuredUrl ? (() => {
  try { return new URL(configuredUrl).hostname.split('.')[0]; }
  catch (_) { return ''; }
})() : '';

// Never allow a stale QA/legacy build variable to redirect production login.
const useProduction = !configuredUrl || configuredRef !== PRODUCTION_REF;
const url = useProduction ? PRODUCTION_URL : configuredUrl;
const key = useProduction ? PRODUCTION_KEY : (configuredKey || PRODUCTION_KEY);

const storage = {
  getItem(key) {
    try { return (localStorage.getItem('factory-remember') === '0' ? sessionStorage : localStorage).getItem(key); }
    catch (_) { return null; }
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
    try { localStorage.removeItem(key); sessionStorage.removeItem(key); }
    catch (_) {}
  }
};

if (useProduction) console.warn('Supabase config missing or not Production; pinned to Production project.');
export const supabase = createClient(url, key, {
  auth: { storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
