let supabaseClient = null;
async function getSupabase() {
  if (!supabaseClient) {
    const module = await import('./supabase.js');
    supabaseClient = module.supabase;
  }
  return supabaseClient;
}
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const labels = {INSERT:'إضافة',UPDATE:'تعديل',DELETE:'حذف'};
const typeLabels = {docs:'الفواتير',vch:'السندات',po:'أوامر الإنتاج',je:'القيود اليومية',wo:'الهالك',partners:'العملاء والموردون',customers:'العملاء',suppliers:'الموردون',sret:'مرتجعات المبيعات',pret:'مرتجعات المشتريات',items:'الأصناف',codes:'الباركود',mv:'حركات المخزون',wh:'المخازن',accts:'الحسابات',L:'بيانات المصنع',payroll:'الأجور',profile:'الموظفون والصلاحيات'};
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
  button.textContent = 'سجل التدقيق والتراجع';
  button.title = 'عرض سجل تغييرات قاعدة البيانات والتراجع الآمن';
  button.style.cssText = 'white-space:normal;min-height:34px';
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
  panel.setAttribute('aria-label','سجل التدقيق');
  panel.style.cssText = 'display:none;position:fixed;inset:0;z-index:100510;overflow:auto;padding:clamp(8px,2vw,24px);background:var(--bg,#f7f8fa);color:var(--tx,#17212b)';
  panel.innerHTML = `<div style="max-width:1500px;margin:auto">
    <div class="card row" style="justify-content:space-between;align-items:center"><div><h2 style="margin:0">سجل التدقيق والتراجع الآمن</h2><small>يعرض التغييرات المؤكدة في قاعدة البيانات. التراجع العام متاح للسجلات غير المالية فقط؛ الحركات المالية والمخزنية تُعكس من شاشة الحركة حتى لا تختل الحسابات.</small></div><button type="button" class="rd" id="factory-audit-close">إغلاق ✕</button></div>
    <div class="card"><input id="factory-audit-search" type="search" placeholder="بحث بالمرجع أو نوع السجل أو العملية" style="max-width:460px;width:100%"><span id="factory-audit-status" style="margin-inline-start:10px"></span></div>
    <div id="factory-audit-content"></div>
  </div>`;
  document.body.appendChild(panel);
  panel.querySelector('#factory-audit-close').addEventListener('click', closePanel);
  panel.addEventListener('click', e => { if(e.target===panel) closePanel(); });
  panel.querySelector('#factory-audit-search').addEventListener('input', renderRows);
  panel.querySelector('#factory-audit-content').addEventListener('click', undoClick);
  document.addEventListener('keydown', e => { if(e.key==='Escape'&&panel.style.display!=='none') closePanel(); });
}
async function verifyAdmin() {
  const supabase = await getSupabase();
  const {data:{user},error} = await supabase.auth.getUser();
  if(error||!user) throw new Error('جلسة الدخول غير صالحة. سجّل الدخول مرة أخرى.');
  const {data,error:profileError} = await supabase.from('profiles').select('id,created_by,is_admin').eq('id',user.id).maybeSingle();
  if(profileError||!data) throw new Error('تعذر التحقق من صلاحية الحساب.');
  if(data.is_admin!==true || data.created_by) throw new Error('سجل التدقيق والتراجع متاح لصاحب المصنع فقط.');
  ownerId=data.id;
}
const status = (message,error=false) => {
  const node=panel?.querySelector('#factory-audit-status');
  if(node){node.textContent=message;node.style.color=error?'#b91c1c':'';}
};
async function loadRows() {
  status('جارٍ تحميل السجل...');
  const supabase = await getSupabase();
  const {data,error}=await supabase.from('factory_audit_log').select('*').eq('factory_user_id',ownerId).order('occurred_at',{ascending:false}).order('id',{ascending:false}).limit(250);
  if(error) throw new Error('تعذر قراءة سجل التدقيق: '+error.message);
  rows=data||[]; status('تم تحميل '+rows.length.toLocaleString('en-US')+' حركة.'); renderRows();
}
function renderRows() {
  const root=panel?.querySelector('#factory-audit-content'); if(!root)return;
  const q=(panel.querySelector('#factory-audit-search')?.value||'').trim().toLocaleLowerCase();
  const latest=new Map();
  for(const row of rows){const key=row.record_type+'|'+row.record_id;if(!latest.has(key)||Number(row.id)>Number(latest.get(key)))latest.set(key,row.id);}
  const visible=rows.filter(row=>!q||[row.record_type,row.record_id,row.operation,labels[row.operation]].join(' ').toLocaleLowerCase().includes(q));
  if(!visible.length){root.innerHTML='<div class="card">لا توجد حركات مطابقة.</div>';return;}
  root.innerHTML=`<div class="card" style="overflow:auto"><table class="l" style="min-width:850px;width:100%"><thead><tr><th>التاريخ</th><th>العملية</th><th>القسم</th><th>رقم السجل</th><th>المنفذ</th><th>التفاصيل</th><th>الإجراء</th></tr></thead><tbody>${visible.map(row=>{
    const key=row.record_type+'|'+row.record_id,undoSupported=['partners','items','codes','wh','accts','customers','suppliers'].includes(row.record_type),businessReversal=['docs','vch','po','je','wo','L','mv','sret','pret','payroll'].includes(row.record_type),canUndo=undoSupported&&latest.get(key)===row.id&&['INSERT','UPDATE'].includes(row.operation);
    const snapshot={before:row.old_row,after:row.new_row};
    return `<tr><td>${esc(new Date(row.occurred_at).toLocaleString('en-GB'))}</td><td>${esc(labels[row.operation]||row.operation)}</td><td>${esc(typeLabels[row.record_type]||row.record_type)}</td><td>${esc(row.record_id)}</td><td>${esc(row.actor_id||'—')}</td><td><details><summary>عرض قبل / بعد</summary><pre style="white-space:pre-wrap;direction:ltr;text-align:left;max-width:520px;overflow:auto">${esc(JSON.stringify(snapshot,null,2))}</pre></details></td><td>${canUndo?`<button class="g" type="button" data-undo="${Number(row.id)}">تراجع آمن</button>`:businessReversal?'<span title="استخدم التراجع من شاشة الحركة" class="mu">عكس من شاشة الحركة</span>':'—'}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}
async function undoClick(event) {
  const button=event.target.closest('[data-undo]'); if(!button)return;
  const id=Number(button.dataset.undo); if(!Number.isSafeInteger(id)||id<=0)return;
  if(!confirm('سيتم إنشاء حركة عكسية لآخر تعديل على هذا السجل. لن يُحذف سجل التدقيق. هل تريد المتابعة؟'))return;
  button.disabled=true; status('جارٍ تنفيذ التراجع والتحقق من عدم وجود تعديل أحدث...');
  let supabase;
  try { supabase = await getSupabase(); }
  catch (error) { status('تعذر الاتصال بقاعدة البيانات: '+(error?.message||String(error)),true); button.disabled=false; return; }
  const {error}=await supabase.rpc('undo_factory_record_change',{p_audit_id:id});
  if(error){status(error.code==='40001'?'لم يتم التراجع: توجد حركة أحدث أو تعارض. حدّث السجل وراجع آخر تغيير.':'تعذر التراجع: '+error.message,true);button.disabled=false;return;}
  status('تم التراجع بحركة عكسية موثقة. جارٍ تحديث السجل.');
  try{await loadRows()}catch(e){status(e.message,true);}
}
async function openPanel() {
  ensureUi(); panel.style.display='block'; document.body.style.overflow='hidden';
  try{await verifyAdmin();await loadRows();}
  catch(error){status(error.message,true);panel.querySelector('#factory-audit-content').innerHTML='<div class="card">لا يمكن عرض سجل التدقيق لهذا الحساب.</div>';}
}
function closePanel(){if(panel)panel.style.display='none';document.body.style.overflow='';}
ensureUi();
