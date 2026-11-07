import { supabase } from './supabase.js';

// ===== دوال عامة لكل الجداول =====
export async function getAll(table) {
  const { data, error } = await supabase.from(table).select('*').order('created_at', { ascending: false });
  if (error) { console.log('Error get', table, error); return []; }
  return data || [];
}

export async function addOne(table, obj) {
  const { data, error } = await supabase.from(table).insert([obj]).select().single();
  if (error) { console.log('Error add', table, error); return null; }
  return data;
}

export async function updateOne(table, id, obj) {
  const { data, error } = await supabase.from(table).update(obj).eq('id', id).select().single();
  if (error) { console.log('Error update', table, error); return null; }
  return data;
}

export async function deleteOne(table, id) {
  const { error } = await supabase.from(table).delete().eq('id', id);
  return !error;
}

// ===== دوال مخصصة للعملاء =====
export async function getCustomers() { return getAll('customers'); }
export async function addCustomer(name, phone, type='retail') {
  return addOne('customers', { name, phone, customer_type: type });
}

// ===== دوال مخصصة للمنتجات =====
export async function getProducts() { return getAll('products'); }
export async function addProduct(name, retail_price=0, buy_price=0) {
  return addOne('products', { name, retail_price, buy_price });
}

// ===== دوال مخصصة للفواتير =====
export async function getInvoices() { return getAll('invoices'); }
export async function addInvoice(invoice_no, invoice_type='sale', total=0, customer_id=null) {
  return addOne('invoices', { invoice_no, invoice_type, total, customer_id });
}
// js/db.js - طبقة المزامنة
import { supabase } from './supabase.js';

// 1. حفظ نسخة كاملة كـ backup
export async function backupToCloud(S) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { error } = await supabase
    .from('factory_state')
    .upsert({
      user_id: user.id,
      state: S,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });

  if (error) { console.error('Backup failed:', error); return false; }
  return true;
}

// 2. استعادة النسخة
export async function restoreFromCloud() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('factory_state')
    .select('state')
    .eq('user_id', user.id)
    .single();

  if (error || !data) return null;
  return data.state;
}

// 3. تعديل sv() في app.js - هنضيف سطر واحد بس
// في app.js، بعد السطر:
// const sv=()=>{try{S.pend=(S.pend||0)+1;localStorage.setItem("mgr6",JSON.stringify(S))}catch(e){}};
// هنخليه:
// const sv=async()=>{try{S.pend=(S.pend||0)+1;localStorage.setItem("mgr6",JSON.stringify(S))}catch(e){}; if(navigator.onLine) backupToCloud(S).catch(()=>{}) };
