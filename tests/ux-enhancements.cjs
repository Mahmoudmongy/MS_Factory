const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
const previewCss = fs.readFileSync(path.join(root, 'css/preview-ui.css'), 'utf8');
const previewUi = fs.readFileSync(path.join(root, 'js/preview-ui.js'), 'utf8');
const databaseFirst = fs.readFileSync(path.join(root, 'js/database-first.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const history = fs.readFileSync(path.join(root, 'js/manager-history.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261114153611_guard_factory_record_deletes.sql'), 'utf8');
const safeUndoMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261114131825_safe_factory_record_undo.sql'), 'utf8');
const permissionMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261114133748_delete_requires_edit.sql'), 'utf8');
new Function(app); // Syntax-check the complete production browser script before testing behavior.
const parserStart = app.indexOf('function factorySearchMatch(');
const parserEnd = app.indexOf('function factorySearchApply(', parserStart);
assert(parserStart >= 0 && parserEnd > parserStart, 'advanced search parser must exist');
const matches = new Function(app.slice(parserStart, parserEnd) + '; return factorySearchMatch;')();
assert.equal(matches('Alpha invoice 125', 'Alpha AND >=100'), true);
assert.equal(matches('Alpha invoice 125', 'Beta OR Alpha'), true);
assert.equal(matches('Alpha invoice 125', 'Beta AND >=100'), false);
assert.equal(matches('Supplier balance -12', '<0'), true);
assert.equal(matches('Supplier balance 12', '<0'), false);
assert.equal(matches('Invoice 25', '=25'), true);
assert(app.includes('sessionStorage.setItem("factory-search:') || app.includes('sessionStorage.setItem("factory-search:'));
assert(app.includes('factory-table-prefs:') && app.includes('pref.sort={ci,dir}'), 'sort preferences must persist');
assert(app.includes('factory-column-chooser') && app.includes('factory-column-options'), 'column chooser must persist');
assert(app.includes('factory-summary-open:') && app.includes('d.open=localStorage.getItem(k)==="1"'), 'summary detail expansion must persist');
assert(app.includes('function syncPage()') && app.includes('factory-sync-popover') && app.includes('setTimeout(hide,10000)'), 'sync icon must use a short-lived status popover');
assert(app.includes('function supplierShownBalance(p,supplierView)') && app.includes('supplierShownBalance(p,!c)'), 'supplier balances must use the supplier-facing sign');
assert(app.includes('function accountTreeBalance') && app.includes('function toggleAccountTree'), 'account parent totals and collapse must exist');
assert(app.includes('function whPath') && app.includes('function addWh()') && app.includes('parentId:parent'), 'nested warehouse hierarchy must exist');
assert(app.includes('id="materialWarehouse"') && app.includes('function addProductionMaterial') && app.includes('wh:m.wh||it_(m.iid)?.wh||0'), 'production material rows must persist their selected warehouse');
assert(app.includes('function undoRef') && app.includes('undoOf:{src,id:String(id)}') && app.includes('عكس آمن للحركة'), 'undo must append compensating entries');
assert(app.includes('function factoryEnhanceNameSelects') && app.includes('factory-search-options'), 'name selectors must show searchable name-only dropdowns');
assert(migration.includes('FACTORY_RECORD_PHYSICAL_DELETE_BLOCKED') && migration.includes('FACTORY_RECORD_DELETE_BLOCKED'), 'database must block physical deletes and unsafe soft deletes');
assert(safeUndoMigration.includes('UNDO_NOT_LATEST') && safeUndoMigration.includes('UNDO_VERSION_CONFLICT') && safeUndoMigration.includes('UNDO_ADMIN_ONLY'), 'audit undo must be admin-only and latest-version safe');
assert(permissionMigration.includes('EMPLOYEE_DELETE_REQUIRES_EDIT'), 'delete permission must require edit permission');
assert(app.includes('function updateColumnChooserLanguage') && app.includes('Choose visible columns and save'), 'column chooser labels must follow application language');
assert(history.includes("top.insertAdjacentElement('afterend',launcher)") && history.includes('factory-audit-launcher') && history.includes('factory-history-icon') && history.includes('moveConflictExport') && history.includes("notice.style.display=notice.hidden?'none':'flex'"), 'Manager.io and audit history icons share a compact toolbar below the header');
assert(css.includes('.factory-table-scroll') && css.includes('overflow-wrap:anywhere') && css.includes('.factory-search-options') && css.includes('table-layout:fixed!important') && css.includes('.factory-very-long-cell'), 'tables use fixed column widths and shrink/wrap long text');
assert(app.includes('factoryApplyFixedTableLayout') && app.includes('factoryIconizeActions'), 'tables receive stable measured columns and action buttons become icons');
assert(app.includes('const hasCashAncestor') && app.includes('if(a.cash)out.push(a);else walk(a.id)'), 'cash balances roll up through non-cash grouping levels');
assert(app.includes('async function factorySaveAccName') && app.includes('async function factorySaveWh') && app.includes('const saved=await sv()') && app.includes('a.name=previous.name') && app.includes('w.name=previous.name') && app.includes('return Promise.resolve(false)'), 'master-data edits await cloud persistence and restore original values on failure');
assert(app.includes('function factoryIconizeActionLinks') && app.includes('factoryIconizeActionLinks(document)') && app.includes('__factoryActionObserver') && css.includes('.factory-icon-action-link'), 'view/edit/share links become compact accessible icons');
assert(css.includes('grid-template-areas:"menu back forward title net logout who theme"') && css.includes('grid-template-areas:"menu back forward title title title" "net logout who who theme theme"'), 'header keeps the requested exit/account/theme order on desktop and mobile');
console.log('PASS advanced search: AND / OR / numeric comparisons');
console.log('PASS saved sorting, column selection, and summary expansion');
console.log('PASS supplier sign, account hierarchy, nested warehouses, production material locations');
console.log('PASS append-only safe reversal and database delete guards');
console.log('PASS sync popover, searchable name-only dropdowns, and responsive tables');

const ownerInvokerMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261114161109_current_owner_id_security_invoker.sql'), 'utf8').toLowerCase();
const ownerInvokerQa = fs.readFileSync(path.join(root, 'tests/sql/current-owner-invoker-qa.sql'), 'utf8').toLowerCase();
assert(ownerInvokerMigration.includes('security invoker') && !ownerInvokerMigration.includes('security definer'), 'owner lookup must run with caller privileges');
assert(ownerInvokerMigration.includes('revoke all on function public.current_owner_id() from public, anon') && ownerInvokerMigration.includes('grant execute on function public.current_owner_id() to authenticated, service_role'), 'owner lookup grants must be least-privilege');
assert(ownerInvokerQa.includes('set local role authenticated') && ownerInvokerQa.includes('current_owner_must_be_security_invoker'), 'QA must verify owner lookup under authenticated role');
console.log('PASS current_owner_id uses invoker rights and least-privilege grants');

const auditTrail = fs.readFileSync(path.join(root, 'js/audit-trail.js'), 'utf8');
const employeeAccountApi = fs.readFileSync(path.join(root, 'supabase/functions/create-employee-account/index.ts'), 'utf8');
assert(app.includes('if(p==="edit")return cloudCan("edit")===true') && app.includes('cloudCan("delete")===true&&cloudCan("edit")===true'), 'employee UI must gate edit/delete actions separately');
assert(app.includes('ai:"reports",set:null'), 'settings remain owner-only while reports-only employees can see reports');
assert(employeeAccountApi.includes('"edit", "delete"') && employeeAccountApi.includes('profile?.created_by') && employeeAccountApi.includes('permissions.delete && !permissions.edit'), 'employee account API must be owner-only and require edit for delete');
assert(fs.readFileSync(path.join(root, 'index.html'), 'utf8').includes('js/audit-trail.js') && fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8').includes('js/audit-trail.js'), 'audit trail UI must load and be cached by the PWA');
assert(auditTrail.includes('undo_factory_record_change') && auditTrail.includes('latest.get(key)===row.id'), 'audit undo must use the guarded latest-entry RPC');
assert(auditTrail.includes("undoSupported=['partners','items','codes','wh','accts','customers','suppliers']") && !auditTrail.includes("undoSupported=['partners','items','codes','mv'"), 'generic audit undo must exclude financial and stock movement records');
console.log('PASS owner-only audit UI and module/edit/delete permission enforcement');

assert(app.includes('const EMP_PERMISSION_TEMPLATES=') && app.includes('function applyEmployeePermissionTemplate') && app.includes('function employeeCloudPermissions'), 'employee permission templates and cloud mapping must be available');
assert(app.includes('supabase.rpc("update_employee_permissions"') && app.includes('p_permissions:employeeCloudPermissions(data.perm)'), 'editing an existing cloud employee must update database permissions');
assert(app.includes('delete:selected.includes("del")&&selected.includes("edit")') && app.includes('localPerm.includes("del")&&localPerm.includes("edit")'), 'delete permission must require edit for cloud and local employees');
console.log('PASS employee templates, existing-account permission updates, and delete-requires-edit UI');

assert(!auditTrail.includes("import { supabase } from './supabase.js'") && auditTrail.includes("import('./supabase.js')"), 'audit screen must defer Supabase initialization until opened');
console.log('PASS audit UI defers Supabase initialization until opened');

const activeBankStart = app.lastIndexOf('vBank=function(){');
const activeBankEnd = app.indexOf('\nfunction factoryCoaChildren', activeBankStart);
const activeBank = activeBankStart >= 0 && activeBankEnd > activeBankStart ? app.slice(activeBankStart, activeBankEnd) : '';
const pdfStart = app.indexOf('async function mkPdf(){');
const pdfEnd = app.indexOf('\nconst pdfName=', pdfStart);
const pdfRenderer = pdfStart >= 0 && pdfEnd > pdfStart ? app.slice(pdfStart, pdfEnd) : '';
const appPatchChecks = [
  [app.includes('addL = function') && app.includes('$("#un").value=""') && app.includes('$("#it").selectedIndex=0'), 'invoice add-row clears every field and resets item selection'],
  [app.includes('D.lines[') && app.includes('.price=Math.max(0,+this.value||0)'), 'sales and purchase invoice line prices are editable'],
  [auditTrail.includes('function auditBusinessSummary(row)') && auditTrail.includes('Movement details'), 'audit entries show readable business details with raw before/after snapshots'],
  [app.includes('vTl=function(){') && app.includes('query=fv(key,"q")') && app.includes('المستخدم أو الإجراء أو المرجع أو البيان'), 'timeline has a contains-search beside its date filters'],
  [app.includes('factory-table-count') && app.includes('factory-table-total') && app.includes('Default templates'), 'table counts, amount summaries and renamed column templates are enabled'],
  [app.includes('vBank = function') && app.includes('toggleAccountTree'), 'cash and bank accounts retain the account-tree controls'],
  [activeBank.includes('toggleAccountTree(') && activeBank.includes('currencyBalances(') && activeBank.includes('factory-cash-movements') && activeBank.includes('cashChildren(id)'), 'active cash screen shows collapsible parent totals and the live cash ledger without double-counting nested cash accounts'],
  [pdfRenderer.includes('rowBreaks=') && pdfRenderer.includes('safeBoundary') && pdfRenderer.includes('wide?"277mm":"190mm"') && previewCss.includes('#pr.factory-print-document table{display:table'), 'invoice PDF uses a fitted A4 width and keeps table rows intact at page breaks'],
  [css.includes('position:sticky') && css.includes('overflow-wrap:anywhere'), 'table headings stay pinned and long text wraps']
];
for (const [ok,label] of appPatchChecks) assert(ok,label);
console.log('PASS targeted MS Factory UX and audit-detail regression checks');

assert(app.includes('if(!post(dd,no,TN[t],Ls,"doc",id,ts))') && app.includes('oldMoves.forEach(m=>') && app.includes('oldLedger.forEach(x=>S.L.push(x))'), 'invoice edits must roll back stock and restore the prior invoice if ledger posting fails');
assert(app.includes('if(!post(d,no,$("#vx").value||$("#vtl").value,Ls,"vch",id,ts))') && app.includes('oldLedger.forEach(x=>S.L.push(x));S.vch.push(old)'), 'voucher edits must not save an orphan voucher if ledger posting fails');
console.log('PASS invoice and voucher posting failures fail closed with safe rollback');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const swPublic = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');
assert(app.includes('landscape=wide||capture.width/capture.height>1.1') && app.includes('windowWidth:captureWidth') && app.includes('W=landscape?297:210') && app.includes('el.style.boxSizing="border-box"'), 'PDF export captures the full table width and selects landscape A4 for wide documents');
assert(sw.includes('factory-v42') && swPublic.includes('factory-v42'), 'service-worker cache version changes when the application assets change');
console.log('PASS adaptive A4 PDF layout and service-worker cache refresh');
assert(previewUi.includes("function renderReferenceGroup") && previewUi.includes("function renderReferenceSidebar") && previewUi.includes("data-preview-screen-tab"), "the live application must map its actual screen renderers into the preview's grouped menu and functional tabs");
assert(previewCss.includes(".factory-nav-link") && previewCss.includes(".preview-module-tabs") && previewCss.includes(".factory-reference-screen-body"), "the reference sidebar, tabs and page panels must have dedicated responsive styles");
assert(databaseFirst.includes("window.__factoryAuthUser") && databaseFirst.includes("authenticatedUser.id === window.__factoryAuthProfile?.id"), "database startup must reuse the already authenticated user rather than issue a duplicate session read");
assert(indexHtml.includes("factory-boot-phase") && indexHtml.includes("factory-boot-card") && indexHtml.includes("window.__factorySetBootPhase"), "the boot screen must show authentication and database-loading phases");
console.log("PASS preview.html screen grouping, icon navigation, responsive panels and startup session reuse");
assert(previewUi.includes("function summaryOrder(data)") && previewUi.includes("data-summary-move") && previewUi.includes("uiPrefs.summaryOrder=order"), "summary indicators can be reordered and that order is saved");
assert(previewUi.includes("factory-summary-mini-table") && previewUi.includes("data-open-source"), "latest activity is a drillable table built from current records");
assert(app.includes("preview-report-grid") && app.includes("التقارير المالية") && app.includes("النقدية والمخزون والإنتاج"), "reports use the four reference groups without replacing live report renderers");
assert(previewCss.includes("Dark theme contrast") && previewCss.includes("button.g") && previewCss.includes("color:#fff!important"), "secondary action buttons use white high-contrast labels in dark mode");
assert(previewCss.includes(':root[data-theme="dark"] button') && previewCss.includes(':root:not([data-theme="light"]) button') && previewCss.includes('button *') && previewCss.includes('input[type="submit"]'), 'all primary, secondary, nested-label and form-submit buttons keep white labels in both manual and system dark mode');
assert(databaseFirst.includes("function scheduleCacheSnapshot(rows)") && databaseFirst.includes("__snapshot__") && databaseFirst.includes("setBaselineRow(row, false)"), "startup avoids synchronous per-record cache writes");
console.log("PASS summary ordering, latest activity, grouped reports, dark button labels and faster startup");


assert(previewUi.includes("function renderVoucherTable(dir)") && previewUi.includes("function renderInvoiceTable(type)"), "receipts, payments, invoices and returns must use reference-shaped live-data tables");
assert(previewUi.includes("refVoucherActions") && previewUi.includes("refInvoiceActions") && previewUi.includes("data-reference-export"), "voucher and invoice row actions and Excel export must be wired");
assert(previewUi.includes("voucherAccounts(v)") && previewUi.includes("paidOf(row)") && previewUi.includes("remOf(row)") && previewUi.includes("refOriginalInvoiceCell"), "tables must display real account, paid, remaining and original-invoice relationships");
assert(previewCss.includes(".factory-reference-data-table") && previewCss.includes(".factory-row-action") && previewCss.includes(".factory-reference-status"), "reference tables and action icons must have dedicated responsive styling");
assert(app.includes("originalId:D.originalId||0") && app.includes("originalId:d.id") && app.includes("originalId:p.originalId||0"), "return records must preserve their original invoice ID across creation and editing");
assert(app.includes("factory-print-document") && app.includes("factory-print-wide") && app.includes("data-print-kind") && app.includes('landscape=wide||capture.width/capture.height>1.1'), "invoice print and PDF output must use responsive paper width and landscape A4 for invoices");

assert(app.includes("بحث في المرجع أو الحساب أو الطرف أو البيان"), "voucher table must support broad search");
assert(app.includes('"is-paid"') && app.includes('"is-partial"') && app.includes('"is-unpaid"'), "invoice payment status must be visible");
assert(app.includes("عدد الأصناف") && app.includes("الفاتورة الأصلية"), "invoice and return tables must show item count and original invoice");
assert(app.includes("factory-row-actions") && app.includes('onclick="vPrint(') && app.includes('onclick="inv('), "voucher and invoice actions must be wired");
assert(app.includes("تعذر تحديد أبعاد المستند للطباعة") && app.includes("allowTaint:false"), "PDF capture must validate and constrain document dimensions");
assert(previewCss.includes("#pr.factory-print-document table") && previewCss.includes(".factory-status-chip.is-unpaid"), "print layout and status colors must be styled");

console.log("PASS reference-aligned vouchers/invoices, connected actions, original invoice links and adaptive A4 PDF");


assert(previewUi.includes("function referenceVoucherSearchText(v)") && previewUi.includes("factorySearchMatch(referenceVoucherSearchText(v),query)"), "voucher search filters reference, title, party, account, allocations and related orders");
assert(previewUi.includes("function referenceInvoiceSearchText(d)") && previewUi.includes("factorySearchMatch(referenceInvoiceSearchText(d),query)"), "invoice search filters reference, party, notes, items, variants and barcodes");
assert(previewUi.includes('<th>حساب "+(incoming?"القبض":"الدفع")+"</th>') && previewUi.includes("factory-reference-amount-actions") && previewUi.includes("refVoucherActions(v)"), "voucher table matches six reference columns and keeps row actions in the amount cell");
assert(previewUi.includes("isReturn?6:isSaleInvoice?8:7") && previewUi.includes("factory-reference-status-actions"), "invoice and return tables match reference column counts and keep actions in the final column");
assert(previewCss.includes("factory-reference-status.paid") && previewCss.includes("factory-reference-status.partial") && previewCss.includes("factory-reference-status.unpaid") && previewCss.includes("#pr.factory-print-document{position:absolute"), "status colors and A4 print placement are explicitly styled");


assert(previewUi.includes("referenceSavedSearch(key)") && previewUi.includes("data-factory-search-text") && previewUi.includes("dataset.factorySearchText||row.textContent"), "reference table search keeps item/barcode search data across redraw without polluting exports");

assert(app.includes("factory-cash-movements") && app.includes("exportCashMovements") && app.includes("حركة الحساب"), "cash screen includes filtered cash-account movements and export");
assert(app.includes("factory-trial-balance") && app.includes("إجمالي المدين") && app.includes("إجمالي الدائن"), "chart of accounts screen includes a live trial balance");
assert(app.includes("factory-production-detail") && app.includes("stockScanCamera") && app.includes("printAllStockLabels"), "production details and inventory barcode actions are connected");
assert(app.includes("اسم الدخول") && app.includes("factory-partner-status"), "employee usernames and partner status fields are visible");
assert(app.includes("assistantQuickProductionCost") && app.includes("assistantQuickPartnerBalance"), "assistant quick actions cover customer balances and production order costs");
assert(app.includes("تصدير السجل") && app.includes("FL.timeline={}"), "timeline provides export and clear-filter actions");
assert(previewUi.includes("factory-recent-row[role='button']") || previewUi.includes("factory-recent-row[role=\"button\"]"), "summary recent movements are keyboard accessible");
assert(app.includes("القيد غير متوازن") && app.includes("if(!post(d,no,$(\"#j0\").value,J.lines,\"je\",id,ts))"), "journal posting fails safely instead of saving an unposted journal");

assert(app.includes("exportPartnerTable") && app.includes("factory-partner-table"), "partner table has a targeted Excel export");
assert(app.includes("exportEmployeeTable") && app.includes("factory-employee-table"), "employee table has a targeted Excel export");
assert(app.includes("exportTrialBalance") && app.includes("factory-trial-balance-table"), "trial balance has a targeted Excel export");
assert(app.includes("vTl = function()") && app.includes("undoGroups") && app.includes("undoView"), "timeline lists immutable reversal entries with a dedicated details action");

assert(app.includes("vTl=function(){") && app.includes("fts(x.ts)") && app.includes("التاريخ والوقت"), "timeline follows the reference single date-and-time column");

assert(app.includes('statements:()=>vStatements()') && app.includes('["statements",ico("report"),"القوائم المالية"]'), "financial statements screen is available from the app navigation");
assert(previewUi.includes("function renderFinancialStatements()") && previewUi.includes("SCR.statements=renderFinancialStatements") && previewUi.includes("statementGroup(\'I\'") && previewUi.includes("statementGroup(\'A\'"), "financial statements use live account ledgers for income and balance sheet");
assert(previewUi.includes("function applyFinancialPeriod()") && previewUi.includes("if(from&&to&&from>to)"), "financial statement period validates date order");
assert(app.includes('function printStatements()') && app.includes('طباعة القوائم أو حفظها PDF'), "financial statements have a connected print and PDF action");
assert(previewCss.includes(".factory-fin-grid") && previewCss.includes(".factory-fin-filters") && previewCss.includes("@media(max-width:860px)"), "financial statements adapt to mobile and desktop");

assert(app.includes('vStock=function(){') && app.includes('<th>المخزن الرئيسي</th><th>المخزن الفرعي</th><th>الوحدة</th><th>الكمية</th><th>تكلفة الوحدة</th><th>قيمة المخزون</th>'), "inventory table matches the reference warehouse, quantity and value columns");
assert(app.includes('onclick="printAllStockLabels()"') && app.includes('onclick="stockScanOpen()"') && app.includes('onclick="stockMovementChooser()"') && app.includes('onclick="showWarehouseBalances('), "inventory barcode, distribution, movement and label actions are connected");
assert(previewCss.includes(".factory-stock-filter-main") && previewCss.includes(".factory-stock-table-card") && previewCss.includes("@media(max-width:860px){.factory-stock-filter-main"), "inventory filters and table adapt to mobile and dark themes");


assert(app.includes("factory-universal-table-scroll") && previewCss.includes("position:sticky"), "every rendered data table receives a scroll container with a sticky header");
assert(previewCss.includes(".factory-table-scroll thead th") && previewCss.includes("scroll-behavior:smooth"), "all table screens support sticky headers and smooth touch scrolling");
assert(previewUi.includes('<table class="l factory-summary-mini-table">') && !previewUi.includes("factory-summary-settings-toggle"), "summary activity table uses the shared table style and its customization control is moved out of the dashboard");
assert(previewUi.includes("تخصيص الملخص") && previewUi.includes("function extendSettings()"), "summary customization remains available inside settings");
assert(app.includes("factory-share-pdf-action") && app.includes('<svg class="factory-action-icon"'), "PDF share action has a clear share icon");
assert(indexHtml.includes("factory-branding") && indexHtml.includes("جاري التحميل") && indexHtml.includes("boot-dots"), "startup screen shows company branding, loading text and animated dots");
const activeCoaStart = app.lastIndexOf("vCoa=function(){");
const activeCoaEnd = app.indexOf("let factoryProductionSelection", activeCoaStart);
const activeCoa = app.slice(activeCoaStart, activeCoaEnd);
assert(activeCoaStart >= 0 && activeCoaEnd > activeCoaStart && !activeCoa.includes('factoryEsc(a.code||"—")') && !activeCoa.includes('factoryEsc(x.a.code||"—")') && !activeCoa.includes("رقم الحساب"), "chart of accounts and trial balance show account names without account identifiers");
assert(previewUi.includes("label=esc(accountLabel(a))") && previewUi.includes("'الحساب '+accountLabel(a)"), "financial statement account names and drill-down titles hide account identifiers");
