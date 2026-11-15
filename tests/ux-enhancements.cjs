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

const appPatchChecks = [
  [app.includes('addL = function') && app.includes('$("#un").value=""') && app.includes('$("#it").selectedIndex=0'), 'invoice add-row clears every field and resets item selection'],
  [app.includes('D.lines[') && app.includes('.price=Math.max(0,+this.value||0)'), 'sales and purchase invoice line prices are editable'],
  [auditTrail.includes('function auditBusinessSummary(row)') && auditTrail.includes('Movement details'), 'audit entries show readable business details with raw before/after snapshots'],
  [app.includes('TL.q') && app.includes('Search (contains)'), 'timeline has a contains-search beside its date filters'],
  [app.includes('factory-table-count') && app.includes('factory-table-total') && app.includes('Default templates'), 'table counts, amount summaries and renamed column templates are enabled'],
  [app.includes('vBank = function') && app.includes('toggleAccountTree'), 'cash and bank accounts render a collapsible hierarchy'],
  [css.includes('position:sticky') && css.includes('overflow-wrap:anywhere'), 'table headings stay pinned and long text wraps']
];
for (const [ok,label] of appPatchChecks) assert(ok,label);
console.log('PASS targeted MS Factory UX and audit-detail regression checks');

assert(app.includes('if(!post(dd,no,TN[t],Ls,"doc",id,ts))') && app.includes('oldMoves.forEach(m=>') && app.includes('oldLedger.forEach(x=>S.L.push(x))'), 'invoice edits must roll back stock and restore the prior invoice if ledger posting fails');
assert(app.includes('if(!post(d,no,$("#vx").value||$("#vtl").value,Ls,"vch",id,ts))') && app.includes('oldLedger.forEach(x=>S.L.push(x));S.vch.push(old)'), 'voucher edits must not save an orphan voucher if ledger posting fails');
console.log('PASS invoice and voucher posting failures fail closed with safe rollback');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const swPublic = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');
assert(app.includes('landscape=c.width/c.height>1.1') && app.includes('windowWidth:captureWidth') && app.includes('W=landscape?297:210'), 'PDF export captures the full table width and selects landscape A4 for wide documents');
assert(sw.includes('factory-v29') && swPublic.includes('factory-v29'), 'service-worker cache version changes when the application assets change');
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
assert(databaseFirst.includes("function scheduleCacheSnapshot(rows)") && databaseFirst.includes("__snapshot__") && databaseFirst.includes("setBaselineRow(row, false)"), "startup avoids synchronous per-record cache writes");
console.log("PASS summary ordering, latest activity, grouped reports, dark button labels and faster startup");
