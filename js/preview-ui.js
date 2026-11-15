/* MS Factory — preview.html visual system, connected to live application state.
 * This file changes presentation and user-interface preferences only.
 * Financial figures are derived from S.accts, S.L, S.partners, S.docs and S.items.
 * No demo transactions, fixed balances, local operational records or Supabase writes are created here.
 */
(function(){
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>Number(v||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const prefKey='ms-factory-preview-ui-v1';
  const colors={
    teal:{label:'تركواز',color:'#0f766e',side:'#1f2d3a'},
    blue:{label:'أزرق هادئ',color:'#315b8a',side:'#1d2b3f'},
    green:{label:'أخضر',color:'#19764b',side:'#20362c'},
    purple:{label:'بنفسجي',color:'#7650a1',side:'#30253b'},
    clay:{label:'طوبي',color:'#b65a3a',side:'#392923'}
  };
  let uiPrefs={summary:{},hideNumbers:false,accent:'teal',customColor:''};
  try{uiPrefs={...uiPrefs,...JSON.parse(localStorage.getItem(prefKey)||'{}')};}catch(_){}
  Object.assign(EN,{"القوائم المالية":"Financial statements","ترتيب مؤشرات الملخص":"Summary indicator order","صافي المبيعات للفترة المحددة":"Net sales for the selected period","كما في ":"As of ","أزرق هادئ":"Soft blue","تركواز":"Teal","أخضر":"Green","بنفسجي":"Purple","طوبي":"Clay","يمكنك اختيار البطاقات العلوية والأرصدة المهمة أو إخفاء أي مؤشر. هذه الاختيارات لا تغيّر البيانات المحاسبية.":"Choose which indicators appear in the top summary or key balances, or hide them. These preferences do not change accounting data.","تخصيص الملخص":"Customize summary","تفضيلات العرض لهذا المستخدم على هذا الجهاز":"Display preferences for this user on this device","أعلى الملخص":"Top summary","الأرصدة المهمة":"Key balances","إخفاء":"Hide","العملاء":"Customers","الموردون":"Suppliers","النقدية والبنوك":"Cash and banks","صافي الربح":"Net profit","إجمالي الأصول":"Total assets","المبيعات":"Sales","المخزون الحالي":"Current inventory","الالتزامات":"Liabilities","حقوق الملكية":"Equity","الأرصدة المستحقة للشركة":"Amounts due from customers","الأرصدة المستحقة للموردين":"Amounts due to suppliers","إجمالي الحسابات النقدية الرئيسية والفرعية":"Total main and sub cash accounts","للفترة المحددة":"For the selected period","حتى":"As of","قيمة حسابات المخزون وتحت التصنيع":"Inventory and work-in-progress account value","آخر المستندات والحركات":"Recent documents and transactions","أرقام من الحسابات والقيود الفعلية":"Figures from actual accounts and ledger entries","من سجلات الشركة الحالية":"From current company records","لا توجد مستندات مسجلة":"No documents recorded","لم تختر مؤشرات للعرض في الأعلى":"No indicators selected for the top section","لم تختر أرصدة للعرض هنا":"No balances selected for this section","اختر مكان كل مؤشر. تُحفظ هذه التفضيلات على هذا الجهاز ولا تغيّر بيانات الشركة.":"Choose where each indicator appears. These preferences are saved on this device and do not change company data.","من تاريخ (قائمة الدخل)":"From date (income statement)","إلى تاريخ":"To date","تطبيق الفترة":"Apply period","يتم تحديث العرض تلقائيًا بعد اختيار التاريخ":"The report updates automatically after a date is selected","قائمة الدخل":"Income statement","قائمة المركز المالي":"Balance sheet","الإيرادات":"Revenue","المصروفات":"Expenses","صافي الربح / الخسارة":"Net profit / loss","الأصول":"Assets","نتيجة الأعمال المتراكمة حتى التاريخ المحدد":"Accumulated result through the selected date","إجمالي الالتزامات وحقوق الملكية شامل نتيجة الأعمال":"Total liabilities and equity including current results","فرق التوازن (الأصول − الالتزامات وحقوق الملكية)":"Balance difference (assets − liabilities and equity)","حركة الحساب الرئيسي مباشرة":"Direct activity in the parent account","لا توجد حسابات مسجلة في هذا القسم.":"No accounts are recorded in this section.","ميزان المراجعة":"Trial balance","سندات القبض":"Receipts","سندات الدفع":"Payments","ألوان البرنامج":"Application colors","لون مخصص":"Custom color","استعادة اللون الافتراضي":"Restore default color","تغيير الألوان":"Change colors","تفضيلات العرض":"Display preferences","الفترة الحالية:":"Current period:","تحديد الفترة":"Select period","إظهار الأرقام":"Show amounts","إخفاء الأرقام":"Hide amounts","اختر مكان كل مؤشر ورتّب ظهوره. تُحفظ هذه التفضيلات على هذا الجهاز ولا تغيّر البيانات المحاسبية.":"Choose where each indicator appears and reorder it. These preferences are saved on this device and do not change accounting data.","أحدث الحركات":"Latest activity","الأحدث أولاً · من سجلات الشركة الحالية":"Newest first · From current company records","مرحّل":"Posted","غير مرحّل":"Not posted","قيد التنفيذ":"In progress","مكتمل":"Completed","جديد":"New","متوازن":"Balanced","غير متوازن":"Unbalanced","مسددة":"Paid","مسددة جزئياً":"Partially paid","غير مسددة":"Unpaid","مستند جديد":"New document","كل الأنواع":"All types","حالة السداد":"Payment status","كل الحالات":"All statuses","فواتير المبيعات":"Sales invoices","فواتير المشتريات":"Purchase invoices","مرتجعات المبيعات":"Sales returns","مرتجعات المشتريات":"Purchase returns","آخر فاتورة أولاً":"Latest invoice first","عدد الأصناف":"Items count","المدفوع":"Paid","المتبقي":"Remaining","الإجراءات":"Actions","لا توجد مستندات في الفترة المحددة":"No documents in the selected period","لا توجد سندات مسجلة في الفترة المحددة":"No vouchers in the selected period","حساب القبض":"Receipt account","حساب الدفع":"Payment account","العميل / الدافع":"Customer / payer","المورد / المستفيد":"Supplier / payee","البيان":"Description","المبلغ":"Amount","مرتبة من الأحدث إلى الأقدم":"Sorted newest first","الصافي بعد الخصم":"Net after discount","عدد الأصناف":"Items count","الفاتورة الأصلية":"Original invoice","تصدير Excel":"Export Excel","كل الحسابات":"All accounts","مرتبطة بالفاتورة الأصلية":"Linked to original invoice"});
  Object.assign(EN,{"لا توجد سندات مطابقة في الفترة المحددة":"No matching vouchers in the selected period","لا توجد مستندات مطابقة في الفترة المحددة":"No matching documents in the selected period","جزئي":"Partial"});
  Object.assign(EN,{"المرجع بالفاتورة الأصلية":"Original invoice reference","مرتبطة بفاتورة الشراء الأصلية":"Linked to original purchase invoice"});
  TRK=null;
  function saveUiPrefs(){try{localStorage.setItem(prefKey,JSON.stringify(uiPrefs));}catch(_){}}
  function colorShade(hex){const h=String(hex||'').replace('#','');if(!/^[0-9a-f]{6}$/i.test(h))return '#26313a';return '#'+[0,2,4].map(i=>Math.round(parseInt(h.slice(i,i+2),16)*.38).toString(16).padStart(2,'0')).join('');}
  function applyAccent(name,color,save=true){
    const preset=colors[name],value=/^#[0-9a-f]{6}$/i.test(color||'')?color:(preset?.color||colors.teal.color);
    const root=document.documentElement;
    root.style.setProperty('--pr',value);
    root.style.setProperty('--pr2',`color-mix(in srgb, ${value} 14%, var(--card))`);
    root.style.setProperty('--factory-sidebar',preset?.side||colorShade(value));
    document.querySelectorAll('[data-factory-accent]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.factoryAccent===name)));
    const input=document.getElementById('factory-custom-accent');if(input)input.value=value;
    if(save){uiPrefs.accent=name;uiPrefs.customColor=name==='custom'?value:'';saveUiPrefs();}
  }
  function installThemePopover(){
    if(document.getElementById('factory-theme-popover'))return;
    const pop=document.createElement('section');pop.id='factory-theme-popover';pop.className='factory-theme-popover';pop.hidden=true;pop.setAttribute('role','dialog');pop.setAttribute('aria-label','ألوان البرنامج');
    pop.innerHTML='<div class="factory-theme-head"><strong>ألوان البرنامج</strong><button type="button" class="g factory-theme-close" aria-label="إغلاق">×</button></div><div class="factory-theme-options">'+Object.entries(colors).map(([key,c])=>'<button type="button" data-factory-accent="'+key+'" aria-pressed="false"><i style="--swatch:'+c.color+'"></i>'+c.label+'</button>').join('')+'</div><label class="factory-custom-color">لون مخصص <input id="factory-custom-accent" type="color" value="#0f766e"></label><button type="button" class="g factory-theme-reset">استعادة اللون الافتراضي</button>';
    document.body.appendChild(pop);
    pop.addEventListener('click',e=>{const b=e.target.closest('[data-factory-accent]');if(b){applyAccent(b.dataset.factoryAccent,colors[b.dataset.factoryAccent].color);pop.hidden=true;return;}if(e.target.closest('.factory-theme-close')){pop.hidden=true;return;}if(e.target.closest('.factory-theme-reset')){applyAccent('teal',colors.teal.color);pop.hidden=true;}});
    pop.querySelector('#factory-custom-accent').addEventListener('input',e=>applyAccent('custom',e.target.value));
    document.addEventListener('pointerdown',e=>{if(!pop.hidden&&!pop.contains(e.target)&&!e.target.closest('#factory-theme-open'))pop.hidden=true;});
    document.addEventListener('keydown',e=>{if(e.key==='Escape')pop.hidden=true;});
    const opener=document.getElementById('factory-theme-open');if(opener)opener.addEventListener('click',()=>{pop.hidden=!pop.hidden;});
  }
  function togglePreviewViewport(){
    const enabled=document.body.classList.toggle('factory-preview-viewport');
    const b=document.getElementById('mobile-preview-btn');
    if(b){b.setAttribute('aria-pressed',String(enabled));b.title=enabled?'العودة لعرض الكمبيوتر':'معاينة عرض الهاتف';b.textContent=enabled?'▣':'▯';}
    if(enabled)window.scrollTo({top:0,behavior:'instant'});
  }
  window.toggleFactoryPreviewViewport=togglePreviewViewport;

  function childrenOf(id){return (S.accts||[]).filter(a=>String(a.parentId||'')===String(id));}
  function accountTotal(a,from,to,seen){
    seen=seen||new Set();const key=String(a.id);if(seen.has(key))return 0;seen.add(key);
    return bal(a.id,from||'',to||'')+childrenOf(a.id).reduce((n,ch)=>n+accountTotal(ch,from,to,seen),0);
  }
  function rootsOf(type){const all=S.accts||[],ids=new Set(all.map(a=>String(a.id)));return all.filter(a=>a.t===type&&(!a.parentId||!ids.has(String(a.parentId))));}
  function totalType(type,from,to){return rootsOf(type).reduce((n,a)=>n+accountTotal(a,from,to),0);}
  function cashTotal(to){
    const cash=(S.accts||[]).filter(a=>a.cash),hasCashAncestor=a=>{let p=a.parentId,seen=new Set();while(p){const x=(S.accts||[]).find(y=>String(y.id)===String(p));if(!x||seen.has(String(x.id)))break;if(x.cash)return true;seen.add(String(x.id));p=x.parentId;}return false;};
    return cash.filter(a=>!hasCashAncestor(a)).reduce((n,a)=>n+accountTotal(a,'',to),0);
  }
  function metricData(){
    const from=S.per?.from||'',to=S.per?.to||td();
    const income=totalType('I',from,to),expenses=totalType('X',from,to),profit=income-expenses;
    const customers=(S.partners||[]).filter(p=>p.c).reduce((n,p)=>n+Math.max(0,pbal(p.id)),0);
    const suppliers=(S.partners||[]).filter(p=>p.s).reduce((n,p)=>n+Math.max(0,-pbal(p.id)),0);
    const sales=(S.accts||[]).filter(a=>a.k==='sales').reduce((n,a)=>n+bal(a.id,from,to),0);
    const inventory=(S.accts||[]).filter(a=>a.k==='inv'||a.k==='wip').reduce((n,a)=>n+bal(a.id,'',to),0);
    const liabilities=totalType('L','',to),equity=totalType('Q','',to)+totalType('I','',to)-totalType('X','',to);
    return {
      customers:{key:'customers',title:'العملاء',value:customers,note:'الأرصدة المستحقة للشركة',screen:'cust',place:'top'},
      suppliers:{key:'suppliers',title:'الموردون',value:suppliers,note:'الأرصدة المستحقة للموردين',screen:'supp',place:'top'},
      cash:{key:'cash',title:'النقدية والبنوك',value:cashTotal(to),note:'إجمالي الحسابات النقدية الرئيسية والفرعية',screen:'bank',place:'top'},
      profit:{key:'profit',title:'صافي الربح',value:profit,note:'للفترة المحددة',screen:'statements',place:'top'},
      assets:{key:'assets',title:'إجمالي الأصول',value:totalType('A','',to),note:'حتى '+dfm(to),screen:'statements',place:'bottom'},
      sales:{key:'sales',title:'المبيعات',value:sales,note:'صافي المبيعات للفترة المحددة',screen:'rep',place:'bottom'},
      inventory:{key:'inventory',title:'المخزون الحالي',value:inventory,note:'قيمة حسابات المخزون وتحت التصنيع',screen:'stock',place:'bottom'},
      liabilities:{key:'liabilities',title:'الالتزامات',value:liabilities,note:'أرصدة الالتزامات حتى '+dfm(to),screen:'statements',place:'hidden'},
      equity:{key:'equity',title:'حقوق الملكية',value:equity,note:'بما فيها نتيجة الأعمال حتى التاريخ المحدد',screen:'statements',place:'hidden'}
    };
  }
  function summaryLayout(data){
    const out={};Object.values(data).forEach(x=>out[x.key]=x.place);
    Object.assign(out,uiPrefs.summary||{});
    return out;
  }
  function summaryOrder(data){
    const keys=Object.keys(data||{}),saved=Array.isArray(uiPrefs.summaryOrder)?uiPrefs.summaryOrder.filter(key=>keys.includes(key)):[];
    return [...saved,...keys.filter(key=>!saved.includes(key))];
  }
  function summarySettingsHtml(data,layout){
    return '<div class="factory-summary-settings" id="factory-summary-settings">'+summaryOrder(data).map((key,index,order)=>{const x=data[key];return '<div class="factory-summary-setting-row" data-summary-setting-key="'+key+'"><span class="factory-summary-setting-name">'+x.title+'</span><select aria-label="مكان '+x.title+'" data-summary-place="'+x.key+'"><option value="top">أعلى الملخص</option><option value="bottom">الأرصدة المهمة</option><option value="hidden">إخفاء</option></select><span class="factory-summary-order"><button type="button" class="g" data-summary-move="'+key+'" data-summary-direction="-1" aria-label="تقديم '+x.title+'" '+(index===0?'disabled':'')+'>▲</button><button type="button" class="g" data-summary-move="'+key+'" data-summary-direction="1" aria-label="تأخير '+x.title+'" '+(index===order.length-1?'disabled':'')+'>▼</button></span></div>';}).join('')+'</div>';
  }
  function summaryCard(x){
    return '<button type="button" class="factory-kpi" data-summary-screen="'+x.screen+'" data-summary-key="'+x.key+'" aria-label="فتح تفاصيل '+x.title+'"><span>'+x.title+'</span><strong class="factory-summary-amount">'+money(x.value)+' <small>ج.م</small></strong><small class="factory-kpi-note">'+x.note+'</small></button>';
  }
  function renderHome(){
    const data=metricData(),layout=summaryLayout(data),ordered=summaryOrder(data).map(key=>data[key]).filter(Boolean),top=ordered.filter(x=>layout[x.key]==='top'),bottom=ordered.filter(x=>layout[x.key]==='bottom');
    const recent=[
      ...(S.docs||[]).map(d=>{const total=Number(d.total)||0,remaining=typeof remOf==='function'?Math.max(0,Number(remOf(d))||0):total,status=(d.t==='sret'||d.t==='pret')?'مرحّل':remaining<=.005?'مسددة':remaining<total-.005?'مسددة جزئياً':'غير مسددة';return {ts:d.ts||new Date((d.date||td())+'T12:00:00').getTime(),date:d.date||td(),type:TN[d.t]||'فاتورة',ref:d.no,party:pn(d.pid),amount:total,status,statusClass:status==='مسددة'?'':'gray',source:'doc',id:d.id};}),
      ...(S.vch||[]).map(v=>{const posted=(S.L||[]).some(l=>String(l.rid)===String(v.id)&&l.src==='vch');return {ts:v.ts||new Date((v.date||td())+'T12:00:00').getTime(),date:v.date||td(),type:v.title||(v.dir==='in'?'سند قبض':'سند دفع'),ref:v.no,party:v.who||pn(v.pid),amount:Number(v.total)||0,status:posted?'مرحّل':'غير مرحّل',statusClass:posted?'':'gray',source:'vch',id:v.id};}),
      ...(S.po||[]).map(o=>({ts:o.ts||new Date((o.date||td())+'T12:00:00').getTime(),date:o.date||td(),type:'أمر إنتاج',ref:o.no,party:pnm(o),amount:null,status:Number(o.st)===2?'مكتمل':Number(o.st)===1?'قيد التنفيذ':'جديد',statusClass:Number(o.st)===2?'':'gray',source:'po',id:o.id})),
      ...(S.je||[]).filter(j=>j.id).map(j=>{const rows=(S.L||[]).filter(l=>String(l.rid)===String(j.id)),debit=rows.reduce((n,l)=>n+(Number(l.dr)||0),0),credit=rows.reduce((n,l)=>n+(Number(l.cr)||0),0);return {ts:j.ts||new Date((j.date||td())+'T12:00:00').getTime(),date:j.date||td(),type:'قيد يومية',ref:j.no,party:'',amount:debit,status:Math.abs(debit-credit)<.005?'متوازن':'غير متوازن',statusClass:Math.abs(debit-credit)<.005?'':'gray',source:'je',id:j.id};})
    ].sort((a,b)=>b.ts-a.ts).slice(0,6);
    const from=dfm(S.per?.from||''),to=dfm(S.per?.to||td());
    const recentTable='<div class="factory-table-scroll factory-summary-table-scroll"><table class="factory-summary-mini-table"><thead><tr><th>التاريخ</th><th>النوع</th><th>المرجع</th><th>الطرف</th><th>المبلغ</th><th>الحالة</th></tr></thead><tbody>'+(recent.length?recent.map(d=>'<tr class="factory-recent-row" role="button" data-open-source="'+d.source+'" data-open-id="'+esc(d.id)+'" tabindex="0"><td>'+esc(dfm(d.date))+'</td><td>'+esc(d.type)+'</td><td dir="ltr">'+esc(d.ref||'')+'</td><td>'+esc(d.party||'—')+'</td><td class="factory-summary-amount" dir="ltr">'+(d.amount===null?'—':money(d.amount)+' ج.م')+'</td><td><span class="factory-chip '+(d.statusClass||'')+'">'+esc(d.status)+'</span></td></tr>').join(''):'<tr><td colspan="6" class="factory-summary-empty">لا توجد حركات مسجلة</td></tr>')+'</tbody></table></div>';
    return ph('الملخص','<button class="g" type="button" id="factory-summary-hide" aria-pressed="'+uiPrefs.hideNumbers+'">'+(uiPrefs.hideNumbers?'إظهار الأرقام':'إخفاء الأرقام')+'</button><button class="g" type="button" id="factory-summary-settings-toggle" aria-expanded="false">تخصيص الملخص</button>')+
      '<section class="card home-period-card factory-summary-period"><div class="home-period-heading"><span>الفترة الحالية: '+from+' إلى '+to+'</span><button type="button" class="g home-period-toggle" aria-expanded="false" onclick="toggleHomePeriod(this)">تحديد الفترة</button></div><div class="home-period-fields" hidden><div><label>من تاريخ</label><input type="date" value="'+esc(S.per?.from||'')+'" data-home-period-field="from"></div><div><label>إلى تاريخ</label><input type="date" value="'+esc(S.per?.to||td())+'" data-home-period-field="to"></div></div></section>'+
      '<section id="factory-summary-settings-panel" class="card" hidden><b>ترتيب مؤشرات الملخص</b><p class="mu">اختر مكان كل مؤشر ورتّب ظهوره. تُحفظ هذه التفضيلات على هذا الجهاز ولا تغيّر البيانات المحاسبية.</p>'+summarySettingsHtml(data,layout)+'</section>'+
      '<section class="factory-kpis '+(uiPrefs.hideNumbers?'factory-hide-numbers':'')+'" id="factory-summary-kpis">'+(top.length?top.map(summaryCard).join(''):'<div class="factory-summary-empty">لم تختر مؤشرات للعرض في الأعلى</div>')+'</section>'+
      '<section class="factory-summary-panels"><div class="card factory-summary-recent '+(uiPrefs.hideNumbers?'factory-hide-numbers':'')+'"><div class="factory-panel-head"><b>أحدث الحركات</b><span>الأحدث أولاً · من سجلات الشركة الحالية</span></div>'+recentTable+'</div><div class="card factory-summary-balances"><div class="factory-panel-head"><b>الأرصدة المهمة</b><span>ج.م</span></div><div id="factory-summary-balances">'+(bottom.length?bottom.map(x=>'<button type="button" class="factory-balance-row" data-summary-screen="'+x.screen+'" data-summary-key="'+x.key+'"><span>'+x.title+'<small>'+x.note+'</small></span><strong class="factory-summary-amount">'+money(x.value)+' ج.م</strong></button>').join(''):'<div class="factory-summary-empty">لم تختر أرصدة للعرض هنا</div>')+'</div></div></section>';
  }
  function accountTreeIds(id,seen){seen=seen||new Set();const key=String(id);if(seen.has(key))return[];seen.add(key);return [id,...childrenOf(id).flatMap(a=>accountTreeIds(a.id,seen))];}
  function openFinancialLedger(ids,title,from,to){
    const keys=new Set((ids||[]).map(String)),rows=srt((S.L||[]).filter(l=>keys.has(String(l.a))&&(!from||l.d>=from)&&(!to||l.d<=to)));
    let running=0;const total=rows.reduce((n,l)=>n+(Number(l.dr||0)-Number(l.cr||0))*nat(ac_(l.a)),0);
    const body=rows.map(l=>{running+=(Number(l.dr||0)-Number(l.cr||0))*nat(ac_(l.a));return '<tr><td>'+esc(dfm(l.d||(l.ts?lday(new Date(l.ts)):'')))+'</td><td>'+esc(l.ref||'')+'</td><td>'+esc(l.desc||'')+'</td><td>'+esc(an(l.a))+'</td><td>'+esc(l.pid?pn(l.pid):'')+'</td><td>'+money(l.dr||0)+'</td><td>'+money(l.cr||0)+'</td><td>'+money(running)+'</td><td>'+(typeof rb==='function'?rb(l):'')+'</td></tr>';}).join('');
    sh('<div class="ph"><h3>حركة '+esc(title)+'</h3><div class="row"><span>'+esc(from?dfm(from)+' إلى ':'حتى ')+esc(to?dfm(to):'')+'</span>'+bk+'</div></div><div class="factory-table-scroll"><table class="l"><thead><tr><th>التاريخ</th><th>المرجع</th><th>البيان</th><th>الحساب</th><th>الطرف</th><th>مدين</th><th>دائن</th><th>الرصيد</th><th></th></tr></thead><tbody>'+(body||'<tr><td colspan="9" class="mu">لا توجد حركات في الفترة المحددة</td></tr>')+'</tbody></table></div><b>إجمالي الحركة: '+money(total)+' ج.م</b>');
  }
  function openAccountTreeLedger(id,from,to){const a=(S.accts||[]).find(x=>String(x.id)===String(id));if(!a)return;openFinancialLedger(accountTreeIds(id),'الحساب '+(a.code?a.code+' — ':'')+accountLabel(a),from,to);}
  function statementNode(a,from,to,depth=0){
    const kids=childrenOf(a.id),total=accountTotal(a,from,to),label=esc((a.code?a.code+' · ':'')+accountLabel(a));
    const own=bal(a.id,from||'',to||'');
    if(!kids.length)return '<div class="factory-fin-leaf" style="--depth:'+depth+'"><span>'+label+'</span><button type="button" class="factory-fin-amount" data-fin-account="'+esc(a.id)+'" data-fin-from="'+esc(from||'')+'" data-fin-to="'+esc(to||'')+'" aria-label="فتح حركة '+label+'">'+money(total)+' ج.م</button></div>';
    return '<details class="factory-fin-node" style="--depth:'+depth+'"><summary><span>'+label+'</span><button type="button" class="factory-fin-amount" data-fin-account="'+esc(a.id)+'" data-fin-from="'+esc(from||'')+'" data-fin-to="'+esc(to||'')+'" aria-label="فتح حركة الحساب '+label+'">'+money(total)+' ج.م</button></summary><div class="factory-fin-children">'+(Math.abs(own)>.005?'<div class="factory-fin-leaf"><span>حركة الحساب الرئيسي مباشرة</span><button type="button" class="factory-fin-amount" data-fin-account="'+esc(a.id)+'" data-fin-from="'+esc(from||'')+'" data-fin-to="'+esc(to||'')+'">'+money(own)+' ج.م</button></div>':'')+kids.map(k=>statementNode(k,from,to,depth+1)).join('')+'</div></details>';
  }
  function statementGroup(type,title,from,to){
    const roots=rootsOf(type),sum=roots.reduce((n,a)=>n+accountTotal(a,from,to),0);
    return '<section class="factory-fin-group"><header><b>'+title+'</b><button type="button" class="factory-fin-amount" data-fin-type="'+type+'" data-fin-from="'+esc(from||'')+'" data-fin-to="'+esc(to||'')+'" aria-label="فتح حركات '+title+'">'+money(sum)+' ج.م</button></header>'+(roots.length?roots.map(a=>statementNode(a,from,to)).join(''):'<p class="mu">لا توجد حسابات مسجلة في هذا القسم.</p>')+'</section>';
  }
  let fsState={from:S.per?.from||td().slice(0,8)+'01',to:S.per?.to||td(),kind:'income'};
  function renderFinancialStatements(){
    const from=fsState.from||'',to=fsState.to||td(),income=totalType('I',from,to),expenses=totalType('X',from,to),profit=income-expenses;
    const assets=totalType('A','',to),liabilities=totalType('L','',to),equityAccounts=totalType('Q','',to),retained=totalType('I','',to)-totalType('X','',to),equity=equityAccounts+retained,delta=assets-liabilities-equity;
    return ph('القوائم المالية','<button class="g" type="button" onclick="go(\'rep\');R.rep=\'tb\';render()">ميزان المراجعة</button>')+
      '<div class="factory-fin-filters"><label>من تاريخ (قائمة الدخل)<input id="factory-fs-from" type="date" value="'+esc(from)+'" max="'+esc(to)+'"></label><label>إلى تاريخ<input id="factory-fs-to" type="date" value="'+esc(to)+'" min="'+esc(from)+'"></label><span class="factory-auto-period-note" role="status">يتم تحديث العرض تلقائيًا بعد اختيار التاريخ</span></div>'+
      '<div class="factory-fin-tabs"><button type="button" data-fs-kind="income" class="'+(fsState.kind==='income'?'active':'')+'">قائمة الدخل</button><button type="button" data-fs-kind="balance" class="'+(fsState.kind==='balance'?'active':'')+'">قائمة المركز المالي</button></div>'+
      (fsState.kind==='income'?'<div class="factory-fin-heading"><h3>قائمة الدخل</h3><span>من '+dfm(from)+' إلى '+dfm(to)+'</span></div><div class="factory-fin-grid">'+statementGroup('I','الإيرادات',from,to)+statementGroup('X','المصروفات',from,to)+'</div><div class="factory-fin-result"><span>صافي الربح / الخسارة</span><button type="button" class="factory-fin-amount" data-fin-profit="1" data-fin-from="'+esc(from)+'" data-fin-to="'+esc(to)+'">'+money(profit)+' ج.م</button></div>':
      '<div class="factory-fin-heading"><h3>قائمة المركز المالي</h3><span>كما في '+dfm(to)+'</span></div><div class="factory-fin-grid">'+statementGroup('A','الأصول','',to)+statementGroup('L','الالتزامات','',to)+statementGroup('Q','حقوق الملكية','',to)+'</div><div class="factory-fin-equity-note"><span>نتيجة الأعمال المتراكمة حتى التاريخ المحدد</span><b>'+money(retained)+' ج.م</b></div><div class="factory-fin-result"><span>إجمالي الالتزامات وحقوق الملكية شامل نتيجة الأعمال</span><strong>'+money(liabilities+equity)+' ج.م</strong></div><div class="factory-fin-check '+(Math.abs(delta)<.02?'balanced':'unbalanced')+'"><span>فرق التوازن (الأصول − الالتزامات وحقوق الملكية)</span><b>'+money(delta)+' ج.م</b></div>');
  }
  function setFinancialKind(kind){fsState.kind=kind;render();}
  function applyFinancialPeriod(){
    const from=document.getElementById('factory-fs-from')?.value||'',to=document.getElementById('factory-fs-to')?.value||'';
    if(from&&to&&from>to){toast('تاريخ البداية يجب ألا يتجاوز تاريخ النهاية');document.getElementById('factory-fs-from')?.focus();return;}
    fsState.from=from;fsState.to=to;render();
  }
  function refreshSummarySettings(){
    const data=metricData(),layout=summaryLayout(data);
    document.querySelectorAll('#m [data-summary-place]').forEach(s=>s.value=layout[s.dataset.summaryPlace]||'hidden');
  }
  const referenceGroups=[
    {key:'home',title:'الملخص',ids:['home'],icon:'home'},
    {key:'bank',title:'الحسابات النقدية والبنوك',ids:['bank'],icon:'bank'},
    {key:'partners',title:'العملاء والموردون',ids:['cust','supp'],icon:'customer'},
    {key:'vouchers',title:'المقبوضات والمدفوعات',ids:['rc','py'],icon:'receipt'},
    {key:'invoices',title:'الفواتير والمرتجعات',ids:['sale','sret','pur','pret'],icon:'sale'},
    {key:'inventory',title:'الأصناف والمخازن',ids:['stock'],icon:'inventory'},
    {key:'production',title:'أوامر الإنتاج',ids:['prod'],icon:'production'},
    {key:'accounts',title:'شجرة الحسابات والميزان',ids:['coa'],icon:'coa'},
    {key:'reports',title:'التقارير',ids:['rep'],icon:'report'},
    {key:'statements',title:'القوائم المالية',ids:['statements'],icon:'report'},
    {key:'journal',title:'قيود اليومية',ids:['je'],icon:'journal'},
    {key:'employees',title:'الموظفون والصلاحيات',ids:['emp'],icon:'employee'},
    {key:'assistant',title:'مساعد بيانات الشركة',ids:['ai'],icon:'ai'},
    {key:'timeline',title:'السجل الزمني',ids:['tl'],icon:'timeline'},
    {key:'settings',title:'الإعدادات',ids:['set'],icon:'settings'}
  ];
  let originalScreens={},referenceTabsInstalled=false;
  const referenceTabLabels={cust:'العملاء',supp:'الموردون',rc:'سندات القبض',py:'سندات الدفع',sale:'فواتير البيع',sret:'مرتجعات البيع',pur:'فواتير الشراء',pret:'مرتجعات الشراء'};

  const refActionSvg={
    view:'<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="3"/>',
    print:'<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z"/>',
    edit:'<path d="m4 16-.8 4.8L8 20l11.7-11.7a2.1 2.1 0 0 0-3-3L5 17"/><path d="m14.5 6.5 3 3"/>',
    delete:'<path d="M3 6h18M8 6V4h8v2m-10 0 1 14h10l1-14M10 10v6m4-6v6"/>',
    return:'<path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-2"/>',
    label:'<path d="M20 13 13 20 3 10V4h6z"/><circle cx="7.5" cy="7.5" r="1"/>'
  };
  function refAction(label,handler,icon,danger){
    return '<button type="button" class="'+(danger?'d':'g')+' factory-row-action" title="'+esc(label)+'" aria-label="'+esc(label)+'" onclick="'+esc(handler)+'"><svg class="factory-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(refActionSvg[icon]||refActionSvg.view)+'</svg></button>';
  }
  function refActionsWrap(actions){return '<span class="factory-row-actions">'+actions+'</span>';}
  function refVoucherActions(v){
    const id=JSON.stringify(String(v.id));
    let actions=refAction('عرض تفاصيل السند','refView('+id+')','view',false);
    actions+=refAction('طباعة السند / معاينة PDF','vPrint('+id+')','print',false);
    if(can('edit'))actions+=refAction('تعديل السند','editV('+id+')','edit',false);
    if(can('del'))actions+=refAction('تراجع آمن عن السند',"delRef('vch',"+id+")",'delete',true);
    return refActionsWrap(actions);
  }
  function refDateValue(row){return row?.date||row?.d||(row?.ts?lday(new Date(row.ts)):'')||'';}
  function refDateKey(value){
    const raw=String(value||'');
    if(/^\d{4}-\d{2}-\d{2}/.test(raw))return raw.slice(0,10);
    const m=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
    return m?m[3]+'-'+String(m[2]).padStart(2,'0')+'-'+String(m[1]).padStart(2,'0'):raw;
  }
  function refExportButton(){return '<button type="button" class="g factory-reference-export" data-reference-export="1">تصدير Excel</button>';}
  function refFilterRow(key,fields){return '<div class="factory-reference-filter-row">'+fbar(key,fields)+refExportButton()+'</div>';}
  function referenceSavedSearch(key){
    try{return sessionStorage.getItem("factory-search:"+((CUR&&CUR.sid)||tab)+":"+key)||"";}catch(_){return "";}
  }
  const referenceBaseSearchApply=factorySearchApply;
  factorySearchApply=function(input){
    const query=input?.value||"",scope=input?.dataset?.searchScope||"all";
    try{sessionStorage.setItem("factory-search:"+((CUR&&CUR.sid)||tab)+":"+scope,query);}catch(_){}
    (ACT||document).querySelectorAll("table.l tr").forEach(row=>{
      if(row.querySelector("td"))row.style.display=factorySearchMatch(row.dataset.factorySearchText||row.textContent,query)?"":"none";
    });
  };
  function referenceVoucherSearchText(v){
    const accountText=voucherAccounts(v).map(x=>an(x.a)+" "+cur_(x.a)).join(" ");
    const invoiceText=Object.keys(v.alloc||{}).map(id=>(S.docs||[]).find(d=>String(d.id)===String(id))?.no||"").join(" ");
    const order=(S.po||[]).find(o=>String(o.id)===String(v.link));
    const related=v.link==="sales"?"المبيعات عام":(order&&order.no)||"";
    return [v.no,v.title,v.who,pn(v.pid),v.desc,accountText,invoiceText,related].filter(Boolean).join(" ");
  }
  function renderVoucherTable(dir){
    const incoming=dir==="in",key="v"+dir;
    FL[key]=FL[key]||{};
    const date=row=>refDateKey(refDateValue(row));
    const query=referenceSavedSearch(key);
    const rows=(S.vch||[]).filter(v=>
      v.dir===dir&&(!query||factorySearchMatch(referenceVoucherSearchText(v),query))&&
      (!fv(key,"ac")||voucherAccounts(v).some(x=>String(x.a)===String(fv(key,"ac"))))&&
      (!fv(key,"from")||date(v)>=fv(key,"from"))&&(!fv(key,"to")||date(v)<=fv(key,"to"))
    ).sort((a,b)=>date(b).localeCompare(date(a))||(Number(b.ts)||0)-(Number(a.ts)||0));
    const accounts=(S.accts||[]).filter(a=>a.cash);
    const filters=[["q","text","المرجع أو الحساب أو الطرف"],["ac","sel",incoming?"حساب القبض":"حساب الدفع",[["","كل الحسابات"],...accounts.map(a=>[String(a.id),an(a.id)+" ("+cur_(a)+")"])]],["from","date","من تاريخ"],["to","date","إلى تاريخ"]];
    const data=rows.length?rows.map(v=>{
      const accountNames=voucherAccounts(v).map(x=>an(x.a)+(x.fc?" ("+f(x.fc)+" "+(x.cur||cur_(x.a))+")":"")).filter(Boolean).join("، ")||"—";
      const party=v.who||pn(v.pid)||"—",searchText=referenceVoucherSearchText(v);
      return "<tr data-factory-search-text=\""+esc(searchText)+"\"><td>"+esc(dfm(refDateValue(v)))+"</td><td dir=\"ltr\">"+esc(v.no||"—")+"</td><td>"+esc(accountNames)+"</td><td>"+esc(party)+"</td><td>"+esc(v.desc||"—")+"</td><td><div class=\"factory-reference-amount-actions\"><strong class=\"factory-reference-amount\" dir=\"ltr\">"+f(v.total)+"</strong><small>ج.م</small>"+refVoucherActions(v)+"</div></td></tr>";
    }).join(""):"<tr><td colspan=\"6\" class=\"mu factory-reference-empty-cell\">لا توجد سندات مطابقة في الفترة المحددة</td></tr>";
    const actions=can("edit")?"<button type=\"button\" class=\"new\" onclick=\"vForm(&#39;in&#39;)\">＋ سند قبض</button><button type=\"button\" class=\"g\" onclick=\"vForm(&#39;out&#39;)\">＋ سند دفع</button>":"";
    const title=incoming?"سندات القبض":"سندات الدفع";
    return ph("المقبوضات والمدفوعات",actions)+refFilterRow(key,filters)+
      "<section class=\"card factory-reference-table-card\"><div class=\"factory-reference-table-head\"><b>"+title+"</b><span>مرتبة من الأحدث إلى الأقدم</span></div>"+
      "<div class=\"factory-table-scroll\"><table class=\"l factory-reference-data-table\"><thead><tr><th>التاريخ</th><th>المرجع</th><th>حساب "+(incoming?"القبض":"الدفع")+"</th><th>"+(incoming?"العميل":"المورد")+"</th><th>البيان</th><th>المبلغ</th></tr></thead><tbody>"+data+"</tbody></table></div></section>";
  }
  function refOriginalInvoiceCell(row){
    const id=row.originalId||row.originalDocId||row.baseDocId||'';
    const original=(S.docs||[]).find(d=>String(d.id)===String(id));
    if(original)return '<button type="button" class="g factory-original-invoice" onclick="inv(&quot;'+String(original.id).replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'&quot;)">'+esc(original.no||'عرض الفاتورة')+'</button>';
    return esc(row.ref||row.originalNo||row.originalInvoiceNo||'—');
  }
  function refInvoiceActions(row,type){
    const id=JSON.stringify(String(row.id));
    let actions=refAction('عرض الفاتورة / طباعة / PDF','inv('+id+')','view',false);
    if(type==='sale'||type==='pur'){
      actions+=refAction(type==='sale'?'إنشاء مرتجع بيع':'إنشاء مرتجع شراء','retFrom('+id+')','return',false);
      if((row.lines||[]).some(line=>line.iid))actions+=refAction('طباعة ملصقات الباركود','docLb('+id+')','label',false);
    }
    if(can('edit'))actions+=refAction('تعديل الفاتورة','editDoc('+id+')','edit',false);
    if(can('del'))actions+=refAction('تراجع آمن عن الفاتورة',"delRef('doc',"+id+")",'delete',true);
    return refActionsWrap(actions);
  }
  function referenceInvoiceSearchText(d){
    const items=(d.lines||[]).flatMap(line=>[line.name,line.sku,line.barcode,line.v,line.note,codeOf(line)]);
    return [d.no,pn(d.pid),d.who,d.note,...items].filter(Boolean).join(" ");
  }
  function renderInvoiceTable(type){
    const key="d"+type,isSale=type==="sale"||type==="sret",isReturn=type==="sret"||type==="pret",isSaleInvoice=type==="sale",isPay=type==="sale"||type==="pur";
    FL[key]=FL[key]||{};
    const date=row=>refDateKey(refDateValue(row)),query=referenceSavedSearch(key);
    const filters=[["q","text","رقم الفاتورة أو العميل أو الصنف"],["cat","sel","التبويب",[["all","كل الأنواع"],["mfg","تصنيع"],["sup","مشتريات"]]]];
    if(isPay)filters.push(["st","sel","حالة السداد",[["","كل الحالات"],["مسددة","مسددة"],["مسددة جزئيًا","مسددة جزئيًا"],["غير مسددة","غير مسددة"]]]);
    filters.push(["from","date","من تاريخ"],["to","date","إلى تاريخ"]);
    const rows=(S.docs||[]).filter(d=>
      d.t===type&&(!query||factorySearchMatch(referenceInvoiceSearchText(d),query))&&
      (!fv(key,"cat")||fv(key,"cat")==="all"||d.cat===fv(key,"cat"))&&
      (!fv(key,"st")||stOf(d)===fv(key,"st"))&&
      (!fv(key,"from")||date(d)>=fv(key,"from"))&&(!fv(key,"to")||date(d)<=fv(key,"to"))
    ).sort((a,b)=>date(b).localeCompare(date(a))||(Number(b.ts)||0)-(Number(a.ts)||0));
    const title=type==="sale"?"فواتير البيع":type==="sret"?"مرتجعات البيع":type==="pur"?"فواتير الشراء":"مرتجعات الشراء";
    const data=rows.length?rows.map(row=>{
      const party=pn(row.pid)||row.who||"—",total=Number(row.total)||0,searchText=referenceInvoiceSearchText(row);
      const posted=(S.L||[]).some(l=>l.src==="doc"&&String(l.rid)===String(row.id));
      const status=isReturn?(posted||row.manager_read_only?"مرحّل":"غير مرحّل"):stOf(row);
      const statusLabel=status==="مسددة جزئيًا"?"جزئي":status;
      const statusClass=status==="مسددة"?"paid":status==="مسددة جزئيًا"?"partial":status==="غير مسددة"?"unpaid":posted||row.manager_read_only?"posted":"unposted";
      const actions=refInvoiceActions(row,type);
      if(isReturn){
        return "<tr data-factory-search-text=\""+esc(searchText)+"\"><td>"+esc(dfm(refDateValue(row)))+"</td><td dir=\"ltr\">"+esc(row.no||"—")+"</td><td dir=\"ltr\">"+refOriginalInvoiceCell(row)+"</td><td>"+esc(party)+"</td><td class=\"factory-reference-amount\" dir=\"ltr\">"+f(total)+" <small>ج.م</small></td><td><div class=\"factory-reference-status-actions\"><span class=\"factory-reference-status "+statusClass+"\">"+esc(statusLabel)+"</span>"+actions+"</div></td></tr>";
      }
      const paid=paidOf(row),remaining=remOf(row);
      if(isSaleInvoice){
        return "<tr data-factory-search-text=\""+esc(searchText)+"\"><td>"+esc(dfm(refDateValue(row)))+"</td><td dir=\"ltr\">"+esc(row.no||"—")+"</td><td>"+esc(party)+"</td><td class=\"factory-reference-count\">"+(row.lines||[]).length+"</td><td class=\"factory-reference-amount\" dir=\"ltr\">"+f(total)+"</td><td class=\"factory-reference-amount\" dir=\"ltr\">"+(paid>.005?f(paid):"—")+"</td><td class=\"factory-reference-amount\" dir=\"ltr\">"+f(remaining)+"</td><td><div class=\"factory-reference-status-actions\"><span class=\"factory-reference-status "+statusClass+"\">"+esc(statusLabel)+"</span>"+actions+"</div></td></tr>";
      }
      return "<tr data-factory-search-text=\""+esc(searchText)+"\"><td>"+esc(dfm(refDateValue(row)))+"</td><td dir=\"ltr\">"+esc(row.no||"—")+"</td><td>"+esc(party)+"</td><td class=\"factory-reference-count\">"+(row.lines||[]).length+"</td><td class=\"factory-reference-amount\" dir=\"ltr\">"+f(total)+"</td><td class=\"factory-reference-amount\" dir=\"ltr\">"+(paid>.005?f(paid):"—")+"</td><td><div class=\"factory-reference-amount-actions\"><strong>"+f(remaining)+"</strong><small>ج.م</small>"+actions+"</div></td></tr>";
    }).join(""):"<tr><td colspan=\""+(isReturn?6:isSaleInvoice?8:7)+"\" class=\"mu factory-reference-empty-cell\">لا توجد مستندات مطابقة في الفترة المحددة</td></tr>";
    const headingAction=can("edit")?"<button type=\"button\" class=\"new\" onclick=\"docForm(&#39;"+type+"&#39;)\">＋ مستند جديد</button>":"";
    const headers=isReturn?
      "<th>التاريخ</th><th>المرجع</th><th>الفاتورة الأصلية</th><th>"+(isSale?"العميل":"المورد")+"</th><th>الصافي بعد الخصم</th><th>الحالة</th>":
      "<th>التاريخ</th><th>المرجع</th><th>"+(isSale?"العميل":"المورد")+"</th><th>عدد الأصناف</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th>"+(isSaleInvoice?"<th>الحالة</th>":"");
    return ph("الفواتير والمرتجعات",headingAction)+refFilterRow(key,filters)+
      "<section class=\"card factory-reference-table-card\"><div class=\"factory-reference-table-head\"><b>"+title+"</b><span>"+(isReturn?(type==="sret"?"المرجع بالفاتورة الأصلية":"مرتبطة بفاتورة الشراء الأصلية"):"آخر فاتورة أولاً")+"</span></div>"+
      "<div class=\"factory-table-scroll\"><table class=\"l factory-reference-data-table\"><thead><tr>"+headers+"</tr></thead><tbody>"+data+"</tbody></table></div></section>";
  }
  function installLiveReferenceScreens(){
    originalScreens.rc=()=>renderVoucherTable('in');
    originalScreens.py=()=>renderVoucherTable('out');
    originalScreens.sale=()=>renderInvoiceTable('sale');
    originalScreens.sret=()=>renderInvoiceTable('sret');
    originalScreens.pur=()=>renderInvoiceTable('pur');
    originalScreens.pret=()=>renderInvoiceTable('pret');
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-reference-export]');
    if(!button)return;
    const surface=button.closest('.factory-reference-screen-body');
    const table=surface?.querySelector('.factory-reference-data-table');
    if(!table){toast('لا يوجد جدول لتصديره');return;}
    xl(table,[...table.querySelectorAll('tbody tr')]);
  });

  function renderReferenceGroup(group){
    const permitted=new Set(allowed().map(x=>x[0]));
    const visibleIds=group.ids.filter(id=>permitted.has(id)&&typeof originalScreens[id]==='function');
    if(!visibleIds.length)return '<div class="factory-reference-empty">لا توجد شاشات متاحة لهذا الحساب</div>';
    const active=visibleIds.includes(CUR?.sid)?CUR.sid:visibleIds[0];
    const template=document.createElement('template');
    template.innerHTML=originalScreens[active]();
    const heading=template.content.querySelector('.ph');
    const actions=heading?.querySelector('.row')?.innerHTML||'';
    heading?.remove();
    const tabs=visibleIds.length>1
      ? '<div class="preview-module-tabs" role="tablist" aria-label="'+esc(group.title)+'">'+visibleIds.map(id=>'<button type="button" role="tab" data-preview-screen-tab="'+id+'" aria-selected="'+String(id===active)+'" class="'+(id===active?'active':'')+'">'+esc(referenceTabLabels[id]||N[id]||id)+'</button>').join('')+'</div>'
      : '';
    return ph(group.title,actions)+tabs+'<div class="factory-reference-screen-body">'+template.innerHTML+'</div>';
  }
  function installReferenceScreens(){
    if(referenceTabsInstalled)return;
    referenceTabsInstalled=true;
    ['cust','supp','rc','py','sale','sret','pur','pret'].forEach(id=>{originalScreens[id]=SCR[id];});
    ['cust','supp'].forEach(id=>SCR[id]=()=>renderReferenceGroup(referenceGroups.find(x=>x.key==='partners')));
    ['rc','py'].forEach(id=>SCR[id]=()=>renderReferenceGroup(referenceGroups.find(x=>x.key==='vouchers')));
    ['sale','sret','pur','pret'].forEach(id=>SCR[id]=()=>renderReferenceGroup(referenceGroups.find(x=>x.key==='invoices')));
    const labels={
      home:'الملخص',bank:'الحسابات النقدية والبنوك',cust:'العملاء والموردون',supp:'العملاء والموردون',
      rc:'المقبوضات والمدفوعات',py:'المقبوضات والمدفوعات',
      sale:'الفواتير والمرتجعات',sret:'الفواتير والمرتجعات',pur:'الفواتير والمرتجعات',pret:'الفواتير والمرتجعات',
      stock:'الأصناف والمخازن',prod:'أوامر الإنتاج',coa:'شجرة الحسابات والميزان',rep:'التقارير',
      statements:'القوائم المالية',je:'قيود اليومية',emp:'الموظفون والصلاحيات',ai:'مساعد بيانات الشركة',tl:'السجل الزمني',set:'الإعدادات'
    };
    Object.assign(N,labels);
    Object.assign(EN,{'العملاء والموردون':'Customers and suppliers','المقبوضات والمدفوعات':'Receipts and payments','الفواتير والمرتجعات':'Invoices and returns','الأصناف والمخازن':'Items and warehouses','شجرة الحسابات والميزان':'Chart of accounts and trial balance','الموظفون والصلاحيات':'Employees and permissions','مساعد بيانات الشركة':'Company data assistant'});
  }
  function renderReferenceSidebar(){
    const sb=document.getElementById('sb'),scroll=sb?.querySelector('.sb-nav-scroll');
    if(!scroll)return;
    const sourceLinks=new Map([...scroll.querySelectorAll('a')].map(a=>[a.getAttribute('onclick')?.match(/'([^']+)'/)?.[1],a]));
    const permitted=new Set(allowed().map(x=>x[0]));
    const current=CUR?.kind==='screen'?CUR.sid:tab;
    const fragment=document.createDocumentFragment();
    referenceGroups.forEach(group=>{
      const ids=group.ids.filter(id=>permitted.has(id));
      if(!ids.length)return;
      const target=ids.includes(current)?current:ids[0];
      const source=sourceLinks.get(target)||sourceLinks.get(ids[0]);
      const link=document.createElement('a');
      link.href='#';
      link.className='factory-nav-link'+(group.ids.includes(current)?' on':'');
      link.setAttribute('data-reference-nav',group.key);
      link.setAttribute('aria-current',group.ids.includes(current)?'page':'false');
      const icon=source?.querySelector('svg.nav-ico');
      if(icon)link.appendChild(icon.cloneNode(true));
      else{
        const fallback=document.createElement('span');fallback.className='factory-nav-fallback';fallback.textContent='•';link.appendChild(fallback);
      }
      const label=document.createElement('span');label.className='factory-nav-label';label.textContent=group.title;link.appendChild(label);
      link.addEventListener('click',e=>{e.preventDefault();handleNavClick(e,target);});
      link.addEventListener('auxclick',e=>{if(e.button===1){e.preventDefault();go(target,0,true);}});
      link.addEventListener('mousedown',e=>{if(e.button===1)e.preventDefault();});
      fragment.appendChild(link);
    });
    scroll.replaceChildren(fragment);
    applySidebarMode();
  }
  function onUiClick(e){
    const screenTab=e.target.closest('[data-preview-screen-tab]');if(screenTab){const target=screenTab.dataset.previewScreenTab;if(target&&target!==CUR?.sid)go(target,1);return;}
    const summaryMove=e.target.closest('[data-summary-move]');if(summaryMove){const order=summaryOrder(metricData()),index=order.indexOf(summaryMove.dataset.summaryMove),next=index+Number(summaryMove.dataset.summaryDirection||0);if(index>=0&&next>=0&&next<order.length){[order[index],order[next]]=[order[next],order[index]];uiPrefs.summaryOrder=order;saveUiPrefs();render();}return;}
    const finTarget=e.target.closest('[data-fin-account],[data-fin-type],[data-fin-profit]');if(finTarget){e.preventDefault();e.stopPropagation();const from=finTarget.dataset.finFrom||'',to=finTarget.dataset.finTo||'';if(finTarget.dataset.finAccount)openAccountTreeLedger(finTarget.dataset.finAccount,from,to);else{const types=finTarget.dataset.finProfit?['I','X']:[finTarget.dataset.finType],ids=(S.accts||[]).filter(a=>types.includes(a.t)).map(a=>a.id);openFinancialLedger(ids,finTarget.dataset.finProfit?'صافي الربح / الخسارة':({I:'الإيرادات',X:'المصروفات',A:'الأصول',L:'الالتزامات',Q:'حقوق الملكية'}[types[0]]||'الحسابات'),from,to);}return;}
    const summaryTarget=e.target.closest('[data-summary-screen]');if(summaryTarget){const key=summaryTarget.dataset.summaryKey;if(key==='assets')fsState.kind='balance';else if(key==='profit')fsState.kind='income';if(summaryTarget.dataset.summaryScreen==='rep')R.rep='sale';go(summaryTarget.dataset.summaryScreen);return;}
    const recent=e.target.closest('[data-open-source]');if(recent){openRef(recent.dataset.openSource,recent.dataset.openId);return;}
    if(e.target.closest('#factory-summary-hide')){uiPrefs.hideNumbers=!uiPrefs.hideNumbers;saveUiPrefs();document.getElementById('factory-summary-kpis')?.classList.toggle('factory-hide-numbers',uiPrefs.hideNumbers);document.querySelector('.factory-summary-balances')?.classList.toggle('factory-hide-numbers',uiPrefs.hideNumbers);document.querySelector('.factory-summary-recent')?.classList.toggle('factory-hide-numbers',uiPrefs.hideNumbers);const b=document.getElementById('factory-summary-hide');if(b){b.textContent=uiPrefs.hideNumbers?'إظهار الأرقام':'إخفاء الأرقام';b.setAttribute('aria-pressed',String(uiPrefs.hideNumbers));}return;}
    if(e.target.closest('#factory-summary-settings-toggle')){const p=document.getElementById('factory-summary-settings-panel'),b=document.getElementById('factory-summary-settings-toggle');if(p){p.hidden=!p.hidden;b?.setAttribute('aria-expanded',String(!p.hidden));refreshSummarySettings();}return;}
    const fs=e.target.closest('[data-fs-kind]');if(fs){setFinancialKind(fs.dataset.fsKind);return;}
    if(e.target.closest('[data-fs-apply]')){applyFinancialPeriod();return;}
  }
  document.addEventListener('click',onUiClick);
  document.addEventListener('keydown',event=>{const row=event.target.closest?.('.factory-recent-row[role="button"]');if(row&&(event.key==='Enter'||event.key===' ')){event.preventDefault();openRef(row.dataset.openSource,row.dataset.openId);}});
  document.addEventListener('input',e=>{
    if(e.target?.id==='factory-fs-from'){const end=document.getElementById('factory-fs-to');if(end)end.min=e.target.value||'';}
    if(e.target?.id==='factory-fs-to'){const start=document.getElementById('factory-fs-from');if(start)start.max=e.target.value||'';}
  });
  document.addEventListener('change',e=>{
    if(e.target?.id!=='factory-fs-from'&&e.target?.id!=='factory-fs-to')return;
    const from=document.getElementById('factory-fs-from')?.value||'',to=document.getElementById('factory-fs-to')?.value||'';
    if(from&&to&&from>to){toast('تاريخ البداية يجب ألا يتجاوز تاريخ النهاية');return;}
    applyFinancialPeriod();
  });
  document.addEventListener('change',e=>{
    const s=e.target.closest('[data-summary-place]');if(s){uiPrefs.summary=uiPrefs.summary||{};uiPrefs.summary[s.dataset.summaryPlace]=s.value;saveUiPrefs();render();return;}
  });

  function extendSettings(){
    const original=SCR.set;
    SCR.set=()=>original()+
      '<section class="card factory-settings-extra"><div class="factory-panel-head"><b>تخصيص الملخص</b><span>تفضيلات العرض لهذا المستخدم على هذا الجهاز</span></div>'+summarySettingsHtml(metricData(),summaryLayout(metricData()))+'<p class="mu">يمكنك اختيار البطاقات العلوية والأرصدة المهمة أو إخفاء أي مؤشر. هذه الاختيارات لا تغيّر البيانات المحاسبية.</p></section>'+
      '<section class="card factory-settings-extra"><div class="factory-panel-head"><b>ألوان البرنامج</b><button class="g" type="button" id="factory-open-theme-inline">تغيير الألوان</button></div><div class="factory-theme-inline">'+Object.entries(colors).map(([key,c])=>'<button type="button" data-factory-accent="'+key+'" aria-pressed="false"><i style="--swatch:'+c.color+'"></i>'+c.label+'</button>').join('')+'</div></section>';
  }
  function addStatementNavigation(){
    if(!T.some(x=>x[0]==='statements'))T.push(['statements',ico('report'),'القوائم المالية']);
    N.statements='القوائم المالية';
    CLOUD_SCREEN_PERMISSIONS.statements='reports';
    SCR.statements=renderFinancialStatements;
    const originalNav=nav;
    nav=function(){originalNav();renderReferenceSidebar();if(LANGEN)trTree(document.getElementById('sb'));const brand=document.querySelector('#sb .br');if(brand){brand.title=S.name||'MS Factory';brand.setAttribute('aria-label',S.name||'MS Factory');} };
  }
  function installHeaderControls(){
    const top=document.getElementById('top');if(!top)return;
    if(!document.getElementById('mobile-preview-btn')){const b=document.createElement('button');b.id='mobile-preview-btn';b.type='button';b.textContent='▯';b.title='معاينة عرض الهاتف';b.setAttribute('aria-label','تبديل عرض الهاتف');b.addEventListener('click',togglePreviewViewport);document.getElementById('net')?.insertAdjacentElement('afterend',b);}
    if(!document.getElementById('factory-theme-open')){const b=document.createElement('button');b.id='factory-theme-open';b.type='button';b.textContent='🎨';b.title='ألوان البرنامج';b.setAttribute('aria-label','اختيار ألوان البرنامج');document.getElementById('thb')?.insertAdjacentElement('beforebegin',b);}
  }
  function boot(){
    SCR.home=renderHome;addStatementNavigation();installReferenceScreens();installLiveReferenceScreens();extendSettings();installHeaderControls();installThemePopover();
    applyAccent(uiPrefs.accent||'teal',uiPrefs.customColor||colors[uiPrefs.accent||'teal']?.color,false);
    const oldApplyPref=applyPref;applyPref=function(){oldApplyPref();applyAccent(uiPrefs.accent||'teal',uiPrefs.customColor||colors[uiPrefs.accent||'teal']?.color,false);};
    const oldTogTheme=togTheme;togTheme=function(){oldTogTheme();};
    if(CUR&&CUR.kind==='screen'&&CUR.sid==='home')render();
    const oldRender=render;render=function(){oldRender();if(LANGEN)trTree(document.getElementById('m'));if(CUR?.kind==='screen'&&['home','set'].includes(CUR.sid)){refreshSummarySettings();document.querySelectorAll('#m [data-factory-accent]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.factoryAccent===(uiPrefs.accent||'teal'))));}};
    window.addEventListener('factory-database-ready',()=>{cachePublicFactoryBranding();nav();render();},{once:true});
    window.addEventListener('factory-language-changed',()=>{applyAccent(uiPrefs.accent||'teal',uiPrefs.customColor||colors[uiPrefs.accent||'teal']?.color,false);});
    document.addEventListener('click',e=>{const accent=e.target.closest('[data-factory-accent]');if(accent&&!accent.closest('#factory-theme-popover'))applyAccent(accent.dataset.factoryAccent,colors[accent.dataset.factoryAccent]?.color);if(e.target.closest('#factory-open-theme-inline')){const p=document.getElementById('factory-theme-popover');if(p)p.hidden=false;}});
  }
  boot();
})();
