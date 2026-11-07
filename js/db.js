// js/db.js - طبقة المزامنة مع Supabase + دوال قديمة
import { supabase } from './supabase.js';

let saveTimer = null;
let lastSaved = "";

// ===== 1. حفظ نسخة كاملة في السحابة =====
export function backupToCloud(S) {
  if (!navigator.onLine) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const json = JSON.stringify(S);
      if (json === lastSaved) return;
      lastSaved = json;

      const { error } = await supabase
        .from('factory_state')
        .upsert({
          user_id: user.id,
          state: S,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });

      if (error) console.error('Backup failed:', error);
      else console.log('✅ تم الحفظ في السحابة');
    } catch (e) {
      console.error('Backup error:', e);
    }
  }, 1500);
}

// ===== 2. استعادة النسخة من السحابة =====
export async function restoreFromCloud() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('factory_state')
      .select('state')
      .eq('user_id', user.id)
      .single();

    if (error || !data) return null;
    return data.state;
  } catch (e) {
    console.error('Restore error:', e);
    return null;
  }
}

// ===== 3. الدوال القديمة - عشان test-db.html يفضل شغال =====
export async function getAll(table) {
  const { data, error } = await supabase.from(table).select('*');
  if (error) throw error;
  return data;
}

export async function addOne(table, row) {
  const { data, error } = await supabase.from(table).insert(row).select().single();
  if (error) throw error;
  return data;
}

export async function getCustomers() {
  return getAll('customers');
}

export async function addCustomer(customer) {
  const { data: { user } } = await supabase.auth.getUser();
  return addOne('customers', { ...customer, user_id: user?.id });
}

export async function getProducts() {
  return getAll('products');
}

export async function addProduct(product) {
  const { data: { user } } = await supabase.auth.getUser();
  return addOne('products', { ...product, user_id: user?.id });
}

export async function getInvoices() {
  return getAll('invoices');
}

// ===== 4. عشان app.js العادي يقدر يناديها =====
window.MS_DB = { backupToCloud, restoreFromCloud };
