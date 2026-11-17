/* Regression tests for visible-row totals, currency separation and non-additive balances. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'..','js','app.js'),'utf8');
function extract(start,end){const a=app.indexOf(start),b=app.indexOf(end,a);assert(a>=0&&b>a,'production boundary missing: '+start);return app.slice(a,b);}
const update=vm.runInNewContext(
  extract('const factoryUpdateTableSummary = function(table){','\nconst factoryEnhBeforeSummary=enh;')+'\nfactoryUpdateTableSummary',
  {LANGEN:false,f:n=>Number(n).toFixed(2),Map,Number,String,RegExp}
);
function row(values,options={}){
  return {style:{display:options.display||''},hidden:false,dataset:options.dataset||{},textContent:values.join(' '),
    children:values.map(textContent=>({textContent})),
    querySelector(selector){if(selector==='td')return {};if(selector==='[colspan]')return options.colspan?{}:null;return null;}};
}
function table(headers,rows,kind='',extra={}){
  const allRows=[{textContent:headers.map(x=>x.textContent).join(' ')},...rows];
  return {dataset:{summaryKind:kind,...(extra.dataset||{})},classList:{contains:name=>(extra.classes||[]).includes(name)},
    __factorySummaryMeta:{headers,rows,count:{textContent:''},total:{textContent:''}},
    querySelectorAll(){return allRows;}};
}
const h=values=>values.map(textContent=>({textContent}));

const invoices=table(h(['الإجمالي','المدفوع','المتبقي']),[
  row(['100.00 ج.م','60.00 ج.م','40.00 ج.م']),
  row(['200.00 ج.م','30.00 ج.م','170.00 ج.م'],{display:'none'})
],'documents',{dataset:{documentKind:'sale'}});
update(invoices);
assert.equal(invoices.__factorySummaryMeta.count.textContent,'عدد البيانات: 1');
assert.match(invoices.__factorySummaryMeta.total.textContent,/الإجمالي: 100\.00 ج\.م/);
assert.match(invoices.__factorySummaryMeta.total.textContent,/المدفوع: 60\.00 ج\.م/);
assert.match(invoices.__factorySummaryMeta.total.textContent,/المتبقي: 40\.00 ج\.م/);
invoices.__factorySummaryMeta.rows[1].style.display='';
update(invoices);
assert.equal(invoices.__factorySummaryMeta.count.textContent,'عدد البيانات: 2');
assert.match(invoices.__factorySummaryMeta.total.textContent,/الإجمالي: 300\.00 ج\.م/);
assert.match(invoices.__factorySummaryMeta.total.textContent,/المدفوع: 90\.00 ج\.م/);
assert.match(invoices.__factorySummaryMeta.total.textContent,/المتبقي: 210\.00 ج\.م/);

const vouchers=table(h(['المرجع','المبلغ']),[row(['RC-1','35.00 ج.م']),row(['RC-2','20.00 ج.م'])],'vouchers');
update(vouchers);
assert.equal(vouchers.__factorySummaryMeta.count.textContent,'عدد البيانات: 2');
assert.match(vouchers.__factorySummaryMeta.total.textContent,/إجمالي المبلغ: 55\.00 ج\.م/);

const partners=table(h(['الاسم','الرصيد']),[row(['عميل موجب','150.00 ج.م']),row(['عميل سالب','-50.00 ج.م'])],'partners');
update(partners);
assert.match(partners.__factorySummaryMeta.total.textContent,/صافي الرصيد الظاهر \(الموجب مستحق للشركة والسالب مستحق للطرف\): 100\.00 ج\.م/);

const stock=table(h(['الصنف','تكلفة الوحدة','الكمية','قيمة المخزون']),[
  row(['قميص','25.00','10','250.00']),row(['بنطلون','50.00','4','200.00'])
],'stock');
update(stock);
assert.match(stock.__factorySummaryMeta.total.textContent,/قيمة المخزون: 450\.00 ج\.م/);
assert.doesNotMatch(stock.__factorySummaryMeta.total.textContent,/تكلفة الوحدة|الكمية/);

const mixedCurrency=table(h(['العملة','المبلغ']),[row(['EGP','100.00']),row(['USD','200.00'])]);
update(mixedCurrency);
assert.match(mixedCurrency.__factorySummaryMeta.total.textContent,/100\.00 EGP/);
assert.match(mixedCurrency.__factorySummaryMeta.total.textContent,/200\.00 USD/);
assert.doesNotMatch(mixedCurrency.__factorySummaryMeta.total.textContent,/300\.00/);

const cash=table(h(['التاريخ','الحساب','الرصيد']),[
  row(['2026-01-01','خزينة رئيسية','80.00 ج.م'],{dataset:{summaryAccountId:'1',summaryBalance:'80',summaryCurrency:'EGP'}}),
  row(['2026-01-02','خزينة رئيسية','80.00 ج.م'],{dataset:{summaryAccountId:'1',summaryBalance:'80',summaryCurrency:'EGP'}}),
  row(['2026-01-02','بنك','50.00 ج.م'],{dataset:{summaryAccountId:'2',summaryBalance:'50',summaryCurrency:'EGP'}})
],'cash-movements');
update(cash);
assert.match(cash.__factorySummaryMeta.total.textContent,/إجمالي الرصيد: 130\.00 ج\.م/);
assert.doesNotMatch(cash.__factorySummaryMeta.total.textContent,/مدين|دائن|210\.00/);

const cashMixed=table(h(['التاريخ','الحساب','الرصيد']),[
  row(['2026-01-01','خزينة','10.00 ج.م'],{dataset:{summaryAccountId:'1',summaryBalance:'10',summaryCurrency:'EGP'}}),
  row(['2026-01-01','دولار','20.00 USD'],{dataset:{summaryAccountId:'2',summaryBalance:'20',summaryCurrency:'USD'}})
],'cash-movements');
update(cashMixed);
assert.match(cashMixed.__factorySummaryMeta.total.textContent,/10\.00 ج\.م/);
assert.match(cashMixed.__factorySummaryMeta.total.textContent,/20\.00 USD/);
assert.doesNotMatch(cashMixed.__factorySummaryMeta.total.textContent,/30\.00/);

const journal=table(h(['إجمالي المدين','إجمالي الدائن']),[row(['125.00','125.00'])]);
update(journal);
assert.match(journal.__factorySummaryMeta.total.textContent,/إجمالي المدين: 125\.00/);
assert.match(journal.__factorySummaryMeta.total.textContent,/إجمالي الدائن: 125\.00/);

const searchFn=vm.runInNewContext(
  extract('function factorySearchApply(input){','\nfunction factoryFbar(')+'\nfactorySearchApply',
  {CUR:null,tab:'test',sessionStorage:{setItem(){}},ACT:null,
    factorySearchMatch:(text,query)=>String(text).includes(query),
    factoryUpdateTableSummary:table=>{table.__refreshed=(table.__refreshed||0)+1;},
    document:{querySelectorAll(selector){return selector==='table.l tr'?searchRows:selector==='table.l'?[searchTable]:[];}}}
);
const searchRows=[row(['keep this']),row(['hide this'])],searchTable={__refreshed:0};
searchFn({value:'keep',dataset:{searchScope:'test'}});
assert.equal(searchRows[0].style.display,'');
assert.equal(searchRows[1].style.display,'none');
assert.equal(searchTable.__refreshed,1,'search must refresh the visible-row summary');

console.log('PASS invoice totals: visible rows, total, paid and remaining update after search filtering');
console.log('PASS voucher and partner totals use only visible rows and signed balances');
console.log('PASS stock summary totals inventory value only, not unit costs or quantities');
console.log('PASS different currencies remain separate in generic and cash summaries');
console.log('PASS cash movement summary adds each account ending balance once and omits debit/credit');
console.log('PASS journal debit and credit totals remain available');
console.log('PASS global search refreshes the table summary');
