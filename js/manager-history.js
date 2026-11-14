import { supabase } from './supabase.js';

const $ = (s, root=document) => root.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const money = value => Number(value || 0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const qty = value => Number(value || 0).toLocaleString('en-US',{maximumFractionDigits:3});
const date = value => value ? String(value).slice(0,10) : '—';
const shortId = value => String(value || '').slice(0,8);
const PAGE = 1000;
let ownerId = null;
let activeTab = 'overview';
let loaded = new Map();
let searchText = '';

const TABS = [
  ['overview','نظرة عامة'],
  ['partners','العملاء والموردون'],
  ['inventory','المخزون والمخازن'],
  ['documents','الفواتير والمرتجعات'],
  ['vouchers','القبض والصرف'],
  ['production','أوامر الإنتاج'],
  ['accounting','الحسابات والقيود']
];
const CONFIG = {
  partners: [
    ['customers','العملاء','name'],['suppliers','الموردون','name']
  ],
  inventory: [
    ['products','الأصناف','name'],['inventory_location_balances','أرصدة المواقع','warehouse'],['manager_inventory_cost_history','تاريخ التكلفة','effective_date']
  ],
  documents: [
    ['invoices','الفواتير','invoice_date'],['invoice_items','بنود الفواتير','id'],['returns','المرتجعات','return_date'],['return_items','بنود المرتجعات','id'],['manager_invoice_source_lines','تفاصيل مصدر الفواتير','issue_date'],['invoice_line_adjustments','بنود الشراء الإضافية','created_at']
  ],
  vouchers: [
    ['vouchers','السندات','voucher_date'],['manager_voucher_lines','تفاصيل السندات','transaction_date']
  ],
  production: [
    ['production_orders','أوامر الإنتاج','order_date']
  ],
  accounting: [
    ['manager_accounts','دليل الحسابات','account_code'],['manager_ledger_transactions','دفتر الأستاذ','transaction_date'],['manager_journal_entries','القيود اليومية','entry_date'],['manager_inter_account_transfers','التحويلات بين الحسابات','transfer_date'],['manager_inventory_write_offs','تسويات المخزون','writeoff_date']
  ]
};
const ORDER = {
  customers:'name',suppliers:'name',products:'name',inventory_location_balances:'warehouse',
  manager_inventory_cost_history:'effective_date',invoices:'invoice_date',invoice_items:'id',
  returns:'return_date',return_items:'id',manager_invoice_source_lines:'issue_date',
  invoice_line_adjustments:'created_at',vouchers:'voucher_date',manager_voucher_lines:'transaction_date',
  production_orders:'order_date',manager_accounts:'account_code',
  manager_ledger_transactions:'transaction_date',manager_journal_entries:'entry_date',
  manager_inter_account_transfers:'transfer_date',manager_inventory_write_offs:'writeoff_date'
};
async function readTable(table) {
  const all = [];
  for (let from=0; ; from+=PAGE) {
    let query = supabase.from(table).select('*').eq('user_id',ownerId);
    const order = ORDER[table];
    if (order) query = query.order(order,{ascending: table==='customers'||table==='suppliers'||table==='products'||table==='manager_accounts'});
    const {data,error} = await query.range(from,from+PAGE-1);
    if (error) throw new Error('تعذر قراءة '+table+': '+error.message);
    all.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return all;
}
async function readMany(tables) {
  const result = await Promise.all(tables.map(async table => [table,await readTable(table)]));
  result.forEach(([table,rows])=>loaded.set(table,rows));
}
async function getOwner() {
  const {data:{user},error} = await supabase.auth.getUser();
  if(error || !user) throw new Error('جلسة الدخول غير صالحة. سجّل الدخول مرة أخرى.');
  const {data:profile,error:profileError} = await supabase.from('profiles')
    .select('id,created_by,is_admin,permissions').eq('id',user.id).maybeSingle();
  if(profileError || !profile) throw new Error('تعذر تحديد حساب المصنع صاحب البيانات.');
  ownerId = profile.created_by || profile.id;
}
function ensureUi() {
  if ($('#manager-history-open')) return;
  const top = $('#top');
  const tabsBar = $('#tabs');
  if (!top || !tabsBar) return;
  const launcher = document.createElement('div');
  launcher.id = 'manager-history-launcher';
  launcher.style.cssText = 'display:flex;justify-content:flex-end;align-items:center;padding:5px 12px;background:var(--bg,#f7f8fa);';
  const button = document.createElement('button');
  button.id='manager-history-open';
  button.type='button';
  button.className='g';
  button.textContent='سجل Manager.io';
  button.title='عرض البيانات التاريخية المنقولة من Manager.io';
  button.style.cssText='white-space:nowrap;font-weight:700;min-height:34px';
  button.addEventListener('click',openPanel);
  launcher.appendChild(button);
  tabsBar.parentNode.insertBefore(launcher,tabsBar);

  const style=document.createElement('style');
  style.textContent=`
  #manager-history-panel{position:fixed;inset:0;z-index:100500;background:var(--bg,#f7f8fa);color:var(--tx,#17212b);display:none;overflow:auto;padding:clamp(10px,2vw,24px)}
  #manager-history-panel.open{display:block}
  #manager-history-panel .mh-shell{max-width:1500px;margin:auto}
  #manager-history-panel .mh-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;background:var(--card,#fff);border:1px solid var(--bd,#ddd);border-radius:12px;padding:14px;margin-bottom:12px}
  #manager-history-panel .mh-tabs{display:flex;gap:7px;flex-wrap:wrap;margin:12px 0}
  #manager-history-panel .mh-tabs button{border:1px solid var(--bd,#ddd);border-radius:8px;padding:9px 13px;background:var(--card,#fff);color:inherit;cursor:pointer}
  #manager-history-panel .mh-tabs button.active{background:#0f766e;color:#fff;border-color:#0f766e}
  #manager-history-panel .mh-card{background:var(--card,#fff);border:1px solid var(--bd,#ddd);border-radius:12px;padding:14px;margin:10px 0;overflow:auto}
  #manager-history-panel .mh-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
  #manager-history-panel .mh-stat{background:var(--card,#fff);border:1px solid var(--bd,#ddd);border-radius:10px;padding:14px}
  #manager-history-panel .mh-stat b{display:block;font-size:23px;margin-top:6px;direction:ltr;text-align:right}
  #manager-history-panel .mh-muted{opacity:.72;font-size:13px}
  #manager-history-panel .mh-search{width:min(100%,420px);padding:10px;border:1px solid var(--border,#ccc);border-radius:8px;background:var(--card,#fff);color:inherit}
  #manager-history-panel table{width:100%;border-collapse:collapse;min-width:650px}
  #manager-history-panel th,#manager-history-panel td{padding:9px 10px;border-bottom:1px solid var(--bd,#ddd);text-align:right;vertical-align:top}
  #manager-history-panel th{position:sticky;top:0;background:var(--card,#fff)}
  #manager-history-panel details summary{cursor:pointer;color:#0f766e;font-weight:700}
  #manager-history-panel pre{white-space:pre-wrap;word-break:break-word;max-height:360px;overflow:auto;direction:ltr;text-align:left;background:rgba(127,127,127,.08);padding:10px;border-radius:8px}
  #manager-history-panel .mh-tag{display:inline-block;border-radius:6px;padding:3px 7px;background:rgba(15,118,110,.12);font-size:12px}
  #manager-history-panel .mh-negative{color:#b91c1c;font-weight:700}
  #manager-history-panel .mh-close{border:0;border-radius:8px;padding:9px 14px;background:#991b1b;color:#fff;cursor:pointer}
  @media(max-width:640px){#manager-history-panel{padding:8px}#manager-history-panel .mh-head{align-items:flex-start}#manager-history-panel .mh-stat b{font-size:19px}}
  `;
  document.head.appendChild(style);
  const panel=document.createElement('section');
  panel.id='manager-history-panel';
  panel.setAttribute('role','dialog');
  panel.setAttribute('aria-modal','true');
  panel.setAttribute('aria-label','سجل البيانات التاريخية من Manager.io');
  panel.innerHTML=`<div class="mh-shell">
    <div class="mh-head"><div><h2 style="margin:0">سجل البيانات المنقولة من Manager.io</h2><div class="mh-muted">عرض مباشر من قاعدة بيانات الإنتاج — بيانات تاريخية للقراءة فقط</div></div><button class="mh-close" type="button" id="manager-history-close">إغلاق ✕</button></div>
    <div class="mh-tabs" id="manager-history-tabs"></div>
    <div id="manager-history-status" class="mh-card mh-muted">جاهز للقراءة.</div>
    <div id="manager-history-content"></div>
  </div>`;
  document.body.appendChild(panel);
  $('#manager-history-close',panel).addEventListener('click',closePanel);
  panel.addEventListener('click',e=>{if(e.target===panel)closePanel()});
  $('#manager-history-tabs',panel).addEventListener('click',e=>{
    const b=e.target.closest('[data-tab]');if(!b)return;
    activeTab=b.dataset.tab;searchText='';renderTabs();loadTab(activeTab);
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&panel.classList.contains('open'))closePanel()});
  renderTabs();
}
function renderTabs() {
  const root=$('#manager-history-tabs');if(!root)return;
  root.innerHTML=TABS.map(([id,label])=>`<button type="button" data-tab="${id}" class="${activeTab===id?'active':''}">${label}</button>`).join('');
}
function setStatus(message,error=false) {
  const el=$('#manager-history-status');if(!el)return;
  el.textContent=message;el.style.color=error?'#b91c1c':'';
}
async function openPanel() {
  ensureUi();
  const panel=$('#manager-history-panel');panel.classList.add('open');
  document.body.style.overflow='hidden';
  if(!ownerId){setStatus('جارٍ التحقق من جلسة الحساب...');try{await getOwner()}catch(e){setStatus(e.message,true);return}}
  await loadTab(activeTab);
}
function closePanel(){const p=$('#manager-history-panel');if(p)p.classList.remove('open');document.body.style.overflow=''}
function stat(label,value){return `<div class="mh-stat"><span class="mh-muted">${esc(label)}</span><b>${esc(value)}</b></div>`}
function card(title,body){return `<section class="mh-card"><h3 style="margin:0 0 12px">${esc(title)}</h3>${body}</section>`}
function table(headers,rows) {
  if(!rows.length)return '<div class="mh-muted">لا توجد سجلات في هذا القسم.</div>';
  return `<div style="overflow:auto"><table><thead><tr>${headers.map(h=>'<th>'+esc(h)+'</th>').join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}
function detail(value){return `<details><summary>عرض التفاصيل الأصلية</summary><pre>${esc(JSON.stringify(value,null,2))}</pre></details>`}
function filtered(rows,fn) {
  const q=searchText.trim().toLocaleLowerCase();
  return !q?rows:rows.filter(row=>fn(row).toLocaleLowerCase().includes(q));
}
function searchBox(){return `<input class="mh-search" id="manager-history-search" type="search" placeholder="بحث داخل البيانات المعروضة..." value="${esc(searchText)}">`;}
function bindSearch(){const input=$('#manager-history-search');if(input)input.addEventListener('input',()=>{searchText=input.value;renderCurrent()})}
function renderCurrent(){renderTabContent(activeTab);bindSearch()}
async function loadTab(tab) {
  if(tab==='overview'){await renderOverview();return}
  const tables=(CONFIG[tab]||[]).map(x=>x[0]);
  const missing=tables.filter(t=>!loaded.has(t));
  setStatus(missing.length?'جارٍ تحميل البيانات المطلوبة من Supabase...':'تم تحميل البيانات. جميع السجلات المعروضة للقراءة فقط.');
  try{
    if(missing.length)await readMany(missing);
    setStatus('تم الاتصال بقاعدة بيانات الإنتاج وقراءة '+tables.reduce((n,t)=>n+(loaded.get(t)?.length||0),0).toLocaleString('en-US')+' سجل في هذا القسم. لا يتم تعديل أي بيانات من هذه الشاشة.');
    renderCurrent();
  }catch(e){setStatus(e.message||String(e),true);$('#manager-history-content').innerHTML='<div class="mh-card">تعذر تحميل هذا القسم. أعد فتحه بعد التأكد من اتصال الإنترنت وصلاحية الحساب.</div>'}
}
async function renderOverview(){
  setStatus('جارٍ جلب أعداد السجلات من قاعدة البيانات...');
  const tables=['customers','suppliers','products','invoices','returns','vouchers','production_orders','manager_accounts','manager_ledger_transactions'];
  try{
    const counts=await Promise.all(tables.map(async t=>{
      const {count,error}=await supabase.from(t).select('id',{count:'exact',head:true}).eq('user_id',ownerId);
      if(error)throw new Error('تعذر عد '+t+': '+error.message);
      return [t,count||0];
    }));
    const labels={customers:'العملاء',suppliers:'الموردون',products:'الأصناف',invoices:'الفواتير',returns:'المرتجعات',vouchers:'السندات',production_orders:'أوامر الإنتاج',manager_accounts:'الحسابات',manager_ledger_transactions:'حركات دفتر الأستاذ'};
    $('#manager-history-content').innerHTML=`<div class="mh-card"><span class="mh-tag">مصدر البيانات: Supabase Production</span> <span class="mh-tag">حالة العرض: قراءة فقط</span><p class="mh-muted">هذه الأرقام تُقرأ مباشرة من الجداول المنظمة التي تم استيرادها. لا يتم نسخها إلى التخزين المحلي ولا الكتابة فوق سجلات البرنامج الحالية.</p></div><div class="mh-grid">${counts.map(([t,n])=>stat(labels[t],n.toLocaleString('en-US'))).join('')}</div>${card('ملاحظات سلامة البيانات','<p>• سجلات Manager.io التاريخية محفوظة في جداول مستقلة ومحمية بسياسات RLS.</p><p>• أرصدة المخازن معروضة لكل موقع منفصلًا، بما في ذلك الأرصدة السالبة الموجودة في المصدر.</p><p>• لا توجد أزرار تعديل أو حذف في سجل البيانات التاريخية.</p><p>• تظل شاشة البرنامج التشغيلية الحالية مستقلة عن سجل Manager.io إلى أن تتم مراجعة تحويلاتها واعتماد الربط النهائي.</p>')}`;
    setStatus('نجح الاتصال. أعداد السجلات محدثة مباشرة من قاعدة البيانات.');
  }catch(e){setStatus(e.message||String(e),true)}
}
function renderTabContent(tab){
  const root=$('#manager-history-content');if(!root)return;
  const get=t=>loaded.get(t)||[];
  if(tab==='partners'){
    const customers=filtered(get('customers'),r=>[r.name,r.phone,r.city,r.governorate,r.external_id].join(' '));
    const suppliers=filtered(get('suppliers'),r=>[r.name,r.phone,r.address,r.external_id].join(' '));
    const rows=(list,type)=>list.slice(0,500).map(r=>`<tr><td>${esc(r.name)}</td><td>${esc(r.phone||'—')}</td><td>${esc(r.governorate||r.city||'—')}</td><td>${esc(r.address||'—')}</td><td>${money(r.manager_reported_balance)} ${esc(r.manager_balance_currency||'EGP')}</td><td>${esc(r.manager_balance_status||'—')}</td><td>${detail(r)}</td></tr>`);
    root.innerHTML=card('العملاء والموردون',searchBox())+card('العملاء ('+customers.length+')',table(['الاسم','الهاتف','المحافظة / المدينة','العنوان','رصيد المصدر','حالة الرصيد','البيانات'],rows(customers,'customer')))+card('الموردون ('+suppliers.length+')',table(['الاسم','الهاتف','المحافظة / المدينة','العنوان','رصيد المصدر','حالة الرصيد','البيانات'],rows(suppliers,'supplier')));
  } else if(tab==='inventory'){
    const products=filtered(get('products'),r=>[r.name,r.sku,r.model,r.external_id].join(' '));
    const balances=get('inventory_location_balances');
    const costs=get('manager_inventory_cost_history');
    const locations=[...new Set(balances.map(x=>x.warehouse||x.manager_location_id||'غير محدد'))];
    const rows=products.slice(0,600).map(p=>{
      const b=balances.filter(x=>x.product_id===p.id);
      const total=b.reduce((n,x)=>n+Number(x.quantity||0),0);
      const loc=b.map(x=>`<span class="${Number(x.quantity)<0?'mh-negative':''}">${esc(x.warehouse||x.manager_location_id)}: ${qty(x.quantity)}</span>`).join('<br>')||'—';
      const latest=costs.filter(x=>x.product_id===p.id).sort((a,b)=>String(b.effective_date).localeCompare(String(a.effective_date)))[0];
      return `<tr><td>${esc(p.sku||'—')}</td><td>${esc(p.name)}</td><td>${esc(p.unit||'قطعة')}</td><td>${qty(total)}</td><td>${loc}</td><td>${money(latest?.unit_cost??p.buy_price)}</td><td>${money(total*Number(latest?.unit_cost??p.buy_price??0))}</td><td>${detail(p.raw||p)}</td></tr>`;
    });
    const neg=balances.filter(x=>Number(x.quantity)<0);
    root.innerHTML=card('المخزون حسب المخزن',`<div class="mh-muted">عدد الأصناف: ${products.length} — مواقع التخزين: ${locations.length} — أرصدة المواقع السالبة: <b class="mh-negative">${neg.length}</b></div>`+searchBox()+table(['الكود','الصنف','الوحدة','إجمالي الكمية','تفصيل كل مخزن','آخر تكلفة وحدة','قيمة تقديرية','المصدر'],rows))+card('تفاصيل مواقع التخزين',table(['المخزن','الصنف','الكمية','مرجع المصدر'],filtered(balances,r=>[r.warehouse,r.manager_location_id,get('products').find(p=>p.id===r.product_id)?.name].join(' ')).slice(0,500).map(r=>`<tr><td>${esc(r.warehouse||'—')}</td><td>${esc(get('products').find(p=>p.id===r.product_id)?.name||shortId(r.product_id))}</td><td class="${Number(r.quantity)<0?'mh-negative':''}">${qty(r.quantity)}</td><td>${esc(r.source_record_key||'—')}</td></tr>`)));
  } else if(tab==='documents'){
    const invoices=filtered(get('invoices'),r=>[r.invoice_no,r.customer_name,r.note,r.invoice_type,r.external_id].join(' '));
    const items=get('invoice_items'),returns=filtered(get('returns'),r=>[r.return_no,r.note,r.return_type].join(' '));
    const sourceLines=get('manager_invoice_source_lines'),adjustments=get('invoice_line_adjustments');
    root.innerHTML=card('الفواتير ('+invoices.length+')',searchBox()+table(['التاريخ','النوع','رقم الفاتورة','العميل / المورد','الإجمالي','البنود','تفاصيل'],invoices.slice(0,600).map(r=>{
      const lines=items.filter(x=>x.invoice_id===r.id);
      const extras=adjustments.filter(x=>x.invoice_id===r.id);
      return `<tr><td>${date(r.invoice_date)}</td><td>${r.invoice_type==='sale'?'بيع':'شراء'}</td><td>${esc(r.invoice_no)}</td><td>${esc(r.customer_name||'—')}</td><td>${money(r.total)}</td><td>${lines.length} بند / ${extras.length} إضافي</td><td>${detail({invoice:r,lines,extra_lines:extras,source_lines:sourceLines.filter(x=>x.invoice_id===r.id)})}</td></tr>`;
    })))+card('المرتجعات ('+returns.length+')',table(['التاريخ','النوع','الرقم','الإجمالي','البيان','تفاصيل'],returns.slice(0,400).map(r=>`<tr><td>${date(r.return_date)}</td><td>${r.return_type==='sale_return'?'مرتجع بيع':'مرتجع شراء'}</td><td>${esc(r.return_no)}</td><td>${money(r.total)}</td><td>${esc(r.note||'')}</td><td>${detail({return:r,lines:get('return_items').filter(x=>x.return_id===r.id)})}</td></tr>`)))+card('مراجعة البنود الإضافية في فواتير الشراء',`<p>عدد البنود المستقلة: <b>${adjustments.length}</b> — إجمالي قيمتها: <b>${money(adjustments.reduce((n,x)=>n+Number(x.amount||0),0))} ج.م</b>.</p><p class="mh-muted">تم الاحتفاظ بها منفصلة عن بنود الفاتورة الأساسية؛ لا يتم دمجها تلقائيًا في كميات المخزون.</p>`);
  } else if(tab==='vouchers'){
    const vouchers=filtered(get('vouchers'),r=>[r.voucher_no,r.direction,r.account,r.note,r.external_id].join(' '));
    const lines=get('manager_voucher_lines');
    root.innerHTML=card('سندات القبض والصرف ('+vouchers.length+')',searchBox()+table(['التاريخ','النوع','رقم السند','الطرف','المبلغ','الحساب','التفاصيل'],vouchers.slice(0,600).map(r=>{
      const detailLines=lines.filter(x=>x.voucher_id===r.id);
      return `<tr><td>${date(r.voucher_date)}</td><td>${r.direction==='in'?'قبض':'صرف'}</td><td>${esc(r.voucher_no)}</td><td>${esc(r.customer_id||r.supplier_id||'—')}</td><td>${money(r.amount)}</td><td>${esc(r.account||'—')}</td><td>${detail({voucher:r,lines:detailLines})}</td></tr>`;
    })));
  } else if(tab==='production'){
    const rows=filtered(get('production_orders'),r=>[r.order_no,r.item_name,r.description,r.status].join(' '));
    root.innerHTML=card('أوامر الإنتاج ('+rows.length+')',searchBox()+table(['التاريخ','رقم الأمر','الصنف','الوصف','الحالة','التكلفة','التفاصيل'],rows.slice(0,500).map(r=>`<tr><td>${date(r.order_date)}</td><td>${esc(r.order_no)}</td><td>${esc(r.item_name||'—')}</td><td>${esc(r.description||'')}</td><td>${esc(r.status||'—')}</td><td>${money(r.total_cost)}</td><td>${detail({order:r,breakdown:r.breakdown,source:r.raw})}</td></tr>`)));
  } else if(tab==='accounting'){
    const accounts=get('manager_accounts'),ledger=get('manager_ledger_transactions');
    const balances=new Map();
    for(const row of ledger){const k=row.account_id;const v=balances.get(k)||{debit:0,credit:0};v.debit+=Number(row.debit||0);v.credit+=Number(row.credit||0);balances.set(k,v)}
    const accountRows=filtered(accounts,a=>[a.account_code,a.name,a.account_type,a.currency_code].join(' '));
    const ledgerRows=filtered(ledger,l=>[l.transaction_date,l.reference,l.description,l.line_description,l.transaction_type].join(' '));
    root.innerHTML=card('دليل الحسابات ('+accounts.length+')',searchBox()+table(['الكود','الحساب','التصنيف','العملة','مدين','دائن','صافي الحركة','الرصيد المعلن','تفاصيل'],accountRows.slice(0,500).map(a=>{
      const b=balances.get(a.id)||{debit:0,credit:0};
      return `<tr><td>${esc(a.account_code||'—')}</td><td>${esc(a.name)}</td><td>${esc(a.account_type||'—')}</td><td>${esc(a.currency_code||'EGP')}</td><td>${money(b.debit)}</td><td>${money(b.credit)}</td><td>${money(b.debit-b.credit)}</td><td>${a.source_reported_balance==null?'—':money(a.source_reported_balance)}</td><td>${detail(a.raw||a)}</td></tr>`;
    })))+card('دفتر الأستاذ ('+ledgerRows.length+' حركة)',table(['التاريخ','النوع','المرجع','الحساب','البيان','مدين','دائن','تفاصيل'],ledgerRows.slice(0,250).map(l=>{
      const a=accounts.find(x=>x.id===l.account_id);
      return `<tr><td>${date(l.transaction_date)}</td><td>${esc(l.transaction_type||'')}</td><td>${esc(l.reference||'')}</td><td>${esc(a?.name||shortId(l.account_id))}</td><td>${esc(l.line_description||l.description||'')}</td><td>${money(l.debit)}</td><td>${money(l.credit)}</td><td>${detail(l.raw||l)}</td></tr>`;
    }))+'<p class="mh-muted">يعرض الجدول أول 250 حركة لتجنب تحميل واجهة المتصفح بعدد كبير من الصفوف؛ إجمالي الحركات المحملة: '+ledger.length.toLocaleString('en-US')+'.');
  }
}
window.addEventListener('factory-database-ready',()=>{
  if(window.__factoryAuthReady!==true||!window.__factoryAuthProfile||window.__factoryOfflineMode===true)return;
  ensureUi();
});
if(window.__factoryDatabaseFirstReady&&window.__factoryAuthReady===true&&window.__factoryOfflineMode!==true)ensureUi();
