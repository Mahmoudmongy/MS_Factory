// js/supabase.js - public browser configuration only.
// Never place a service_role or secret key in this file.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// The project URL and publishable key are public client credentials.
const SUPABASE_URL = "https://yvrislcbbhtruwdnuooz.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_7y8sqUPYv4mCfmpjin3xRQ_1_X5QJfG";

let supabase = null;
if (SUPABASE_URL.startsWith('https://') && SUPABASE_ANON_KEY.length > 20) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} else {
  console.log('Supabase غير متصل - راجع إعدادات المشروع');
}

export { supabase };
export const supabaseClient = supabase;
