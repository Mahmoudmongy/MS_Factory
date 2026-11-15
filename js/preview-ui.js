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
  Object.assign(EN,{"القوائم المالية":"Financial statements","ترتيب مؤشرات الملخص":"Summary indicator order","صافي المبيعات للفترة المحددة":"Net sales for the selected period","كما في ":"As of ","أزرق هادئ":"Soft blue","تركواز":"Teal","أخضر":"Green","بنفسجي":"Purple","طوبي":"Clay","يمكنك اختيار البطاقات العلوية والأرصدة المهمة أو إخفاء أي مؤشر. هذه الاختيارات لا تغيّر البيانات المحاسبية.":"Choose which indicators appear in the top summary or key balances, or hide them. These preferences do not change accounting data.","تخصيص الملخص":"Customize summary","تفضيلات العرض لهذا المستخدم على هذا الجهاز":"Display preferences for this user on this device","أعلى الملخص":"Top summary","الأرصدة المهمة":"Key balances","إخفاء":"Hide","العملاء":"Customers","الموردون":"Suppliers","النقدية والبنوك":"Cash and banks","صافي الربح":"Net profit","إجمالي الأصول":"Total assets","المبيعات":"Sales","المخزون الحالي":"Current inventory","الالتزامات":"Liabilities","حقوق الملكية":"Equity","الأرصدة المستحقة للشركة":"Amounts due from customers","الأرصدة المستحقة للموردين":"Amounts due to suppliers","إجمالي الحسابات النقدية الرئيسية والفرعية":"Total main and sub cash accounts","للفترة المحددة":"For the selected period","حتى":"As of","قيمة حسابات المخزون وتحت التصنيع":"Inventory and work-in-progress account value","آخر المستندات والحركات":"Recent documents and transactions","أرقام من الحسابات والقيود الفعلية":"Figures from actual accounts and ledger entries","من سجلات الشركة الحالية":"From current company records","لا توجد مستندات مسجلة":"No documents recorded","لم تختر مؤشرات للعرض في الأعلى":"No indicators selected for the top section","لم تختر أرصدة للعرض هنا":"No balances selected for this section","اختر مكان كل مؤشر. تُحفظ هذه التفضيلات على هذا الجهاز ولا تغيّر بيانات الشركة.":"Choose where each indicator appears. These preferences are saved on this device and do not change company data.","من تاريخ (قائمة الدخل)":"From date (income statement)","إلى تاريخ":"To date","تطبيق الفترة":"Apply period","يتم تحديث العرض تلقائيًا بعد اختيار التاريخ":"The report updates automatically after a date is selected","قائمة الدخل":"Income statement","قائمة المركز المالي":"Balance sheet","الإيرادات":"Revenue","المصروفات":"Expenses","صافي الربح / الخسارة":"Net profit / loss","الأصول":"Assets","نتيجة الأعمال المتراكمة حتى التاريخ المحدد":"Accumulated result through the selected date","إجمالي الالتزامات وحقوق الملكية شامل نتيجة الأعمال":"Total liabilities and equity including current results","فرق التوازن (الأصول − الالتزامات وحقوق الملكية)":"Balance difference (assets − liabilities and equity)","حركة الحساب الرئيسي مباشرة":"Direct activity in the parent account","لا توجد حسابات مسجلة في هذا القسم.":"No accounts are recorded in this section.","ميزان المراجعة":"Trial balance","سندات القبض":"Receipts","سندات الدفع":"Payments","ألوان البرنامج":"Application colors","لون مخصص":"Custom color","استعادة اللون الافتراضي":"Restore default color","تغيير الألوان":"Change colors","تفضيلات العرض":"Display preferences","الفترة الحالية:":"Current period:","تحديد الفترة":"Select period","إظهار الأرقام":"Show amounts","إخفاء الأرقام":"Hide amounts"});
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
  function summarySettingsHtml(data,layout){
    return '<div class="factory-summary-settings" id="factory-summary-settings">'+Object.values(data).map(x=>'<label><span>'+x.title+'</span><select data-summary-place="'+x.key+'"><option value="top">أعلى الملخص</option><option value="bottom">الأرصدة المهمة</option><option value="hidden">إخفاء</option></select></label>').join('')+'</div>';
  }
  function summaryCard(x){
    return '<button type="button" class="factory-kpi" data-summary-screen="'+x.screen+'" data-summary-key="'+x.key+'" aria-label="فتح تفاصيل '+x.title+'"><span>'+x.title+'</span><strong class="factory-summary-amount">'+money(x.value)+' <small>ج.م</small></strong><small class="factory-kpi-note">'+x.note+'</small></button>';
  }
  function renderHome(){
    const data=metricData(),layout=summaryLayout(data),top=Object.values(data).filter(x=>layout[x.key]==='top'),bottom=Object.values(data).filter(x=>layout[x.key]==='bottom');
    const docs=[...(S.docs||[]).map(d=>({ts:d.ts||new Date((d.date||td())+'T12:00:00').getTime(),type:TN[d.t]||'فاتورة',ref:d.no,party:pn(d.pid),amount:d.total||0,source:'doc',id:d.id})),...(S.vch||[]).map(v=>({ts:v.ts||new Date((v.date||td())+'T12:00:00').getTime(),type:v.title||'سند',ref:v.no,party:v.who||'',amount:v.total||0,source:'vch',id:v.id}))].sort((a,b)=>b.ts-a.ts).slice(0,6);
    const from=dfm(S.per?.from||''),to=dfm(S.per?.to||td());
    return ph('الملخص','<button class="g" type="button" id="factory-summary-hide" aria-pressed="'+uiPrefs.hideNumbers+'">'+(uiPrefs.hideNumbers?'إظهار الأرقام':'إخفاء الأرقام')+'</button><button class="g" type="button" id="factory-summary-settings-toggle" aria-expanded="false">تخصيص الملخص</button>')+
      '<section class="card home-period-card factory-summary-period"><div class="home-period-heading"><span>الفترة الحالية: '+from+' إلى '+to+'</span><button type="button" class="g home-period-toggle" aria-expanded="false" onclick="toggleHomePeriod(this)">تحديد الفترة</button></div><div class="home-period-fields" hidden><div><label>من تاريخ</label><input type="date" value="'+esc(S.per?.from||'')+'" data-home-period-field="from"></div><div><label>إلى تاريخ</label><input type="date" value="'+esc(S.per?.to||td())+'" data-home-period-field="to"></div></div></section>'+
      '<section id="factory-summary-settings-panel" class="card" hidden><b>ترتيب مؤشرات الملخص</b><p class="mu">اختر مكان كل مؤشر. تُحفظ هذه التفضيلات على هذا الجهاز ولا تغيّر بيانات الشركة.</p>'+summarySettingsHtml(data,layout)+'</section>'+
      '<section class="factory-kpis '+(uiPrefs.hideNumbers?'factory-hide-numbers':'')+'" id="factory-summary-kpis">'+(top.length?top.map(summaryCard).join(''):'<div class="factory-summary-empty">لم تختر مؤشرات للعرض في الأعلى</div>')+'</section>'+
      '<section class="factory-summary-panels"><div class="card factory-summary-balances"><div class="factory-panel-head"><b>الأرصدة المهمة</b><span>أرقام من الحسابات والقيود الفعلية</span></div><div id="factory-summary-balances">'+(bottom.length?bottom.map(x=>'<button type="button" class="factory-balance-row" data-summary-screen="'+x.screen+'" data-summary-key="'+x.key+'"><span>'+x.title+'<small>'+x.note+'</small></span><strong class="factory-summary-amount">'+money(x.value)+' ج.م</strong></button>').join(''):'<div class="factory-summary-empty">لم تختر أرصدة للعرض هنا</div>')+'</div></div><div class="card factory-summary-recent '+(uiPrefs.hideNumbers?'factory-hide-numbers':'')+'"><div class="factory-panel-head"><b>آخر المستندات والحركات</b><span>من سجلات الشركة الحالية</span></div>'+(docs.length?'<div class="factory-recent-list">'+docs.map(d=>'<button type="button" class="factory-recent-row" data-open-source="'+d.source+'" data-open-id="'+esc(d.id)+'"><span><b>'+esc(d.type)+' · '+esc(d.ref||'')+'</b><small>'+esc(d.party)+' · '+new Date(d.ts).toLocaleDateString('en-GB')+'</small></span><strong class="factory-summary-amount">'+money(d.amount)+' ج.م</strong></button>').join('')+'</div>':'<div class="factory-summary-empty">لا توجد مستندات مسجلة</div>')+'</div></section>';
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
    const finTarget=e.target.closest('[data-fin-account],[data-fin-type],[data-fin-profit]');if(finTarget){e.preventDefault();e.stopPropagation();const from=finTarget.dataset.finFrom||'',to=finTarget.dataset.finTo||'';if(finTarget.dataset.finAccount)openAccountTreeLedger(finTarget.dataset.finAccount,from,to);else{const types=finTarget.dataset.finProfit?['I','X']:[finTarget.dataset.finType],ids=(S.accts||[]).filter(a=>types.includes(a.t)).map(a=>a.id);openFinancialLedger(ids,finTarget.dataset.finProfit?'صافي الربح / الخسارة':({I:'الإيرادات',X:'المصروفات',A:'الأصول',L:'الالتزامات',Q:'حقوق الملكية'}[types[0]]||'الحسابات'),from,to);}return;}
    const summaryTarget=e.target.closest('[data-summary-screen]');if(summaryTarget){const key=summaryTarget.dataset.summaryKey;if(key==='assets')fsState.kind='balance';else if(key==='profit')fsState.kind='income';if(summaryTarget.dataset.summaryScreen==='rep')R.rep='sale';go(summaryTarget.dataset.summaryScreen);return;}
    const recent=e.target.closest('[data-open-source]');if(recent){openRef(recent.dataset.openSource,recent.dataset.openId);return;}
    if(e.target.closest('#factory-summary-hide')){uiPrefs.hideNumbers=!uiPrefs.hideNumbers;saveUiPrefs();document.getElementById('factory-summary-kpis')?.classList.toggle('factory-hide-numbers',uiPrefs.hideNumbers);document.querySelector('.factory-summary-balances')?.classList.toggle('factory-hide-numbers',uiPrefs.hideNumbers);document.querySelector('.factory-summary-recent')?.classList.toggle('factory-hide-numbers',uiPrefs.hideNumbers);const b=document.getElementById('factory-summary-hide');if(b){b.textContent=uiPrefs.hideNumbers?'إظهار الأرقام':'إخفاء الأرقام';b.setAttribute('aria-pressed',String(uiPrefs.hideNumbers));}return;}
    if(e.target.closest('#factory-summary-settings-toggle')){const p=document.getElementById('factory-summary-settings-panel'),b=document.getElementById('factory-summary-settings-toggle');if(p){p.hidden=!p.hidden;b?.setAttribute('aria-expanded',String(!p.hidden));refreshSummarySettings();}return;}
    const fs=e.target.closest('[data-fs-kind]');if(fs){setFinancialKind(fs.dataset.fsKind);return;}
    if(e.target.closest('[data-fs-apply]')){applyFinancialPeriod();return;}
  }
  document.addEventListener('click',onUiClick);
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
    SCR.home=renderHome;addStatementNavigation();installReferenceScreens();extendSettings();installHeaderControls();installThemePopover();
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
