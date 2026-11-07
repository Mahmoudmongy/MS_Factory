import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('ENV MISSING: VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is not set');
}

export const supabase = url && key ? createClient(url, key) : null;
