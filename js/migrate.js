import { supabase } from './supabase.js';

// Upload the complete local application state before marking migration complete.
// This replaces the former key-counting placeholder; local data is never deleted.
export async function migrateFromLocalStorage() {
  if (localStorage.getItem('ms_migrated') === 'yes') return 'already';
  if (!supabase) return 'no-supabase';

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return 'no-user';

  const raw = localStorage.getItem('mgr6');
  if (!raw) return 'no-data';

  let state;
  try { state = JSON.parse(raw); }
  catch { return 'invalid-local-data'; }
  if (!state || typeof state !== 'object' || Array.isArray(state)) return 'invalid-local-data';

  const { error } = await supabase.from('factory_state').upsert({
    user_id: user.id,
    state,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });

  if (error) {
    console.error('Local data migration failed:', error);
    return 'error:' + error.message;
  }

  localStorage.setItem('ms_migrated', 'yes');
  return 'done:1';
}
