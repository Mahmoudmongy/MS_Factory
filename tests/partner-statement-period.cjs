/* Isolated arithmetic and PDF-content regressions for partner statements.
 * Production functions are extracted from js/app.js; no Supabase, network, or writes.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
function extract(start, end) {
  const a = app.indexOf(start), b = app.indexOf(end, a);
  assert(a >= 0 && b > a, 'production function boundary must exist: ' + start);
  return app.slice(a, b);
}
const statementApi = vm.runInNewContext(
  extract('function partnerStatementValidPeriod(', '\nfunction stmtHtml(') +
    '\n({ partnerStatementValidPeriod, partnerStatementPeriod })',
  { Math, Number, String, Date, RangeError }
);
const pdfLabel = vm.runInNewContext(
  extract('function partnerStatementPdfPartyLabel(', '\\nfunction partnerStatementValidPeriod(') + '\\npartnerStatementPdfPartyLabel',
  { pn: id => id === 7 ? 'عميل الاختبار' : 'مورد الاختبار' }
);
assert.equal(pdfLabel(7, '2026-02-01', '2026-03-31'), 'كشف_حساب_عميل الاختبار_2026-02-01_2026-03-31');
assert.equal(pdfLabel(8, '', ''), 'كشف_حساب_مورد الاختبار_البداية_آخر_حركة');
const sign = vm.runInNewContext(
  extract('function partnerStatementSign(', '\nfunction partnerStatementValidPeriod(') + '\npartnerStatementSign',
  { S: { partners: [{ id: 1, c: 1, s: 0 }, { id: 2, c: 0, s: 1 }, { id: 3, c: 1, s: 1 }] }, tab: 'cust' }
);
const rows = [
  { d: '2026-01-01', ts: 1, ref: 'A-1', delta: 100 },
  { d: '2026-02-01', ts: 2, ref: 'A-2', delta: -25 },
  { d: '2026-03-01', ts: 3, ref: 'A-3', delta: 40 },
  { d: '2026-04-01', ts: 4, ref: 'A-4', delta: -10 }
];
const { partnerStatementValidPeriod: valid, partnerStatementPeriod: period } = statementApi;
assert.equal(valid('2026-02-01', '2026-03-31'), true);
assert.equal(valid('', '2026-03-31'), true);
assert.equal(valid('2026-03-31', '2026-02-01'), false, 'reversed ranges must be rejected');
assert.equal(valid('2026-02-30', '2026-03-31'), false, 'impossible calendar dates must be rejected');
assert.equal(valid('2026/02/01', '2026-03-31'), false, 'date inputs must use ISO local-date values');

const customer = period(rows, '2026-02-01', '2026-03-31', 1);
assert.equal(customer.opening, 100);
assert.deepEqual(customer.rows.map(x => [x.ref, x.runningBalance]), [['A-2', 75], ['A-3', 115]]);
assert.equal(customer.movementTotal, 15);
assert.equal(customer.dueFromParty, 40);
assert.equal(customer.dueToParty, 25);
assert.equal(customer.closing, 115);
const supplier = period(rows, '2026-02-01', '2026-03-31', -1);
assert.equal(supplier.opening, -100);
assert.deepEqual(supplier.rows.map(x => [x.ref, x.runningBalance]), [['A-2', -75], ['A-3', -115]]);
assert.equal(supplier.movementTotal, -15);
assert.equal(supplier.dueFromParty, 25);
assert.equal(supplier.dueToParty, 40);
assert.equal(supplier.closing, -115);
const throughDate = period(rows, '', '2026-03-01', 1);
assert.equal(throughDate.opening, 0);
assert.deepEqual(throughDate.rows.map(x => x.ref), ['A-1', 'A-2', 'A-3']);
assert.equal(throughDate.closing, 115);
const afterLast = period(rows, '2026-05-01', '2026-05-31', 1);
assert.equal(afterLast.opening, 105);
assert.equal(afterLast.rows.length, 0);
assert.equal(afterLast.closing, 105);
assert.throws(() => period(rows, '2026-04-01', '2026-03-01', 1), /تاريخ البداية/);
assert.equal(sign(1), 1, 'customer-only party keeps customer sign');
assert.equal(sign(2), -1, 'supplier-only party uses supplier sign');

const stmtHtml = vm.runInNewContext(
  extract('function stmtHtml(', '\nfunction sampleHtml(') + '\nstmtHtml',
  {
    partnerStatementPeriod: period,
    partnerStatementRows: () => rows,
    partnerStatementSign: () => 1,
    pn: () => 'شركة الاختبار',
    dfm: value => value,
    factoryEsc: value => String(value ?? ''),
    f: value => Number(value).toFixed(2),
    pw: (kind, title, no, body) => ({ kind, title, no, body })
  }
);
const pdf = stmtHtml(1, '2026-02-01', '2026-03-31');
assert.equal(pdf.kind, 'stmt');
assert.equal(pdf.title, 'كشف حساب');
assert.equal(pdf.no, 'شركة الاختبار');
assert.match(pdf.body, /الفترة: من 2026-02-01 إلى 2026-03-31/);
assert.match(pdf.body, /رصيد بداية الفترة/);
assert.match(pdf.body, /رصيد بداية الفترة/);
assert.match(pdf.body, /100\.00/);
assert.match(pdf.body, /A-2/);
assert.match(pdf.body, /A-3/);
assert.match(pdf.body, /115\.00/);
assert.match(pdf.body, /إجمالي المستحق من الطرف: 40\.00 ج\.م/);
assert.match(pdf.body, /إجمالي المستحق للطرف: 25\.00 ج\.م/);
assert.match(pdf.body, /الرصيد الختامي/);
const periodUiSource = extract('function factoryPartnerStatementKey(', '\nfunction factoryDrillPartner(');
const stored = new Map();
const statementCalls = [], uiMessages = [];
const fields = { '#partner-statement-from': { value: '2026-02-01' }, '#partner-statement-to': { value: '2026-03-31' } };
const periodUi = vm.runInNewContext(periodUiSource + '\n({ factoryPartnerStatementKey, factoryPartnerStatementSaved, rememberPartnerStatementPeriod, applyPartnerStatementPeriod, clearPartnerStatementPeriod })', {
  sessionStorage: { getItem: key => stored.has(key) ? stored.get(key) : null, setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) },
  $: selector => fields[selector] || null,
  partnerStatementValidPeriod: valid,
  toast: message => uiMessages.push(message),
  factoryDrillPartner: (...args) => statementCalls.push(args)
});
assert.equal(periodUi.rememberPartnerStatementPeriod(7), true);
assert.deepEqual(JSON.parse(stored.get('factory-partner-statement-period:7')), { from: '2026-02-01', to: '2026-03-31' });
fields['#partner-statement-from'].value = '2026-04-01';
fields['#partner-statement-to'].value = '2026-03-31';
assert.equal(periodUi.rememberPartnerStatementPeriod(7), false, 'invalid range must not overwrite the last applied period');
assert.deepEqual(JSON.parse(stored.get('factory-partner-statement-period:7')), { from: '2026-02-01', to: '2026-03-31' });
fields['#partner-statement-from'].value = '2026-02-01';
fields['#partner-statement-to'].value = '2026-03-31';
periodUi.applyPartnerStatementPeriod(7);
assert.deepEqual(statementCalls.pop(), [7, '2026-02-01', '2026-03-31']);
periodUi.clearPartnerStatementPeriod(7);
assert.equal(stored.has('factory-partner-statement-period:7'), false);
assert.deepEqual(statementCalls.pop(), [7, '', '']);

(async () => {
  const shareSource = extract('async function sharePdf(){', '\n/* ---- Excel / CSV import wizard ---- */');
  const makeFile = class { constructor(parts, name, options) { this.parts = parts; this.name = name; this.type = options.type; } };
  const pdfStub = { output: type => ({ type, bytes: 'synthetic-pdf' }) };
  const shareCalls = [], downloads = [], messages = [];
  const nativeShare = vm.runInNewContext(shareSource + '\nsharePdf', {
    toast: message => messages.push(message),
    mkPdf: async () => pdfStub,
    File: makeFile,
    navigator: { share: async payload => shareCalls.push(payload), canShare: () => true },
    pdfName: () => 'statement-test.pdf',
    saveFile: async (...args) => downloads.push(args)
  });
  await nativeShare();
  assert.equal(shareCalls.length, 1);
  assert.equal(shareCalls[0].files[0].name, 'statement-test.pdf');
  assert.equal(shareCalls[0].files[0].type, 'application/pdf');
  assert.equal(Object.prototype.hasOwnProperty.call(shareCalls[0], 'recipients'), false, 'sharing must not select or message a recipient automatically');

  const fallbackShare = vm.runInNewContext(shareSource + '\nsharePdf', {
    toast: message => messages.push(message),
    mkPdf: async () => pdfStub,
    File: makeFile,
    navigator: {},
    pdfName: () => 'statement-test.pdf',
    saveFile: async (...args) => downloads.push(args)
  });
  await fallbackShare();
  assert.equal(downloads.length, 1, 'unsupported system share must download the PDF as fallback');
  assert.equal(downloads[0][0], 'statement-test.pdf');
  assert.equal(downloads[0][1].type, 'blob');
  console.log('PASS partner statement period arithmetic: opening, inclusive dates, running, movement totals and closing');
  console.log('PASS partner statement date validation: reversed, invalid calendar and ISO local dates');
  console.log('PASS partner statement period persists only after apply and clears explicitly');
  console.log('PASS partner statement customer/supplier sign conventions');
  console.log('PASS statement PDF HTML uses the same selected period, opening, movements, totals and closing');
  console.log('PASS statement PDF sharing uses native share when supported and download fallback otherwise');
})().catch(error => { console.error(error); process.exitCode = 1; });
