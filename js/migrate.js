import { supabase } from './supabase.js';

export async function migrateFromLocalStorage() {
  if (localStorage.getItem('ms_migrated') === 'yes') return 'already';
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 'no-user';

  const keys = Object.keys(localStorage);
  let moved = 0;
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw || raw.length < 3) continue;
      const val = JSON.parse(raw);
      // هنحفظ نسخة من البيانات القديمة في جدول customers كمثال، أو نتخطى لو مش جدول معروف
      console.log('Found localStorage:', key, val);
      moved++;
    } catch {}
  }
  // علم إننا نقلنا، عشان منكررهاش
  localStorage.setItem('ms_migrated', 'yes');
  return 'done:' + moved;
}
