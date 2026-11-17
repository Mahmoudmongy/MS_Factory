/* Regression tests for table summary totals: currency separation and cash movement rules. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'..','js','app.js'),'utf8');
const start=app.indexOf('const factoryUpdateTableSummary = function(table){');
const end=app.indexOf('const factoryEnhBeforeSummary=enh;',start);
assert(start>=0&&end>start,'table summary production function must exist');
const update=vm.runInNewContext(app.slice(start,end)+'\nfactoryUpdateTableSummary',{LANGEN:false,f:n=>Number(n).toFixed(2),Map,Number,String,RegExp});
function row(values){return {style:{display:''},textContent:values.join(' '),children:values.map(textContent=>({textContent})),querySelector(selector){return selector==='td'?{}:null;}};}
function table(headers,rows,cash=false){
 const allRows=[{textContent:headers.map(x=>x.textContent).join(' ')},...rows];
 return {__factorySummaryMeta:{headers,rows,count:{textContent:''},total:{textContent:''}},closest(selector){return cash&&selector==='.factory-cash-movements'?{}:null;},querySelectorAll(){return allRows;}};
}
const mixed=table([{textContent:'العملة'},{textContent:'المبلغ'}],[row(['EGP','100.00 EGP']),row(['USD','200.00 USD'])]);
update(mixed);
assert.equal(mixed.__factorySummaryMeta.count.textContent,'عدد البيانات: 2');
assert.match(mixed.__factorySummaryMeta.total.textContent,/100\.00 EGP/);
assert.match(mixed.__factorySummaryMeta.total.textContent,/200\.00 USD/);
assert.doesNotMatch(mixed.__factorySummaryMeta.total.textContent,/300\.00/);
const cash=table([{textContent:'مدين'},{textContent:'دائن'},{textContent:'الرصيد'}],[row(['100.00 EGP','—','100.00 EGP']),row(['—','20.00 EGP','80.00 EGP'])],true);
update(cash);
assert.match(cash.__factorySummaryMeta.total.textContent,/إجمالي الرصيد: 180\.00 EGP/);
assert.doesNotMatch(cash.__factorySummaryMeta.total.textContent,/مدين|دائن/);
const multiCash=table([{textContent:'الرصيد'}],[row(['100.00 USD']),row(['50.00 EGP'])],true);
update(multiCash);
assert.match(multiCash.__factorySummaryMeta.total.textContent,/50\.00 EGP/);
assert.match(multiCash.__factorySummaryMeta.total.textContent,/100\.00 USD/);
console.log('PASS table summary keeps different currencies separate');
console.log('PASS cash movement summary shows balance only and keeps currencies separate');
