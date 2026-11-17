/* Isolated arithmetic regression tests for partner account statement periods.
 * Extracts the production functions without booting the app or connecting to Supabase.
 * No persistence, network calls, or real company data are used.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const app = fs.readFileSync(require('node:path').join(__dirname, '..', 'js', 'app.js'), 'utf8');
function extract(start, end) {
  const a = app.indexOf(start);
  const b = app.indexOf(end, a);
  assert(a >= 0 && b > a, 'production function boundary must exist: ' + start);
  return app.slice(a, b);
}
const period = vm.runInNewContext(
  extract('function partnerStatementPeriod(', '\nfunction stmtHtml(') + '\npartnerStatementPeriod',
  { Math, Number, String }
);
const sign = vm.runInNewContext(
  extract('function partnerStatementSign(', '\nfunction partnerStatementPeriod(') + '\npartnerStatementSign',
  { S: { partners: [
    { id: 1, c: 1, s: 0 },
    { id: 2, c: 0, s: 1 },
    { id: 3, c: 1, s: 1 }
  ] }, tab: 'cust' }
);

const rows = [
  { d: '2026-01-01', ts: 1, ref: 'A-1', delta: 100 },
  { d: '2026-02-01', ts: 2, ref: 'A-2', delta: -25 },
  { d: '2026-03-01', ts: 3, ref: 'A-3', delta: 40 },
  { d: '2026-04-01', ts: 4, ref: 'A-4', delta: -10 }
];
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

assert.equal(sign(1), 1, 'customer-only party keeps customer sign');
assert.equal(sign(2), -1, 'supplier-only party uses supplier sign');
console.log('PASS partner statement period arithmetic: opening, inclusive range, running, totals, closing, empty period');
console.log('PASS partner statement customer/supplier sign conventions');
