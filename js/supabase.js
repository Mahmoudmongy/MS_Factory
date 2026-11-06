// js/supabase.js - نسخة مصلحة من غير .env
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// ===== حطي بياناتك هنا =====
const SUPABASE_URL = "https://yvrislcbbhtruwdnuooz.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_7y8sqUPYv4mCfmpjin3xRQ_1_X5QJfG";
// ===========================

let supabase = null;

if (SUPABASE_URL.startsWith('https://') && SUPABASE_ANON_KEY.length > 20) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} else {
  console.log('Supabase غير متصل - حط الـ URL والـ Key');
}

export { supabase };
export const supabaseClient = supabase;
