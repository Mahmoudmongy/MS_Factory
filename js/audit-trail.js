let supabaseClient = null;
async function getSupabase() {
  if (!supabaseClient) {
    const module = await import('./supabase.js');
    supabaseClient = module.supabase;
  }
  return supabaseClient;
}
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const english = () => {
  try { return document.documentElement.lang === 'en' || JSON.parse(localStorage.getItem('mgr6pref') || '{}').lang === 'en'; }
  catch { return document.documentElement.lang === 'en'; }
};
const text = (ar, en) => english() ? en : ar;
const labels = {INSERT:['إضافة','Add'],UPDATE:['تعديل','Update'],DELETE:['حذف','Delete']};
const typeLabels = {
 docs:['الفواتير','Invoices'],vch:['السندات','Vouchers'],po:['أوامر الإنتاج','Production orders'],je:['القيود اليومية','Journal entries'],
 wo:['الهالك','Waste'],partners:['العملاء والموردون','Customers & suppliers'],customers:['العملاء','Customers'],suppliers:['الموردون','Suppliers'],
 sret:['مرتجعات المبيعات','Sales returns'],pret:['مرتجعات المشتريات','Purchase returns'],items:['الأصناف','Items'],codes:['الباركود','Barcodes'],
 mv:['حركات المخزون','Stock movements'],wh:['المخازن','Warehouses'],accts:['الحسابات','Accounts'],L:['بيانات المصنع','Factory data'],
 payroll:['الأجور','Payroll'],profile:['الموظفون والصلاحيات','Employees & permissions']
};
const opLabel = op => labels[op] ? text(labels[op][0],labels[op][1]) : op;
const typeLabel = type => typeLabels[type] ? text(typeLabels[type][0],typeLabels[type][1]) : type;
let ownerId = null, rows = [], panel = null, launcher = null;
function ensureUi() {
  if (document.getElementById('factory-audit-open')) return;
  const tabs = document.getElementById('tabs');
  if (!tabs?.parentNode) return;
  launcher = document.createElement('div');
  launcher.id = 'factory-audit-launcher';
  launcher.style.cssText = 'display:flex;justify-content:flex-end;align-items:center;gap:7px;flex-wrap:wrap;padding:5px 12px;background:var(--bg,#f7f8fa)';
  const button = document.createElement('button');
  button.id = 'factory-audit-open'; button.type = 'button'; button.className = 'g';
  button.textContent = '⟲'; button.setAttribute('aria-label',text('سجل التدقيق والتراجع','Audit log & safe undo')); button.title=text('سجل التدقيق والتراجع','Audit log & safe undo');
  button.title = text('عرض سجل تغييرات قاعدة البيانات والتراجع الآمن','View database change history and safe undo');
  button.style.cssText = 'white-space:nowrap;min-height:30px;width:30px;min-width:30px;padding:2px;font-size:16px';
  button.addEventListener('click', openPanel);
  const managerButton = document.getElementById('manager-history-open');
  if (managerButton?.parentNode) {
    launcher = managerButton.parentNode;
    managerButton.insertAdjacentElement('afterend', button);
  } else {
    launcher.appendChild(button);
    tabs.parentNode.insertBefore(launcher, tabs);
  }
  panel = document.createElement('section');
  panel.id = 'factory-audit-panel'; panel.setAttribute('role','dialog'); panel.setAttribute('aria-modal','true');
  panel.setAttribute('aria-label',text('سجل التدقيق','Audit log'));
  panel.dir = english() ? 'ltr' : 'rtl';
  panel.style.cssText = 'display:none;position:fixed;inset:0;z-index:100510;overflow:auto;padding:clamp(8px,2vw,24px);background:var(--bg,#f7f8fa);color:var(--tx,#17212b)';
  panel.innerHTML = `<div style="max-width:1500px;margin:auto">
    <div class="card row" style="justify-content:space-between;align-items:center"><div><h2 id="factory-audit-title" style="margin:0">سجل التدقيق والتراجع الآمن</h2><small id="factory-audit-subtitle">يعرض التغييرات المؤكدة في قاعدة البيانات. التراجع العام متاح للسجلات غير المالية فقط؛ الحركات المالية والمخزنية تُعكس من شاشة الحركة حتى لا تختل الحسابات.</small></div><button type="button" class="rd" id="factory-audit-close">إغلاق ✕</button></div>
    <div class="card"><input id="factory-audit-search" type="search" placeholder="بحث بالمرجع أو نوع السجل أو العملية" style="max-width:460px;width:100%"><span id="factory-audit-status" style="margin-inline-start:10px"></span></div>
    <div id="factory-audit-content"></div>
  </div>`;
  document.body.appendChild(panel);
  panel.querySelector('#factory-audit-close').addEventListener('click', closePanel);
  panel.addEventListener('click', e => { if(e.target===panel) closePanel(); });
  panel.querySelector('#factory-audit-search').addEventListener('input', renderRows);
  panel.querySelector('#factory-audit-content').addEventListener('click', undoClick);
  applyLanguage();
  document.addEventListener('keydown', e => { if(e.key==='Escape'&&panel.style.display!=='none') closePanel(); });
}
async function verifyAdmin() {
  const supabase = await getSupabase();
  const {data:{user},error} = await supabase.auth.getUser();
  if(error||!user) throw new Error(text('جلسة الدخول غير صالحة. سجّل الدخول مرة أخرى.','Your session is invalid. Please sign in again.'));
  const {data,error:profileError} = await supabase.from('profiles').select('id,created_by,is_admin').eq('id',user.id).maybeSingle();
  if(profileError||!data) throw new Error(text('تعذر التحقق من صلاحية الحساب.','Could not verify account permissions.'));
  if(data.is_admin!==true || data.created_by) throw new Error(text('سجل التدقيق والتراجع متاح لصاحب المصنع فقط.','The audit log is available to the factory owner only.'));
  ownerId=data.id;
}
const status = (message,error=false) => {
  const node=panel?.querySelector('#factory-audit-status');
  if(node){node.textContent=message;node.style.color=error?'#b91c1c':'';}
};
async function loadRows() {
  status(text('جارٍ تحميل السجل...','Loading audit log...'));
  const supabase = await getSupabase();
  const {data,error}=await supabase.from('factory_audit_log').select('*').eq('factory_user_id',ownerId).order('occurred_at',{ascending:false}).order('id',{ascending:false}).limit(250);
  if(error) throw new Error(text('تعذر قراءة سجل التدقيق: ','Could not read audit log: ')+error.message);
  rows=data||[]; status(text('تم تحميل ','Loaded ')+rows.length.toLocaleString('en-US')+text(' حركة.',' entries.')); renderRows();
}
function renderRows() {
  const root=panel?.querySelector('#factory-audit-content'); if(!root)return;
  const q=(panel.querySelector('#factory-audit-search')?.value||'').trim().toLocaleLowerCase();
  const latest=new Map();
  for(const row of rows){const key=row.record_type+'|'+row.record_id;if(!latest.has(key)||Number(row.id)>Number(latest.get(key)))latest.set(key,row.id);}
  const visible=rows.filter(row=>!q||[row.record_type,row.record_id,row.operation,opLabel(row.operation)].join(' ').toLocaleLowerCase().includes(q));
  if(!visible.length){root.innerHTML='<div class="card">'+text('لا توجد حركات مطابقة.','No matching records.')+'</div>';return;}
  root.innerHTML=`<div class="card" style="overflow:auto"><table class="l" style="min-width:850px;width:100%"><thead><tr><th>${text('التاريخ','Date')}</th><th>${text('العملية','Action')}</th><th>${text('القسم','Section')}</th><th>${text('رقم السجل','Record ID')}</th><th>${text('المنفذ','Actor')}</th><th>${text('التفاصيل','Details')}</th><th>${text('الإجراء','Action')}</th></tr></thead><tbody>${visible.map(row=>{
    const key=row.record_type+'|'+row.record_id,undoSupported=['partners','items','codes','wh','accts','customers','suppliers'].includes(row.record_type),businessReversal=['docs','vch','po','je','wo','L','mv','sret','pret','payroll'].includes(row.record_type),canUndo=undoSupported&&latest.get(key)===row.id&&['INSERT','UPDATE'].includes(row.operation);
    const snapshot={before:row.old_row,after:row.new_row};
    return `<tr><td>${esc(new Date(row.occurred_at).toLocaleString('en-GB'))}</td><td>${esc(opLabel(row.operation))}</td><td>${esc(typeLabel(row.record_type))}</td><td>${esc(row.record_id)}</td><td>${esc(row.actor_id||'—')}</td><td><details><summary>${text('عرض قبل / بعد','View before / after')}</summary><pre style="white-space:pre-wrap;direction:ltr;text-align:left;max-width:520px;overflow:auto">${esc(JSON.stringify(snapshot,null,2))}</pre></details></td><td>${canUndo?`<button class="g" type="button" data-undo="${Number(row.id)}">${text('تراجع آمن','Safe undo')}</button>`:businessReversal?`<span title="${text('استخدم التراجع من شاشة الحركة','Use the reversal action on the movement screen')}" class="mu">${text('عكس من شاشة الحركة','Reverse from movement screen')}</span>`:'—'}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}
async function undoClick(event) {
  const button=event.target.closest('[data-undo]'); if(!button)return;
  const id=Number(button.dataset.undo); if(!Number.isSafeInteger(id)||id<=0)return;
  if(!confirm(text('سيتم إنشاء حركة عكسية لآخر تعديل على هذا السجل. لن يُحذف سجل التدقيق. هل تريد المتابعة؟','This will safely reverse the latest change to this record. The audit log will remain. Continue?')))return;
  button.disabled=true; status(text('جارٍ تنفيذ التراجع والتحقق من عدم وجود تعديل أحدث...','Applying undo and checking for newer changes...'));
  let supabase;
  try { supabase = await getSupabase(); }
  catch (error) { status(text('تعذر الاتصال بقاعدة البيانات: ','Could not connect to the database: ')+(error?.message||String(error)),true); button.disabled=false; return; }
  const {error}=await supabase.rpc('undo_factory_record_change',{p_audit_id:id});
  if(error){status(error.code==='40001'?text('لم يتم التراجع: توجد حركة أحدث أو تعارض. حدّث السجل وراجع آخر تغيير.','Undo was blocked: a newer change or conflict exists. Refresh and review the latest entry.'):text('تعذر التراجع: ','Undo failed: ')+error.message,true);button.disabled=false;return;}
  status(text('تم التراجع بحركة عكسية موثقة. جارٍ تحديث السجل.','Undo was recorded. Refreshing the audit log.'));
  try{await loadRows()}catch(e){status(e.message,true);}
}
async function openPanel() {
  ensureUi(); panel.style.display='block'; document.body.style.overflow='hidden';
  try{await verifyAdmin();await loadRows();}
  catch(error){status(error.message,true);panel.querySelector('#factory-audit-content').innerHTML='<div class="card">'+text('لا يمكن عرض سجل التدقيق لهذا الحساب.','This account cannot view the audit log.')+'</div>';}
}
function closePanel(){if(panel)panel.style.display='none';document.body.style.overflow='';}
function applyLanguage() {
  const button=document.getElementById('factory-audit-open');
  if(button){button.textContent=text('سجل التدقيق والتراجع','Audit log & safe undo');button.title=text('عرض سجل تغييرات قاعدة البيانات والتراجع الآمن','View database change history and safe undo');}
  if(!panel)return;
  panel.dir=english()?'ltr':'rtl';
  panel.setAttribute('aria-label',text('سجل التدقيق','Audit log'));
  const title=panel.querySelector('#factory-audit-title');if(title)title.textContent=text('سجل التدقيق والتراجع الآمن','Audit log & safe undo');
  const subtitle=panel.querySelector('#factory-audit-subtitle');if(subtitle)subtitle.textContent=text('يعرض التغييرات المؤكدة في قاعدة البيانات. التراجع العام متاح للسجلات غير المالية فقط؛ الحركات المالية والمخزنية تُعكس من شاشة الحركة حتى لا تختل الحسابات.','Shows confirmed database changes. Generic undo is limited to non-financial records; financial and stock movements must be reversed from their movement screen to preserve balances.');
  const close=panel.querySelector('#factory-audit-close');if(close)close.textContent=text('إغلاق ✕','Close ✕');
  const search=panel.querySelector('#factory-audit-search');if(search)search.placeholder=text('بحث بالمرجع أو نوع السجل أو العملية','Search by reference, record type or operation');
  status('');
  renderRows();
}
ensureUi();
let lastEnglish=english();
window.addEventListener('factory-language-changed',applyLanguage);
new MutationObserver(()=>{const next=english();if(next!==lastEnglish){lastEnglish=next;applyLanguage();}}).observe(document.documentElement,{attributes:true,attributeFilter:['lang','dir']});

/* Human-readable business context for audit entries; raw snapshots remain available. */
function auditBusinessSummary(row){
  const raw=row.new_row||row.old_row||{};
  const v=raw.payload&&typeof raw.payload==="object"?raw.payload:raw.data&&typeof raw.data==="object"?raw.data:raw;
  const parts=[];
  const money=value=>Number.isFinite(Number(value))?Number(value).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}):"";
  const accountName=id=>{try{return typeof window.an==="function"?window.an(id):"حساب #"+id}catch(_){return "حساب #"+id}};
  const partyName=()=>{try{return v.who|| (v.pid&&typeof window.pn==="function"?window.pn(v.pid):"")}catch(_){return v.who||""}};
  const add=(label,value)=>{if(value!==undefined&&value!==null&&String(value).trim()!=="")parts.push(label+": "+value)};
  add("المرجع",v.no||v.ref);
  add("التاريخ",v.date);
  const type=row.record_type;
  if(type==="vch"||type==="vouchers"){
    add("نوع السند",v.title||(v.dir==="in"?"سند قبض":"سند دفع"));
    add(v.dir==="out"?"المستفيد":"الدافع",partyName());
    const ac=Array.isArray(v.ac)?v.ac:[];
    if(ac.length)add("الحسابات",ac.map(x=>accountName(x.a)+" ("+money(x.m)+" "+(x.cur||"ج.م")+")").join("، "));
    add("المبلغ",money(v.total)+" ج.م");
    add("البيان",v.desc);
  }else if(type==="docs"||type==="invoices"||type==="sret"||type==="pret"){
    add("نوع المستند",v.t||v.type);
    add("العميل / المورد",partyName());
    if(Array.isArray(v.lines))add("الأصناف",v.lines.slice(0,8).map(x=>(x.name||"صنف")+" × "+(x.qty||0)).join("، "));
    add("الإجمالي",money(v.total)+" ج.م");
    add("البيان",v.note||v.desc);
  }else if(type==="partners"||type==="customers"||type==="suppliers"){
    add("الاسم",v.name||v.full_name);
    add("الهاتف",v.phone||v.mobile);
    add("الصفة",v.c&&v.s?"عميل ومورد":v.c?"عميل":v.s?"مورد":"");
  }else if(type==="accts"){
    add("كود الحساب",v.code);add("اسم الحساب",v.name);add("العملة",v.cur||v.currency);
  }else if(type==="wh"){
    add("اسم المخزن",v.name);add("المخزن الرئيسي",v.parent_name||v.parentId);
  }else{
    add("البيان",v.desc||v.description||v.note||v.name||v.title);
    if(v.total!==undefined)add("المبلغ",money(v.total)+" ج.م");
    if(v.amount!==undefined)add("القيمة",money(v.amount));
    if(v.who)add("الطرف",v.who);
  }
  return parts.length?parts.join(" — "):"تفاصيل السجل متاحة في البيانات قبل / بعد";
}
renderRows = function(){
  const root=panel?.querySelector("#factory-audit-content");if(!root)return;
  const q=(panel.querySelector("#factory-audit-search")?.value||"").trim().toLocaleLowerCase();
  const latest=new Map();
  for(const row of rows){const key=row.record_type+"|"+row.record_id;if(!latest.has(key)||Number(row.id)>Number(latest.get(key)))latest.set(key,row.id);}
  const visible=rows.filter(row=>!q||[row.record_type,row.record_id,row.operation,opLabel(row.operation),auditBusinessSummary(row)].join(" ").toLocaleLowerCase().includes(q));
  if(!visible.length){root.innerHTML='<div class="card">'+text("لا توجد حركات مطابقة.","No matching records.")+'</div>';return;}
  root.innerHTML='<div class="card" style="overflow:auto"><table class="l" style="min-width:950px;width:100%"><thead><tr><th>'+text("التاريخ","Date")+'</th><th>'+text("العملية","Action")+'</th><th>'+text("القسم","Section")+'</th><th>'+text("رقم السجل","Record ID")+'</th><th>'+text("المنفذ","Actor")+'</th><th>'+text("تفاصيل الحركة","Movement details")+'</th><th>'+text("الإجراء","Action")+'</th></tr></thead><tbody>'+
  visible.map(row=>{
    const key=row.record_type+"|"+row.record_id,undoSupported=["partners","items","codes","wh","accts","customers","suppliers"].includes(row.record_type),businessReversal=["docs","vch","po","je","wo","L","mv","sret","pret","payroll"].includes(row.record_type),canUndo=undoSupported&&latest.get(key)===row.id&&["INSERT","UPDATE"].includes(row.operation);
    const snapshot={before:row.old_row,after:row.new_row};
    return '<tr><td>'+esc(new Date(row.occurred_at).toLocaleString("en-GB"))+'</td><td>'+esc(opLabel(row.operation))+'</td><td>'+esc(typeLabel(row.record_type))+'</td><td>'+esc(row.record_id)+'</td><td>'+esc(row.actor_id||"—")+'</td><td><b>'+esc(auditBusinessSummary(row))+'</b><details><summary>'+text("تفاصيل البيانات قبل / بعد","Raw before / after data")+'</summary><pre style="white-space:pre-wrap;direction:ltr;text-align:left;max-width:520px;overflow:auto">'+esc(JSON.stringify(snapshot,null,2))+'</pre></details></td><td>'+(canUndo?'<button class="g" type="button" data-undo="'+Number(row.id)+'">'+text("تراجع آمن","Safe undo")+'</button>':businessReversal?'<span class="mu">'+text("عكس من شاشة الحركة","Reverse from movement screen")+'</span>':"—")+'</td></tr>';
  }).join("")+'</tbody></table></div>';
};
