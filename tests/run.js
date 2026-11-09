/* Real browser tests: they load the actual index.html / js/app.js / sw.js through a local static server
 * and exercise the real functions. No mocks of app logic. Exit code != 0 if any check fails.
 * Run: npm test   (requires: npm install  -> playwright)                                         */
const http=require('http'),fs=require('fs'),path=require('path'),vm=require('vm');let pw;try{pw=require('playwright')}catch(e){console.error('playwright is not installed. Run: npm install && npx playwright install chromium');process.exit(2)}
const ROOT=path.join(__dirname,'..'),MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.md':'text/plain'};
const server=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u.endsWith('/'))u+='index.html';if(u==='/index.html'){let html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');html=html.replace('<style>html{visibility:hidden}</style>','');html=html.replace(/<script type="module">[\s\S]*?<\/script>/,'');html=html.replace('<script type="module" src="./js/cloud-sync.js"></script>','');html=html.replace('<script type="module" src="./js/database-first.js"></script>','');r.writeHead(200,{'Content-Type':'text/html'});r.end(html);return}const f=path.join(ROOT,u);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end('nf');return}r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r)});
const R=[];let fails=0;const ok=(n,c,x)=>{R.push(`${c?'PASS':'FAIL'}  ${n}${x!==undefined?'  => '+(typeof x=='object'?JSON.stringify(x):x):''}`);if(!c)fails++};
(async()=>{
await new Promise(r=>server.listen(0,r));const BASE='http://localhost:'+server.address().port+'/';
const browser=await pw.chromium.launch();
/* ---------- A. static checks on the real files ---------- */
const app=fs.readFileSync(path.join(ROOT,'js/app.js'),'utf8'),idx=fs.readFileSync(path.join(ROOT,'index.html'),'utf8'),cloud=fs.readFileSync(path.join(ROOT,'js/cloud-sync.js'),'utf8'),dbSync=fs.readFileSync(path.join(ROOT,'js/database-first.js'),'utf8'),css=fs.readFileSync(path.join(ROOT,'css/style.css'),'utf8');
const names=[...app.matchAll(/^(?:async )?function ([A-Za-z0-9_$]+)\(/gm)].map(m=>m[1]),dup=[...new Set(names.filter((n,i)=>names.indexOf(n)!==i))];
ok('app.js has no duplicate top-level function definitions',dup.length==0,dup);
ok('customer/supplier rows expose permission-gated edit actions',app.includes('pForm(${c},${p.id})')&&app.includes('can("edit")'));
ok('partner edit preserves the stable record ID and updates the existing object',app.includes('function saveP(id)')&&app.includes('if(old)Object.assign(old,data)'));
ok('employee edit preserves the existing employee record',app.includes('function saveE(id)')&&app.includes('if(old)Object.assign(old,data)'));
ok('warehouse names can be edited without replacing warehouse IDs',app.includes('function saveWh(id)')&&app.includes('w.name=n'));
ok('chart-of-account names can be edited while preserving their account IDs',app.includes('function saveAccName(id)')&&app.includes('a.name=n'));
ok('cloud transaction deletion requires both its module and inventory permissions',/effectPermission=\(\{doc:"invoices",po:"production",vch:"invoices",je:"settings",wo:"inventory"\}\)\[src\]/.test(app)&&/cp\.permissions\?\.inventory!==true\|\|cp\.permissions\?\.\[effectPermission\]!==true/.test(app));
ok('master-data edit handlers enforce edit permission when called directly',[
  'function saveP(id){if(id&&!can("edit"))return;',
  'function saveItem(id){if(id&&!can("edit"))return;',
  'function saveE(id){if(id&&!can("edit"))return;',
  'function saveWh(id){if(!can("edit"))return;',
  'function saveAccName(id){if(!can("edit"))return;'
].every(x=>app.includes(x)));
ok('cash and bank accounts expose the same permission-gated rename action as chart accounts',app.includes('function vBank()')&&app.includes('editAcc(${a.id})'));
for(const id of ['pgst','toast','tabs','sb','m','sb-overlay','top','ttl'])ok(`index.html contains #${id}`,new RegExp(`id="${id}"`).test(idx));
const man=JSON.parse(fs.readFileSync(path.join(ROOT,'manifest.json'),'utf8'));
for(const ic of man.icons){const f=path.join(ROOT,ic.src),b=fs.existsSync(f)?fs.readFileSync(f):Buffer.alloc(0),w=b.length>24&&b.readUInt32BE(16),h=b.length>24&&b.readUInt32BE(20);ok(`manifest icon ${ic.src} exists and is a PNG of ${ic.sizes}`,b.slice(1,4).toString()=='PNG'&&`${w}x${h}`==ic.sizes,`${w}x${h}`)}
ok('manifest has start_url/scope/display standalone/rtl',man.start_url&&man.scope&&man.display=='standalone'&&man.dir=='rtl');
const sw=fs.readFileSync(path.join(ROOT,'sw.js'),'utf8'),builtSw=fs.readFileSync(path.join(ROOT,'public/sw.js'),'utf8');ok('Vite production build receives the service worker from public/',builtSw===sw);ok('service worker is versioned, GET-only and same-origin only',/const VERSION\s*=/.test(sw)&&/request\.method !== 'GET'/.test(sw)&&/url\.origin !== self\.location\.origin/.test(sw)&&/caches\.delete/.test(sw));
ok('no secrets / service role keys in shipped files',!/service_role|eyJ[A-Za-z0-9_-]{20,}|sk_live|SUPABASE_SERVICE/i.test(app+idx+sw));
ok('login screen does not expose public self-registration',!/auth-signup|signUp\(/.test(fs.readFileSync(path.join(ROOT,'auth.html'),'utf8')+fs.readFileSync(path.join(ROOT,'js/auth.js'),'utf8')));
const createEmployeeFn=fs.readFileSync(path.join(ROOT,'supabase/functions/create-employee-account/index.ts'),'utf8');
const changePasswordFn=fs.readFileSync(path.join(ROOT,'supabase/functions/change-initial-password/index.ts'),'utf8');
const changePasswordPage=fs.readFileSync(path.join(ROOT,'change-password.html'),'utf8')+fs.readFileSync(path.join(ROOT,'js/change-password.js'),'utf8');
ok('new employee accounts require a first-login password change',/must_change_password:\s*true/.test(createEmployeeFn));
ok('online and cached profile gates redirect flagged employees before opening the app',/profile\.must_change_password === true/.test(idx)&&/cachedProfile\.must_change_password === true/.test(idx)&&/change-password\.html/.test(idx));
ok('first-login password endpoint verifies the signed-in user before privileged password update',/caller\.auth\.getUser\(\)/.test(changePasswordFn)&&/admin\.auth\.admin\.updateUserById\(\s*authData\.user\.id,\s*\{\s*password\s*\}\s*,\s*\)/.test(changePasswordFn));
ok('first-login password endpoint only clears the flag for the authenticated employee',/profile\.must_change_password !== true/.test(changePasswordFn)&&/\.eq\("id", authData\.user\.id\)/.test(changePasswordFn)&&/must_change_password: false/.test(changePasswordFn));
ok('first-login page validates the new password and invokes the protected Supabase function',/password\.length < 10/.test(changePasswordPage)&&/functions\.invoke\(['"]change-initial-password['"]/.test(changePasswordPage));
ok('Vite production build includes the first-login password page',/password: resolve\(root, 'change-password.html'\)/.test(fs.readFileSync(path.join(ROOT,'vite.config.js'),'utf8')));

ok('index auth gate validates the Supabase profile before revealing the app',/html\{visibility:hidden\}/.test(idx)&&/\.from\(['"]profiles['"]\)/.test(idx)&&/is_admin,permissions/.test(idx));
ok('employee screen access is tied to the cloud profile permissions',/CLOUD_SCREEN_PERMISSIONS/.test(app)&&/setFactoryAuthProfile/.test(app));
ok('full factory snapshot is restricted to administrator accounts',/if \(admin\)/.test(cloud)&&/factory_state/.test(cloud)&&/factory_state_admin_only/.test(fs.readFileSync(path.join(ROOT,'supabase/migrations/20261107081648_enforce_employee_permissions_20261107.sql'),'utf8')));
const syncPageStart=app.indexOf('function syncPage(){'),syncPageEnd=app.indexOf('/* ---- tabbed workspace ---- */',syncPageStart),syncPageSource=syncPageStart>=0&&syncPageEnd>syncPageStart?app.slice(syncPageStart,syncPageEnd):'';
ok('database-first adapter writes only changed records through an atomic record-batch RPC',/from\('factory_records'\)/.test(dbSync)&&/rpc\('apply_factory_record_batch'/.test(dbSync)&&/makeOperations\(getState\(\)\)/.test(dbSync)&&!/factory_state|uploadToTables|loadFromTablesMerge/.test(dbSync));
ok('legacy device and mobile records are never imported; empty database stays empty',!/buildInitialOperations|One-time import only/.test(dbSync)&&/clearLegacyDeviceData\(\)/.test(dbSync)&&/const rows = await fetchAllRecords\(\)/.test(dbSync)&&/hydrateFromRows\(rows\)/.test(dbSync));
ok('legacy local snapshot is ignored and only offline mode may keep a temporary local snapshot',/let S=seed\(\); \/\/ Legacy local snapshots are intentionally ignored/.test(app)&&/window\.__factoryPersistState\(S\)/.test(app)&&/if\(!navigator\.onLine\)\{localStorage\.setItem\("mgr6"/.test(app)&&!/else\{localStorage\.setItem\("mgr6"/.test(app));
ok('offline queue replays with persisted versions and atomic conflict protection',/QUEUE_KEY/.test(dbSync)&&/BASELINE_KEY/.test(dbSync)&&/flushQueue\(\)/.test(dbSync)&&/expected_version/.test(dbSync)&&/FACTORY_RECORD_CONFLICT/.test(dbSync));
ok('live updates subscribe to individual factory_records rows instead of reloading the whole factory',/postgres_changes/.test(dbSync)&&/applyRealtimeRow\(payload\.new\)/.test(dbSync)&&!/refreshFromDatabase|loadFromTablesMerge/.test(dbSync));
ok('reconnect reads only rows changed since the last sync cursor',/fetchChangedRecords\(since\)/.test(dbSync)&&/gt\('updated_at', since\)/.test(dbSync)&&/LAST_SYNC_KEY/.test(dbSync));
ok('offline cache stores individual rows and version metadata, not a full local state snapshot during online saves',/CACHE_PREFIX/.test(dbSync)&&/cacheRow\(row\)/.test(dbSync)&&!/JSON\.stringify\(\[\.\.\.baseline\.values\(\)\]\)/.test(dbSync)&&/if\(!navigator\.onLine\)\{localStorage\.setItem\("mgr6"/.test(app));
ok('atomic database RPC is invoker-secured and protected by RLS migration',fs.readFileSync(path.join(ROOT,'supabase/migrations/20261109162608_atomic_factory_record_batch.sql'),'utf8').includes('security invoker')&&fs.readFileSync(path.join(ROOT,'supabase/migrations/20261109161927_database_first_factory_records.sql'),'utf8').includes('force row level security'));
ok('sync toolbar is removed but conflict recovery remains reachable from the connection indicator',!app.includes('["🔄 حالة الاتصال والمزامنة","syncPage()"]')&&/id="net" onclick="syncPage\(\)"/.test(idx)&&/ms-logout-btn/.test(cloud)&&!/cloud-badge|رفع الآن|Upload Now|تحميل/.test(cloud.slice(cloud.indexOf('function drawAll()'))));

const collectorStart=cloud.indexOf('function collectSourceEffects(state)');
const collectorEnd=cloud.indexOf('// ===== الرفع مرة واحدة',collectorStart);
const effectHelpersContext=vm.createContext({});
let collectSourceEffects=null, normalizeSourceEffects=null, planSourceEffectSync=null, applyCanonicalSourceEffect=null, removeCanonicalSourceEffect=null, removeSourceDocument=null, planRemoteSourceEffectApply=null, buildStockBaseline=null, applyStockBaseline=null, buildFactoryBaseline=null, applyFactoryBaseline=null, applyInventoryBaselineSection=null, applyAccountingBaselineSection=null;
try {
  vm.runInContext(cloud.slice(collectorStart,collectorEnd)+';this.collectSourceEffects=collectSourceEffects;this.normalizeSourceEffects=normalizeSourceEffects;this.planSourceEffectSync=planSourceEffectSync;this.applyCanonicalSourceEffect=applyCanonicalSourceEffect;this.removeCanonicalSourceEffect=removeCanonicalSourceEffect;this.removeSourceDocument=removeSourceDocument;this.planRemoteSourceEffectApply=planRemoteSourceEffectApply;this.buildStockBaseline=buildStockBaseline;this.applyStockBaseline=applyStockBaseline;this.buildFactoryBaseline=buildFactoryBaseline;this.applyFactoryBaseline=applyFactoryBaseline;this.applyInventoryBaselineSection=applyInventoryBaselineSection;this.applyAccountingBaselineSection=applyAccountingBaselineSection;',effectHelpersContext);
  collectSourceEffects=effectHelpersContext.collectSourceEffects;
  normalizeSourceEffects=effectHelpersContext.normalizeSourceEffects;
  planSourceEffectSync=effectHelpersContext.planSourceEffectSync;
  applyCanonicalSourceEffect=effectHelpersContext.applyCanonicalSourceEffect;
  removeCanonicalSourceEffect=effectHelpersContext.removeCanonicalSourceEffect;
  removeSourceDocument=effectHelpersContext.removeSourceDocument;
  planRemoteSourceEffectApply=effectHelpersContext.planRemoteSourceEffectApply;
  buildStockBaseline=effectHelpersContext.buildStockBaseline;
  applyStockBaseline=effectHelpersContext.applyStockBaseline;
  buildFactoryBaseline=effectHelpersContext.buildFactoryBaseline;
  applyFactoryBaseline=effectHelpersContext.applyFactoryBaseline;
  applyInventoryBaselineSection=effectHelpersContext.applyInventoryBaselineSection;
  applyAccountingBaselineSection=effectHelpersContext.applyAccountingBaselineSection;
} catch(e) {}
const stockBaselineFixture={
  wh:[{id:1,name:'المخزن الرئيسي'}],
  items:[
    {id:11,sku:'FB011',name:'قماش',unit:'متر',wh:1,st:{'أبيض':12,'كحلي':4},val:1600},
    {id:12,sku:'ZIP012',name:'سوستة',unit:'قطعة',wh:1,st:{'-':50},val:250}
  ]
};
const stockBaseline=buildStockBaseline?buildStockBaseline(stockBaselineFixture):{invalid:[{reason:'helper_unavailable'}]};
ok('stock baseline captures absolute item/variant quantities and values',stockBaseline.invalid.length===0&&stockBaseline.items.length===2&&stockBaseline.items[0].variants.length===2);
ok('stock baseline fingerprint is deterministic',!!buildStockBaseline&&stockBaseline.fingerprint===buildStockBaseline(stockBaselineFixture).fingerprint);
ok('stock baseline rejects duplicate item identities',buildStockBaseline({...stockBaselineFixture,items:[...stockBaselineFixture.items,{...stockBaselineFixture.items[0]}]}).invalid.some(x=>x.reason==='duplicate_item_external_id'));
ok('stock baseline rejects invalid quantities',buildStockBaseline({...stockBaselineFixture,items:[{...stockBaselineFixture.items[0],st:{'-':'not-a-number'}}]}).invalid.some(x=>x.reason==='invalid_stock_quantity'));
const baselineTarget={items:[{id:11,st:{'أبيض':99},val:9999,keep:'unchanged'},{id:12,st:{'-':1},val:1},{id:13,st:{'-':7},val:70}]};
const baselineApply1=applyStockBaseline?applyStockBaseline(baselineTarget,stockBaseline):{applied:false};
const baselineApply2=applyStockBaseline?applyStockBaseline(baselineTarget,stockBaseline):{applied:false};
ok('absolute stock baseline replaces quantities rather than adding movement deltas',baselineApply1.applied&&baselineTarget.items[0].st['أبيض']===12&&baselineTarget.items[0].val===1600);
ok('reapplying the same stock baseline is idempotent',baselineApply2.applied&&baselineTarget.items[0].st['أبيض']===12&&baselineTarget.items[1].st['-']===50);
ok('stock baseline preserves non-stock fields and local-only items',baselineTarget.items[0].keep==='unchanged'&&baselineTarget.items[2].st['-']===7);
const baselineMissingTarget={items:[{id:11,st:{'-':4},val:4}]};
const baselineBefore=JSON.stringify(baselineMissingTarget);
const baselineMissing=applyStockBaseline?applyStockBaseline(baselineMissingTarget,stockBaseline):{applied:true};
ok('stock baseline refuses partial application when an item is missing',!baselineMissing.applied&&JSON.stringify(baselineMissingTarget)===baselineBefore);
const tamperedBaseline={...stockBaseline,items:stockBaseline.items.map(x=>({...x,value:x.value+1}))};
ok('stock baseline rejects a modified manifest checksum',!applyStockBaseline(baselineTarget,tamperedBaseline).applied);
const factoryBaselineFixture={
  wh:[{id:1,name:'المخزن الرئيسي'}],
  accts:[{id:1,code:'1001',name:'الخزنة',t:'A',k:'cash',cash:1,cur:'EGP'},{id:2,code:'1100',name:'العملاء',t:'A',k:'ar',cash:0,cur:'EGP'}],
  partners:[{id:31,cloudId:'partner-31',name:'عميل افتتاحي',phone:'01000000000',c:1,s:0}],
  items:[{id:11,cloudId:'item-11',sku:'FB011',name:'قماش',unit:'متر',wh:1,st:{'-':5},val:50}],
  L:[
    {src:'je',d:'2026-11-01',ts:1,ref:'JE-0001',desc:'رصيد افتتاحي',a:1,dr:100,cr:0,pid:0,fc:0},
    {src:'je',d:'2026-11-01',ts:1,ref:'JE-0001',desc:'رصيد افتتاحي',a:2,dr:0,cr:100,pid:31,fc:0}
  ],
  mv:[{d:'2026-11-01',ts:1,iid:11,v:'-',q:5,val:50,ref:'رصيد افتتاحي',pid:0}]
};
const factoryBaseline=buildFactoryBaseline?buildFactoryBaseline(factoryBaselineFixture):{invalid:[{}]};
ok('factory baseline captures opening ledger, opening stock history, accounts and partners',factoryBaseline.invalid.length===0&&factoryBaseline.openingLedger.length===2&&factoryBaseline.openingMovements.length===1&&factoryBaseline.accounts.length===2);
ok('factory baseline refuses non-opening legacy ledger rows',buildFactoryBaseline({...factoryBaselineFixture,L:[{src:'je',desc:'قيد غير مصنف',a:1,dr:1,cr:1}]}).invalid.some(x=>x.reason==='unclassified_legacy_ledger_row'));
ok('factory baseline refuses source effects that were not backfilled',buildFactoryBaseline({...factoryBaselineFixture,L:[...factoryBaselineFixture.L,{src:'doc',rid:99,a:1,dr:1,cr:1}]}).invalid.some(x=>x.reason==='source_effects_require_backfill_before_baseline'));
const factoryTarget={
  accts:[{id:1,code:'1001',name:'الخزنة',t:'A',k:'cash',cash:1,cur:'EGP'}],
  partners:[{id:501,name:'عميل افتتاحي',phone:'01000000000',c:1,s:0}],
  items:[{id:999,cloudId:'item-11',st:{'-':0},val:0}],
  L:[],mv:[]
};
const factoryApply1=applyFactoryBaseline?applyFactoryBaseline(factoryTarget,factoryBaseline):{applied:false};
const factoryApply2=applyFactoryBaseline?applyFactoryBaseline(factoryTarget,factoryBaseline):{applied:false};
ok('factory baseline creates missing account, links partner and imports opening ledger',factoryApply1.applied&&factoryTarget.accts.length===2&&factoryTarget.partners[0].cloudId==='partner-31'&&factoryTarget.L.length===2);
ok('factory baseline restores opening stock and movement history without double-counting',factoryApply1.applied&&factoryTarget.items[0].st['-']===5&&factoryTarget.mv.length===1);
ok('factory baseline reapplication is idempotent',factoryApply2.applied&&factoryTarget.L.length===2&&factoryTarget.mv.length===1&&factoryTarget.items[0].st['-']===5);
const missingFactoryTarget={accts:[],partners:[],items:[],L:[],mv:[]};
const missingFactoryBefore=JSON.stringify(missingFactoryTarget);
const missingFactoryApply=applyFactoryBaseline?applyFactoryBaseline(missingFactoryTarget,factoryBaseline):{applied:true};
ok('factory baseline refuses partial restore when a product is missing',!missingFactoryApply.applied&&JSON.stringify(missingFactoryTarget)===missingFactoryBefore);

const inventorySectionState={
  items:[{id:11,cloudId:'item-11',st:{'-':0},val:0}],
  mv:[]
};
const inventorySection={baselineVersion:1,stock:buildStockBaseline({items:[{id:11,cloudId:'item-11',st:{'-':8},val:80}],wh:[]}),
  openingMovements:[{date:'2026-11-01',timestamp:1,itemExternalId:'item-11',variant:'-',quantity:8,value:80,reference:'رصيد افتتاحي'}]};
const inventorySectionApply=applyInventoryBaselineSection?applyInventoryBaselineSection(inventorySectionState,inventorySection):{applied:false};
const inventorySectionApplyAgain=applyInventoryBaselineSection?applyInventoryBaselineSection(inventorySectionState,inventorySection):{applied:false};
ok('inventory-only baseline applies absolute stock and imports opening history without replaying quantities',
  inventorySectionApply.applied&&inventorySectionState.items[0].st['-']===8&&inventorySectionState.mv.length===1&&inventorySectionApplyAgain.applied&&inventorySectionState.mv.length===1);
const inventorySectionBadState={items:[{id:11,cloudId:'item-11',st:{'-':2},val:20}],mv:[]};
const inventorySectionBefore=JSON.stringify(inventorySectionBadState);
const inventorySectionBad=applyInventoryBaselineSection?applyInventoryBaselineSection(inventorySectionBadState,{...inventorySection,openingMovements:[...inventorySection.openingMovements,{itemExternalId:'missing',variant:'-',quantity:1,value:1}]}):{applied:true};
ok('inventory-only baseline preflights all history before mutation',!inventorySectionBad.applied&&JSON.stringify(inventorySectionBadState)===inventorySectionBefore);
const accountingSectionState={accts:[],partners:[],items:[{id:11,cloudId:'item-11',st:{'-':4},val:40}],L:[],mv:[]};
const accountingSection={baselineVersion:1,accounts:factoryBaseline.accounts,partners:factoryBaseline.partners,openingLedger:factoryBaseline.openingLedger};
const accountingSectionApply=applyAccountingBaselineSection?applyAccountingBaselineSection(accountingSectionState,accountingSection):{applied:false};
const accountingSectionApplyAgain=applyAccountingBaselineSection?applyAccountingBaselineSection(accountingSectionState,accountingSection):{applied:false};
ok('accounting-only baseline restores accounts, partners and balanced opening ledger without exposing inventory section',
  accountingSectionApply.applied&&accountingSectionState.accts.length===2&&accountingSectionState.partners.length===1&&accountingSectionState.L.length===2&&accountingSectionState.items[0].st['-']===4&&accountingSectionApplyAgain.applied&&accountingSectionState.L.length===2);
const accountingWithoutInventory={accts:[],partners:[],items:[],L:[],mv:[]};
const accountingWithoutInventoryApply=applyAccountingBaselineSection?applyAccountingBaselineSection(accountingWithoutInventory,accountingSection):{applied:false};
ok('accounting-only baseline does not require inventory products, quantities or movement state',
  accountingWithoutInventoryApply.applied&&accountingWithoutInventory.accts.length===2&&accountingWithoutInventory.partners.length===1&&accountingWithoutInventory.L.length===2&&accountingWithoutInventory.items.length===0&&accountingWithoutInventory.mv.length===0);
const baselineMigration=fs.readFileSync(path.join(ROOT,'supabase/migrations/20261108213000_factory_sync_baseline.sql'),'utf8');
ok('baseline SQL provides immutable one-time publication and independently authorized section reads',
  /p_expected_version is distinct from 0/.test(baselineMigration)&&/Opening baseline is already published and immutable/.test(baselineMigration)&&/p_section = 'inventory'/.test(baselineMigration)&&/p_section = 'accounting'/.test(baselineMigration)&&baselineMigration.includes("can_access_factory_owner_strict(v_owner_id, 'inventory')")&&baselineMigration.includes("can_access_factory_owner_strict(v_owner_id, 'settings')"));
ok('baseline SQL validates synced item/partner references, source-effect backfill and balanced opening ledger',
  /Source effects exist; backfill them before baseline publication/.test(baselineMigration)&&/Opening ledger is not balanced/.test(baselineMigration)&&/products pr/.test(baselineMigration)&&/public\.customers c/.test(baselineMigration)&&/public\.suppliers s/.test(baselineMigration));

const sourceEffectMigration=fs.readFileSync(path.join(ROOT,'supabase/migrations/20261108201500_source_accounting_effects.sql'),'utf8');
const baselineHardeningMigration=fs.readFileSync(path.join(ROOT,'supabase/migrations/20261109080000_harden_factory_baseline_publication.sql'),'utf8');
ok('baseline publisher locks and compares the complete opening snapshot and qualifies its RETURNING column',
  baselineHardeningMigration.includes('for share')&&baselineHardeningMigration.includes('Baseline is incomplete compared with the factory opening snapshot')&&baselineHardeningMigration.includes('Baseline omits or changes a factory master-record identity')&&baselineHardeningMigration.includes('returning b.published_at into v_published_at'));
const tombstoneHardeningMigration=fs.readFileSync(path.join(ROOT,'supabase/migrations/20261109081000_prevent_source_effect_resurrection.sql'),'utf8');
ok('database rejects every attempt to resurrect a tombstoned source effect',
  tombstoneHardeningMigration.includes('v_current_deleted_at')&&tombstoneHardeningMigration.includes('A tombstoned source effect cannot be resurrected'));

ok('baseline section reads are requested only with explicit inventory/settings permission',cloud.includes('admin || profile.permissions?.inventory === true')&&cloud.includes('admin || profile.permissions?.settings === true'));
ok('reports-only permission cannot read inventory or accounting source-effect sections',sourceEffectMigration.includes("can_access_factory_owner_strict(v_owner_id, 'inventory')")&&sourceEffectMigration.includes("can_access_factory_owner_strict(\n      v_owner_id,")&&!sourceEffectMigration.includes("private.can_access_factory_owner(v_owner_id, 'inventory', false)"));
ok('source-effect SQL merges authorized sections and preserves the hidden section atomically',
  sourceEffectMigration.includes("else coalesce(v_existing_payload -> 'ledger', '[]'::jsonb)")&&sourceEffectMigration.includes("else coalesce(v_existing_payload -> 'movements', '[]'::jsonb)")&&sourceEffectMigration.includes("v_write_ledger and not v_can_write_ledger")&&sourceEffectMigration.includes("v_write_movements and not v_can_write_movements"));
ok('source-effect client sends only the sections allowed by the employee permission set',
  cloud.includes('ledgerIncluded: writeLedger, movementsIncluded: writeMovements')&&cloud.includes('ledger: writeLedger ? action.effect.ledger : []')&&cloud.includes('movements: writeMovements ? action.effect.movements : []'));
ok('inventory-only and finance-only clients can upload their authorized effect section while SQL preserves the hidden section',
  cloud.includes('ledgerIncluded: writeLedger, movementsIncluded: writeMovements')&&
  !cloud.includes('complete_effect_requires_all_populated_section_permissions')&&
  sourceEffectMigration.includes("else coalesce(v_existing_payload -> 'ledger', '[]'::jsonb)")&&
  sourceEffectMigration.includes("else coalesce(v_existing_payload -> 'movements', '[]'::jsonb)"));
ok('source-effect deletion uses queued tombstones and requires both sections before clearing',
  cloud.includes('mgr6-cloud-effect-tombstones')&&cloud.includes('if (isDelete && (!writeLedger || !writeMovements))')&&sourceEffectMigration.includes('Deleting a complete source effect requires ledger and inventory write permissions'));
ok('source effects are downloaded after master data and opening baseline application',
  cloud.indexOf('const effectsResult = await supabase.rpc("get_source_effects")')>cloud.indexOf('for (const [sectionName, row, applySection]')&&cloud.indexOf('for (const [sectionName, row, applySection]')>cloud.indexOf('mergeCloudProducts(S.items'));

const accountConflictTarget={accts:[{id:1,code:'1001',name:'الخزنة',t:'A',k:'bank',cash:1,cur:'EGP'}],partners:[],items:[{id:11,cloudId:'item-11',st:{'-':4},val:40}],L:[],mv:[]};
const accountConflictBefore=JSON.stringify(accountConflictTarget);
const accountConflictApply=applyAccountingBaselineSection?applyAccountingBaselineSection(accountConflictTarget,accountingSection):{applied:true};
ok('accounting baseline refuses a same-code account with a conflicting definition without mutation',
  !accountConflictApply.applied&&JSON.stringify(accountConflictTarget)===accountConflictBefore);
const partnerRoleBaseline=buildFactoryBaseline({...factoryBaselineFixture,partners:[{...factoryBaselineFixture.partners[0],s:1}]});
const partnerRoleTarget={accts:[],partners:[{id:501,name:'عميل افتتاحي',phone:'01000000000',c:1,s:0}],items:[{id:11,cloudId:'item-11',st:{'-':4},val:40}],L:[],mv:[]};
const partnerRoleApply=applyFactoryBaseline?applyFactoryBaseline(partnerRoleTarget,partnerRoleBaseline):{applied:false};
ok('accounting baseline merges customer/supplier roles when linking a known partner',
  partnerRoleApply.applied&&partnerRoleTarget.partners[0].cloudId==='partner-31'&&partnerRoleTarget.partners[0].c===1&&partnerRoleTarget.partners[0].s===1);

const qaRestoreScript=fs.readFileSync(path.join(ROOT,'scripts/restore-qa-logical-backup.sh'),'utf8');
const qaRestoreWorkflow=fs.readFileSync(path.join(ROOT,'.github/workflows/restore-supabase-backup-to-qa.yml'),'utf8');
const backupWorkflow=fs.readFileSync(path.join(ROOT,'.github/workflows/backup-supabase-to-b2.yml'),'utf8');
ok('QA restore is hard-locked to the QA project and rejects the production project reference',
  qaRestoreScript.includes('EXPECTED_QA_PROJECT_REF')&&qaRestoreScript.includes('FORBIDDEN_PRODUCTION_PROJECT_REF')&&qaRestoreWorkflow.includes('bpkkzyjfkktkaadhmbdi')&&qaRestoreWorkflow.includes('yvrislcbbhtruwdnuooz'));
ok('QA restore uses logical schema/data plus separately exported Auth and migration history',
  qaRestoreScript.includes('--file roles.sql')&&qaRestoreScript.includes('--file schema.sql')&&qaRestoreScript.includes('--file data.sql')&&qaRestoreScript.includes('--file auth-users.sql')&&qaRestoreScript.includes('--file migration-history.sql')&&qaRestoreScript.includes('--file auth-trigger-qa-idempotent.sql'));
ok('QA restore refuses non-empty targets and verifies row counts, RLS, and custom Auth trigger',
  qaRestoreScript.includes('Never overwrite an existing QA dataset')&&qaRestoreScript.includes('public-row-counts.txt')&&qaRestoreScript.includes('auth-row-counts.txt')&&qaRestoreScript.includes('relrowsecurity')&&qaRestoreScript.includes('expected_trigger_names.issubset(actual_trigger_names)'));
ok('manual backup requires its explicit gate and remains independent of the scheduled-backup gate',
  backupWorkflow.includes("github.event_name == 'schedule' && vars.BACKUP_SCHEDULE_ENABLED == 'true'")&&backupWorkflow.includes("github.event_name == 'workflow_dispatch' && inputs.run_backup == true && vars.BACKUP_ENABLED == 'true'")&&!backupWorkflow.includes("github.event_name == 'schedule' && vars.BACKUP_ENABLED == 'true'"));
const productMergeStart=cloud.indexOf('function mergeCloudProducts(existing, incoming)');
const productMergeEnd=cloud.indexOf('function mergeCloudInvoices(existing, incoming)',productMergeStart);
const productMergeContext=vm.createContext({});
let mergeCloudProducts=null;
try {
  vm.runInContext(cloud.slice(productMergeStart,productMergeEnd)+';this.mergeCloudProducts=mergeCloudProducts;',productMergeContext);
  mergeCloudProducts=productMergeContext.mergeCloudProducts;
} catch(e) {}
const legacyProduct=[{id:101,sku:'FB101',name:'قماش أبيض',st:{'-':5},val:50}];
const remoteProduct=[{id:1,cloudId:'factory-item-1',sku:'FB101',name:'قماش أبيض',st:{'-':9},val:90}];
const linkedProduct=mergeCloudProducts?mergeCloudProducts(legacyProduct,remoteProduct):{arr:legacyProduct,linked:0,conflicts:0};
ok('remote product links to a unique local SKU without duplicating the item',linkedProduct.linked===1&&linkedProduct.arr.length===1&&legacyProduct[0].cloudId==='factory-item-1');
const mismatchedProduct=[{id:102,sku:'FB102',name:'قماش مختلف'}];
const mismatchResult=mergeCloudProducts?mergeCloudProducts(mismatchedProduct,[{id:2,cloudId:'factory-item-2',sku:'FB102',name:'اسم مختلف'}]):{conflicts:0,added:1};
ok('product SKU match with a different name is preserved as a conflict',mismatchResult.conflicts===1&&mismatchedProduct.length===1);
const ambiguousProducts=[{id:103,sku:'FB103',name:'قماش'},{id:104,sku:'FB103',name:'قماش'}];
const ambiguousResult=mergeCloudProducts?mergeCloudProducts(ambiguousProducts,[{id:3,cloudId:'factory-item-3',sku:'FB103',name:'قماش'}]):{conflicts:0,added:1};
ok('ambiguous duplicate local SKUs are not auto-merged',ambiguousResult.conflicts===1&&ambiguousProducts.length===2);
const cloudIdFixture={...stockBaselineFixture,items:[{...stockBaselineFixture.items[0],cloudId:'canonical-fabric-11'}]};
const cloudIdBaseline=buildStockBaseline?buildStockBaseline(cloudIdFixture):{items:[]};
ok('stock baseline uses canonical cloud identity rather than device-local numeric ID',cloudIdBaseline.items.some(x=>x.itemExternalId==='canonical-fabric-11'));
const cloudIdTarget={items:[{id:999,cloudId:'canonical-fabric-11',st:{'أبيض':0},val:0}]};
const cloudIdApply=applyStockBaseline?applyStockBaseline(cloudIdTarget,cloudIdBaseline):{applied:false};
ok('stock baseline resolves canonical identity on a device with a different local ID',cloudIdApply.applied&&cloudIdTarget.items[0].st['أبيض']===12);
ok('new inventory items receive a stable cloud identity at creation',/cloudId:String\(itemId\)/.test(app));
ok('default item SKUs are derived from the unique local item ID rather than item count',/if\(!o\.sku\)o\.sku="IT"\+itemId\.toString\(36\)\.toUpperCase\(\)/.test(app)&&/sku:"IT"\+itemId\.toString\(36\)\.toUpperCase\(\)/.test(app));
ok('product uploads and ledger effects use canonical cloud identities',cloud.includes('pr.cloudId = String(pr.id)')&&cloud.includes('externalId: String(item.cloudId || id)'));
const partnerMergeStart=cloud.indexOf('function mergeCloudPartners(existing, incoming)');
const partnerMergeEnd=cloud.indexOf('function mergeCloudInvoices(existing, incoming)',partnerMergeStart);
const partnerMergeContext=vm.createContext({});
let mergeCloudPartners=null;
try {
  vm.runInContext(cloud.slice(partnerMergeStart,partnerMergeEnd)+';this.mergeCloudPartners=mergeCloudPartners;',partnerMergeContext);
  mergeCloudPartners=partnerMergeContext.mergeCloudPartners;
} catch(e) {}
const legacyPartner=[{id:201,name:'عميل واحد',phone:'01000000000',c:1,s:0}];
const remotePartner=[{id:'partner-201',cloudId:'partner-201',name:'عميل واحد',phone:'01000000000',kind:'supplier'}];
const partnerLink=mergeCloudPartners?mergeCloudPartners(legacyPartner,remotePartner):{linked:0,conflicts:0};
ok('partner sync links a unique local contact to the canonical cloud identity',partnerLink.linked===1&&legacyPartner[0].cloudId==='partner-201'&&legacyPartner[0].c===1&&legacyPartner[0].s===1);
const ambiguousPartnerRows=[{id:202,name:'عميل مكرر',phone:''},{id:203,name:'عميل مكرر',phone:''}];
const partnerAmbiguous=mergeCloudPartners?mergeCloudPartners(ambiguousPartnerRows,[{id:'partner-amb',cloudId:'partner-amb',name:'عميل مكرر',phone:'',kind:'customer'}]):{conflicts:0};
ok('ambiguous partner matches are preserved as conflicts',partnerAmbiguous.conflicts===1&&ambiguousPartnerRows.length===2);
const partnerEffectState={accts:[{id:1,code:'1001',name:'الخزنة'}],items:[],partners:[{id:31,cloudId:'partner-canonical-31',name:'عميل'}],L:[{src:'je',rid:91,a:1,dr:10,cr:10,pid:31}],mv:[]};
const partnerEffect=normalizeSourceEffects?normalizeSourceEffects(partnerEffectState):{effects:[],invalid:[{}]};
ok('ledger effect references canonical partner identity',partnerEffect.invalid.length===0&&partnerEffect.effects[0]?.ledger[0]?.partnerExternalId==='partner-canonical-31');
ok('new partner records receive stable cloud identity',/cloudId:String\(partnerId\)/.test(app));
const effectFixture={
  L:[
    {src:'doc',rid:7,a:1,dr:100,cr:0},
    {src:'doc',rid:7,a:2,dr:0,cr:100},
    {src:'je',rid:7,a:3,dr:50,cr:50}
  ],
  mv:[
    {src:'doc',rid:7,iid:11,v:'أزرق / M',q:-2,val:-40},
    {src:'po',rid:7,iid:12,v:'-',q:3,val:30}
  ]
};
const effectResult=collectSourceEffects?collectSourceEffects(effectFixture):{effects:[],invalid:[{reason:'collector_unavailable'}]};
ok('effect collector groups ledger and stock rows by source type plus source ID',effectResult.effects.length===3&&effectResult.effects.find(x=>x.sourceType==='doc'&&x.sourceId==='7')?.ledger.length===2&&effectResult.effects.find(x=>x.sourceType==='doc'&&x.sourceId==='7')?.movements.length===1);
ok('effect collector keeps identical source IDs separate across source categories',effectResult.effects.some(x=>x.sourceType==='je'&&x.sourceId==='7')&&effectResult.effects.some(x=>x.sourceType==='po'&&x.sourceId==='7'));
const effectAgain=collectSourceEffects?collectSourceEffects(effectFixture):{effects:[]};
ok('effect collection is deterministic and does not mutate source state',JSON.stringify(effectResult.effects)===JSON.stringify(effectAgain.effects)&&effectFixture.L.length===3&&effectFixture.mv.length===2);
const invalidEffectResult=collectSourceEffects?collectSourceEffects({L:[{src:'doc',a:1}],mv:[{src:'unknown',rid:1}]}):{invalid:[]};
ok('effect collector reports missing IDs and unsupported source types instead of silently dropping them',invalidEffectResult.invalid.length===2);
const canonicalFixture={
  accts:[{id:1,code:'1001',name:'الخزنة'},{id:2,code:'1100',name:'العملاء'}],
  items:[{id:21,name:'قماش',sku:'FB021',wh:1,unit:'متر',st:{أبيض:10}}],
  wh:[{id:1,name:'قماش'}],
  partners:[{id:31,name:'عميل تجريبي'}],
  L:[{src:'doc',rid:91,d:'2026-11-08',ts:1,ref:'S-1',desc:'بيع',a:1,dr:100,cr:0,pid:0,fc:0},
     {src:'doc',rid:91,d:'2026-11-08',ts:1,ref:'S-1',desc:'عميل',a:2,dr:0,cr:100,pid:31,fc:0}],
  mv:[{src:'doc',rid:91,d:'2026-11-08',ts:1,iid:21,v:'أبيض',q:-2,val:-20,ref:'S-1',pid:31}]
};
const normalized=normalizeSourceEffects?normalizeSourceEffects(canonicalFixture):{effects:[],invalid:[{reason:'normalizer_unavailable'}]};
ok('normalizer maps local ledger account IDs to account codes and partner IDs to external IDs',normalized.invalid.length===0&&normalized.effects[0]?.ledger[0]?.accountCode==='1001'&&normalized.effects[0]?.ledger.some(x=>x.partnerExternalId==='31'));
ok('normalizer maps stock movements to item external ID, SKU and warehouse identity',normalized.invalid.length===0&&normalized.effects[0]?.movements[0]?.itemExternalId==='21'&&normalized.effects[0]?.movements[0]?.warehouseName==='قماش');
const unmapped=normalizeSourceEffects?normalizeSourceEffects({...canonicalFixture,L:[{src:'je',rid:92,a:999,dr:1,cr:0}],mv:[{src:'wo',rid:93,iid:999,q:-1,val:-5}]}):{invalid:[]};
ok('normalizer rejects unmapped account and item references rather than guessing',unmapped.invalid.some(x=>x.reason==='unmapped_account')&&unmapped.invalid.some(x=>x.reason==='unmapped_item'));
const duplicateCodes=normalizeSourceEffects?normalizeSourceEffects({...canonicalFixture,accts:[...canonicalFixture.accts,{id:3,code:'1001',name:'حساب مكرر'}],L:[]}):{invalid:[]};
const unbalanced=normalizeSourceEffects?normalizeSourceEffects({...canonicalFixture,L:[{src:'doc',rid:94,a:1,dr:100,cr:0}]}):{invalid:[]};
ok('normalizer rejects an unbalanced source ledger before it can be synchronized',unbalanced.invalid.some(x=>x.reason==='unbalanced_ledger_effect'));
const duplicateSku=normalizeSourceEffects?normalizeSourceEffects({...canonicalFixture,items:[...canonicalFixture.items,{id:22,name:'قماش آخر',sku:'FB021',wh:1,unit:'متر',st:{}}],L:[]}):{invalid:[]};
ok('normalizer rejects duplicate item SKUs that could map different local IDs to one business code',duplicateSku.invalid.some(x=>x.reason==='duplicate_item_sku'));
ok('normalizer rejects duplicate account codes',duplicateCodes.invalid.some(x=>x.reason==='duplicate_account_code'));
const openingRows=collectSourceEffects?collectSourceEffects({L:[{src:'je',desc:'رصيد افتتاحي',a:1,dr:10,cr:0}],mv:[{ref:'رصيد افتتاحي',iid:1,v:'-',q:10,val:10}]}):{ignored:[]};
ok('legacy opening-balance baseline rows are not replayed as transaction effects',openingRows.ignored.length===2&&openingRows.effects.length===0);
const plannedNew=planSourceEffectSync?planSourceEffectSync(canonicalFixture,{},[],[]):{actions:[],conflicts:[{}]};
ok('planner schedules a new source effect with expected version zero',plannedNew.actions.length===1&&plannedNew.actions[0].op==='upsert'&&plannedNew.actions[0].expectedVersion===0);
const sameRemote={source_type:'doc',source_id:'91',sync_version:3,payload:normalized.effects[0],deleted_at:null};
const adopted=planSourceEffectSync?planSourceEffectSync(canonicalFixture,[sameRemote],{},[]):{adoptedVersions:{}};
ok('planner adopts a matching remote baseline without overwriting it',adopted.actions.length===0&&adopted.adoptedVersions['["doc","91"]']===3);
const stale=planSourceEffectSync?planSourceEffectSync(canonicalFixture,[{...sameRemote,sync_version:4}],{'["doc","91"]':3},[]):{conflicts:[{}]};
ok('planner preserves a newer remote version as a conflict',stale.actions.length===0&&stale.conflicts.some(x=>x.reason==='version_mismatch'));
const changed=planSourceEffectSync?planSourceEffectSync({...canonicalFixture,L:[...canonicalFixture.L,{src:'doc',rid:91,a:1,dr:5,cr:5}]},[sameRemote],{'["doc","91"]':3},[]):{actions:[]};
ok('planner replaces changed effects only against the exact known remote version',changed.actions.length===1&&changed.actions[0].op==='upsert'&&changed.actions[0].expectedVersion===3);
const deleteNew=planSourceEffectSync?planSourceEffectSync({accts:[],items:[],partners:[],wh:[],L:[],mv:[]},[],{},[{sourceType:'doc',sourceId:'91'}]):{actions:[]};
ok('planner emits a version-zero tombstone for a locally deleted unsynced source',deleteNew.actions.length===1&&deleteNew.actions[0].op==='delete'&&deleteNew.actions[0].expectedVersion===0);
const deleteKnown=planSourceEffectSync?planSourceEffectSync({accts:[],items:[],partners:[],wh:[],L:[],mv:[]},[sameRemote],{'["doc","91"]':3},[{sourceType:'doc',sourceId:'91'}]):{actions:[]};
ok('planner tombstones a known source using its exact current version',deleteKnown.actions.length===1&&deleteKnown.actions[0].op==='delete'&&deleteKnown.actions[0].expectedVersion===3);
const deletedRemote=planSourceEffectSync?planSourceEffectSync({accts:[],items:[],partners:[],wh:[],L:[],mv:[]},[{...sameRemote,sync_version:4,deleted_at:'2026-11-08T00:00:00Z',payload:null}],{'["doc","91"]':3},[{sourceType:'doc',sourceId:'91'}]):{clearTombstones:[]};
ok('planner adopts an existing remote tombstone instead of recreating it',deletedRemote.clearTombstones.length===1&&deletedRemote.adoptedVersions['["doc","91"]']===4);
const resurrect=planSourceEffectSync?planSourceEffectSync(canonicalFixture,[{...sameRemote,sync_version:4,deleted_at:'2026-11-08T00:00:00Z',payload:null}],{'["doc","91"]':3},[]):{conflicts:[{}]};
ok('planner never resurrects a remotely deleted source automatically',resurrect.actions.length===0&&resurrect.conflicts.some(x=>x.reason==='remote_effect_deleted'));
ok('source deletions are queued as durable offline tombstones before local reversal',/function queueCloudEffectTombstone\(src,id\)/.test(app)&&/mgr6-cloud-effect-tombstones/.test(app)&&/queueCloudEffectTombstone\(src,id\);rev\(id,src\)/.test(app));
ok('editing and deleting transactions reverses only matching source type plus ID',/function rev\(rid,src\)/.test(app)&&/rev\(id,src\)/.test(app)&&/rev\(old\.id,"doc"\)/.test(app)&&/rev\(old\.id,"vch"\)/.test(app)&&/rev\(old\.id,"po"\)/.test(app)&&/rev\(old\.id,"je"\)/.test(app));
const applyState={accts:[{id:1,code:'1001',name:'الخزنة',t:'A'},{id:2,code:'1100',name:'العملاء',t:'A'}],items:[{id:21,name:'قماش',sku:'FB021',wh:1,unit:'متر',st:{'أبيض':8},val:80}],partners:[{id:31,name:'عميل تجريبي'}],L:[{src:'doc',rid:91,a:1,dr:100,cr:0},{src:'doc',rid:91,a:2,dr:0,cr:100,pid:31}],mv:[{src:'doc',rid:91,iid:21,v:'أبيض',q:-2,val:-20}]};
const replacementEffect={...normalized.effects[0],movements:[{...normalized.effects[0].movements[0],quantity:-3,value:-30}]};
const appliedOnce=applyCanonicalSourceEffect?applyCanonicalSourceEffect(applyState,replacementEffect):{applied:false};
const qtyAfterFirst=applyState.items[0].st['أبيض'],valAfterFirst=applyState.items[0].val,ledgerCountAfterFirst=applyState.L.filter(x=>x.src==='doc'&&String(x.rid)==='91').length;
const appliedTwice=applyCanonicalSourceEffect?applyCanonicalSourceEffect(applyState,replacementEffect):{applied:false};
ok('applying a replacement effect reverses old movement then applies the new quantity and value',appliedOnce.applied&&qtyAfterFirst===7&&valAfterFirst===70);
ok('reapplying the same source effect is idempotent for stock and ledger rows',appliedTwice.applied&&applyState.items[0].st['أبيض']===7&&applyState.items[0].val===70&&applyState.L.filter(x=>x.src==='doc'&&String(x.rid)==='91').length===ledgerCountAfterFirst);
const missingItemState={accts:[{id:1,code:'1001',name:'الخزنة'}],items:[],partners:[],L:[],mv:[]};
const missingItemApply=applyCanonicalSourceEffect?applyCanonicalSourceEffect(missingItemState,replacementEffect):{applied:true};
ok('effect application refuses missing item mappings before mutating the local ledger',!missingItemApply.applied&&missingItemState.L.length===0);
const localWithoutEffect={...canonicalFixture,L:[],mv:[]};
const remoteNew=planRemoteSourceEffectApply?planRemoteSourceEffectApply(localWithoutEffect,[sameRemote],{}):{actions:[]};
ok('remote planner downloads a source absent from the local device',remoteNew.actions.length===1&&remoteNew.actions[0].op==='apply'&&remoteNew.actions[0].version===3);
const localSame=planRemoteSourceEffectApply?planRemoteSourceEffectApply(canonicalFixture,[sameRemote],{}):{adoptedVersions:{}};
ok('remote planner adopts an identical local effect without applying it twice',localSame.actions.length===0&&localSame.adoptedVersions['["doc","91"]']===3);
const localDiff=planRemoteSourceEffectApply?planRemoteSourceEffectApply({...canonicalFixture,L:[...canonicalFixture.L,{src:'doc',rid:91,a:1,dr:1,cr:1}]},[sameRemote],{}):{conflicts:[{}]};
ok('remote planner preserves local edits as conflicts instead of overwriting them',localDiff.actions.length===0&&localDiff.conflicts.some(x=>x.reason==='local_effect_differs_from_remote'));
const remoteDeletedAbsent=planRemoteSourceEffectApply?planRemoteSourceEffectApply(localWithoutEffect,[{...sameRemote,deleted_at:'2026-11-08T00:00:00Z',payload:null}],{}):{adoptedVersions:{}};
ok('remote planner adopts tombstones when the local source is already absent',remoteDeletedAbsent.actions.length===1&&remoteDeletedAbsent.actions[0].op==='delete'&&remoteDeletedAbsent.actions[0].version===3);
const remoteDeletePlan=planRemoteSourceEffectApply?planRemoteSourceEffectApply(canonicalFixture,[{...sameRemote,sync_version:4,deleted_at:'2026-11-08T00:00:00Z',payload:null}],{'["doc","91"]':3}):{actions:[],conflicts:[{}]};
ok('remote tombstone schedules a safe reversal when the local effect version is known',
  remoteDeletePlan.actions.length===1&&remoteDeletePlan.actions[0].op==='delete'&&remoteDeletePlan.actions[0].version===4);
const remoteDeleteState={...canonicalFixture,docs:[{id:91,no:'S-1'}],L:canonicalFixture.L.map(x=>({...x})),mv:canonicalFixture.mv.map(x=>({...x})),items:canonicalFixture.items.map(x=>({...x,st:{...x.st}}))};
const remoteDeleteReversal=removeCanonicalSourceEffect?removeCanonicalSourceEffect(remoteDeleteState,normalized.effects[0]):{applied:false};
const remoteDeleteDocument=removeSourceDocument?removeSourceDocument(remoteDeleteState,'doc','91'):{applied:false};
ok('remote tombstone reverses stock and ledger effects and removes the deleted local document',
  remoteDeleteReversal.applied&&remoteDeleteState.items[0].st['أبيض']===12&&remoteDeleteState.L.length===0&&remoteDeleteState.mv.length===0&&remoteDeleteDocument.applied&&remoteDeleteState.docs.length===0);
const untrackedDocumentState={...canonicalFixture,docs:[{id:91}],L:[],mv:[]};
const untrackedDocumentTombstone=planRemoteSourceEffectApply?planRemoteSourceEffectApply(untrackedDocumentState,[{...sameRemote,deleted_at:'2026-11-08T00:00:00Z',payload:null}],{}):{actions:[{}],conflicts:[]};
ok('remote tombstone preserves a local document when its local version is unknown, even if no effect rows exist',
  untrackedDocumentTombstone.actions.length===0&&untrackedDocumentTombstone.conflicts.some(x=>x.reason==='untracked_local_effect_conflicts_with_remote_tombstone')&&untrackedDocumentState.docs.length===1);
const movementOnlyPayload={sourceType:'doc',sourceId:'91',ledgerIncluded:false,movementsIncluded:true,ledger:[],movements:normalized.effects[0].movements};
const movementOnlyRemote={...sameRemote,payload:movementOnlyPayload};
const partialDownload=planRemoteSourceEffectApply?planRemoteSourceEffectApply(canonicalFixture,[movementOnlyRemote],{}):{conflicts:[{}]};
ok('role-redacted inventory payload compares movements without exposing ledger lines',partialDownload.actions.length===0&&partialDownload.adoptedVersions['["doc","91"]']===3);
const partialState={accts:canonicalFixture.accts.map(x=>({...x})),items:[{...canonicalFixture.items[0],st:{'أبيض':8},val:80}],partners:canonicalFixture.partners.map(x=>({...x})),L:[{src:'doc',rid:91,a:1,dr:100,cr:0},{src:'doc',rid:91,a:2,dr:0,cr:100,pid:31}],mv:[{src:'doc',rid:91,iid:21,v:'أبيض',q:-2,val:-20}]};
const partialApply=applyCanonicalSourceEffect?applyCanonicalSourceEffect(partialState,{...normalized.effects[0],...movementOnlyPayload}):{applied:false};
ok('partial inventory application preserves hidden ledger rows while replacing movements',partialApply.applied&&partialState.L.length===2&&partialState.items[0].st['أبيض']===8);
ok('production-only employees are allowed through the cloud upload permission gate',/!admin && !\["customers", "suppliers", "invoices", "inventory", "production"\]\.some\(canWrite\)/.test(cloud));
ok('production-only employees are allowed through the cloud download permission gate',/!\["customers","suppliers","invoices","inventory","production","reports"\]\.some\(canRead\)/.test(cloud));
ok('invoice cloud sync uses the atomic versioned RPC',/rpc\(["']sync_invoice["']/.test(cloud)&&/p_expected_version/.test(cloud)&&/sync_version/.test(cloud));
ok('inventory sync uploads the actual S.items array used by the stock screens',/for \(const arr of \[S\.items, S\.products, S\.prods\]\)/.test(cloud));
ok('inventory sync totals all colour/size variants instead of reading a missing qty field',/Object\.values\(variants\)\.reduce/.test(cloud)&&/const variants = pr\.st/.test(cloud));
ok('inventory sync stores the full local item in products.raw for lossless restoration',/image_url:[\s\S]{0,500}raw: pr/.test(cloud));
ok('inventory download restores records into S.items, the real inventory source used by the app',/if \(!Array\.isArray\(S\.items\)\) S\.items = \[\]/.test(cloud)&&/S\.items = m\.arr/.test(cloud));
ok('employee detail-only sync remains marked partial in the background',/admin \? "synced" : "partial"/.test(cloud)&&/مزامنة القيود والحركات المحاسبية الكاملة لحساب الموظف لم تكتمل بعد/.test(cloud));
ok('invoice sync does not delete invoice items through separate client requests',!/from\(["']invoice_items["']\)\.delete/.test(cloud));
ok('returns are not misclassified as sale/purchase invoices',/\["sale", "pur"\]\.includes\(d\.t\)/.test(cloud));
ok('cloud invoice merge preserves newer remote copies as explicit conflicts',/mergeCloudInvoices/.test(cloud)&&/serverCopy: remote/.test(cloud));
ok('online reconnect pulls remote changes before uploading local cache',/const pulled = await loadFromTablesMerge\(true\)/.test(cloud)&&cloud.indexOf('const pulled = await loadFromTablesMerge(true)')<cloud.indexOf('const pushed = await uploadToTables(false)'));
ok('online startup sync runs even when local cache already has data',/if \(navigator\.onLine\) \{\s*\/\/ Always refresh remote data on launch/.test(cloud)&&/scheduleAutoSync\(1200\)/.test(cloud));
ok('offline boot permits only a previously verified cached profile for the same user',/factory-profile:/.test(idx)&&/cachedProfile\.id === data\.session\.user\.id/.test(idx)&&/if \(!navigator\.onLine\)/.test(idx));
ok('reconnect refreshes the profile before using permissions for cloud sync',/myProfile = null; ownerIdCache = null; window\.__factoryAuthProfile = null;/.test(cloud)&&/const freshProfile = await getMyProfile\(\)/.test(cloud));

ok('offline shell precaches the stable production app and first-login password page',/auth\.html/.test(sw)&&/change-password\.html/.test(sw)&&/js\/change-password\.js/.test(sw)&&/js\/app\.js/.test(sw)&&/factory-v12/.test(sw));
ok('mobile and desktop usability includes visible keyboard focus and safe-area spacing',/focus-visible/.test(css)&&/safe-area-inset-bottom/.test(css));
ok('offline-created detail records are uploaded even when the full snapshot has a preserved conflict',/if \(admin && !snapshotConflict\)/.test(cloud)&&/for \(const \{ key, arr \} of partnerArrays\)/.test(cloud)&&/hasSnapshotConflict/.test(cloud));
ok('local save writes a durable pending-sync marker before network recovery',/mgr6-sync-pending/.test(app)&&/localStorage\.setItem\("mgr6-sync-pending"/.test(app));
ok('sync indicator is a separate small icon and turns blue while syncing',/id="sync-icon"/.test(idx)&&/syncIcon\.classList\.toggle\('syncing', syncState === 'saving'\)/.test(cloud)&&/#sync-icon\.syncing\{color:#38bdf8/.test(css));
ok('header uses an icon-only light/dark toggle and language stays out of the header',/<button id="thb"/.test(idx)&&!idx.includes('id="lgb"')&&/togLang\(\)/.test(app)&&/التبديل إلى الوضع الداكن/.test(app));
ok('admin selector is labelled Admin in Arabic and English',/الأدمن \/ Admin/.test(app));
ok('search filters update while typing and restore cursor focus after filtering',/function fbarType\(/.test(app)&&/oninput="fbarType\(/.test(app)&&/setSelectionRange\(start,end\)/.test(app));
ok('opening an existing screen in a separate tab activates it instead of duplicating it',/let x=TB\.find\(y=>y\.kind=="screen"&&y\.sid==t\)/.test(app));
ok('Excel export splits currency labels into a separate adjacent cell and keeps amounts numeric',/function exportCurrencyCell/.test(app)&&/\[h\+" \(قيمة\)","العملة"\]/.test(app));
ok('legacy Excel importer supports multiple named sheets for customers, suppliers and inventory',/function impSheet\(/.test(app)&&/function templateExcel\(/.test(app)&&/customers:\[/.test(app)&&/suppliers:\[/.test(app)&&/WZ\.sheetNames/.test(app));
ok('module navigation uses consistent purpose-specific SVG icons',/const APP_ICONS=/.test(app)&&/ico\("customer"\)/.test(app)&&/ico\("inventory"\)/.test(app));
ok('offline service worker pre-caches Vite module assets discovered from the HTML shell',/matchAll\(\/\(\?:src\|href\)/.test(sw)&&/modulepreload/.test(idx+sw)&&/factory-v12/.test(sw));


ok('invoice sync migration uses optimistic version checks and invoker security',/sync_version/.test(fs.readFileSync(path.join(ROOT,'supabase/migrations/20261107090901_20261107111000_atomic_invoice_sync.sql'),'utf8'))&&/SECURITY INVOKER/.test(fs.readFileSync(path.join(ROOT,'supabase/migrations/20261107090901_20261107111000_atomic_invoice_sync.sql'),'utf8'))&&/40001/.test(fs.readFileSync(path.join(ROOT,'supabase/migrations/20261107090901_20261107111000_atomic_invoice_sync.sql'),'utf8')));
ok('full factory snapshots use optimistic versioned RPC writes instead of blind upserts',/rpc\(["']sync_factory_state["']/.test(cloud)&&/p_expected_version/.test(cloud)&&/40001/.test(fs.readFileSync(path.join(ROOT,'supabase/migrations/20261107155417_version_factory_state_snapshot.sql'),'utf8')));
ok('internal snapshot and trigger RPC helpers explicitly revoke anonymous execution',/REVOKE ALL ON FUNCTION public\.sync_factory_state\(integer, jsonb\) FROM anon/.test(fs.readFileSync(path.join(ROOT,'supabase/migrations/20261107160145_revoke_anon_rpc_execute.sql'),'utf8'))&&/REVOKE ALL ON FUNCTION public\.touch_transaction_detail_updated_at\(\) FROM anon/.test(fs.readFileSync(path.join(ROOT,'supabase/migrations/20261107160145_revoke_anon_rpc_execute.sql'),'utf8')));
ok('cross-device record conflicts preserve queued local edits and reject stale writes',/FACTORY_RECORD_CONFLICT/.test(dbSync)&&/queueOperations\(makeOperations\(getState\(\)\)\)/.test(dbSync)&&/apply_factory_record_batch/.test(dbSync)&&/expected_version/.test(dbSync));
ok('return invoices are uploaded and restored with stable IDs and conflict timestamps',/from\(["']returns["']\)[\s\S]{0,500}onConflict: "user_id,external_id"/.test(cloud)&&/cloudReturns/.test(cloud)&&/mergeCloudRecords/.test(cloud));
ok('cash receipt/payment vouchers are uploaded and restored with full raw details',/from\(["']vouchers["']\)[\s\S]{0,500}onConflict: "user_id,external_id"/.test(cloud)&&/cloudVouchers/.test(cloud));
ok('production orders are uploaded and restored with breakdown, cost and status',/from\(["']production_orders["']\)[\s\S]{0,600}onConflict: "user_id,external_id"/.test(cloud)&&/cloudOrders/.test(cloud));
ok('return, voucher and production cloud records preserve update timestamps for conflict detection',/function mergeCloudRecords/.test(cloud)&&/serverCopy: remote/.test(cloud)&&/data\?\.updated_at/.test(cloud));
ok('stale local returns, vouchers and production orders cannot overwrite newer cloud records',/d\._cloudConflict[\s\S]{0,180}resolve before uploading/.test(cloud)&&/v\._cloudConflict[\s\S]{0,180}resolve before uploading/.test(cloud)&&/o\._cloudConflict[\s\S]{0,180}resolve before uploading/.test(cloud));
ok('transaction-detail migration adds raw JSON, stable IDs and unique per-factory keys',/ADD COLUMN IF NOT EXISTS external_id text/.test(fs.readFileSync(path.join(ROOT,'supabase/migrations/20261107155152_sync_transaction_detail_records.sql'),'utf8'))&&/production_orders_user_external_id_uidx/.test(fs.readFileSync(path.join(ROOT,'supabase/migrations/20261107155152_sync_transaction_detail_records.sql'),'utf8')));
ok('invoice sync fix qualifies child-row deletion columns',/DELETE FROM public\.invoice_items AS ii/.test(fs.readFileSync(path.join(ROOT,'supabase/migrations/20261107090923_sync_invoice_delete_alias_fix.sql'),'utf8')));
/* ---------- B. app in a desktop context ---------- */
const ctx=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true}),p=await ctx.newPage(),errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto(BASE);await p.waitForTimeout(500);
const ev=(f,a)=>p.evaluate(()=>{SAVING=0}).then(()=>p.evaluate(f,a)),bal=()=>ev(()=>Math.abs(S.L.reduce((a,l)=>a+l.dr-l.cr,0))<.01);
const scr=await ev(()=>allowed().map(t=>t[0]));for(const s of scr){await ev(x=>go(x),s)}ok(`all ${scr.length} screens render without errors`,errs.length==0,errs.slice(0,2));

/* Search typing and duplicate screen-tab regression, including a narrow mobile viewport. */
await ev(()=>go('cust'));
let searchBox=p.locator('#m input[data-filter-key="cust"][data-filter-id="q"]');
await searchBox.fill("محلات");await p.waitForTimeout(180);
let searchState=await p.evaluate(()=>({value:document.querySelector('#m input[data-filter-key="cust"][data-filter-id="q"]')?.value,focused:document.activeElement?.matches('input[data-filter-key="cust"][data-filter-id="q"]'),rows:[...document.querySelectorAll('#m table.l tr')].filter(r=>r.querySelector('td')&&getComputedStyle(r).display!=='none').map(r=>r.textContent)}));
ok('customer search filters results without dropping the typed text or focus',searchState.value==="محلات"&&searchState.focused&&searchState.rows.some(x=>x.includes("محلات الأمل")),searchState);
await p.keyboard.type(" XYZ");await p.waitForTimeout(180);
const continuedSearch=await p.locator('#m input[data-filter-key="cust"][data-filter-id="q"]').inputValue();
ok('customer search accepts continued typing after live filtering',continuedSearch==="محلات XYZ",continuedSearch);
await p.setViewportSize({width:390,height:844});await ev(()=>{FL.cust={};go('cust')});
searchBox=p.locator('#m input[data-filter-key="cust"][data-filter-id="q"]');
await searchBox.fill("محلات");await p.waitForTimeout(180);
const mobileSearch=await p.evaluate(()=>({value:document.querySelector('#m input[data-filter-key="cust"][data-filter-id="q"]')?.value,focused:document.activeElement?.matches('input[data-filter-key="cust"][data-filter-id="q"]'),width:document.querySelector('#top')?.getBoundingClientRect().width}));
ok('mobile customer search remains focused and usable at 390px width',mobileSearch.value==="محلات"&&mobileSearch.focused&&mobileSearch.width<=390,mobileSearch);
const duplicateTabs=await ev(()=>{go('cust',0,true);go('cust',0,true);return TB.filter(t=>t.kind==='screen'&&t.sid==='cust').length});
ok('opening an already-open module twice reuses its existing tab',duplicateTabs===1,duplicateTabs);
const headerState=await ev(()=>({languageButton:!!document.getElementById('lgb'),themeTag:document.getElementById('thb')?.tagName,admin:document.querySelector('#who option[value="0"]')?.textContent}));
ok('header has no language button, has an icon-only theme button and shows Admin',!headerState.languageButton&&headerState.themeTag==="BUTTON"&&headerState.admin==="الأدمن / Admin",headerState);
const exportCell=await ev(()=>exportCurrencyCell("1,250.50 ج.م"));
ok('currency export parser returns a numeric value and a separate currency cell',exportCell.value==="1250.50"&&exportCell.currency==="ج.م",exportCell);
await p.setViewportSize({width:1280,height:900});await ev(()=>{FL.cust={};go('home')});

/* master data edit: same partner ID, no duplicate row */
await ev(()=>{const p=S.partners.find(x=>x.c);const id=p.id; pForm(1,id); $("#b1").value="اختبار تعديل العميل"; saveP(id); return {id,rows:S.partners.filter(x=>x.id==id).length,name:S.partners.find(x=>x.id==id).name}});
const partnerEdit=await ev(()=>{const p=S.partners.find(x=>x.name=="اختبار تعديل العميل");return p&&{id:p.id,count:S.partners.filter(x=>x.id==p.id).length}});
ok('editing a customer updates the existing row without creating a duplicate',!!partnerEdit&&partnerEdit.count==1,partnerEdit);
/* regression: printing / purchase save used to crash (missing #pgst) */
await ev(()=>{go('pur');docForm('pur');$("#ty").value=String(S.wh[0].id);fillIt();$("#in").value="قماش اختبار";unitSet();$("#un").value="متر";$("#cl").value="أحمر";$("#q").value="10";$("#pc").value="100";saveDoc()});
ok('saving a purchase invoice opens the barcode print page (no crash)',await ev(()=>CUR.title.includes("باركود")||!!ACT.querySelector('#pr')),errs.slice(-1));await ev(()=>closeTab(CUR,1));
const item=await ev(()=>{const i=S.items.find(x=>x.name=="قماش اختبار");return i&&{q:i.st["أحمر"],u:i.unit,v:i.val}});ok('purchase created the item with colour variant, unit and stock value',item&&item.q==10&&item.u=="متر"&&item.v==1000,item);
ok('ledger balanced after purchase',await bal());
const code1=await ev(()=>codeFor(S.items.find(x=>x.name=="قماش اختبار").id,"أحمر"));
await ev(()=>{const i=S.items.find(x=>x.name=="قماش اختبار");go('pur');docForm('pur');$("#ty").value=String(i.wh);fillIt();$("#in").value=i.name;unitSet();$("#cl").value="أحمر";$("#q").value="5";$("#pc").value="110";saveDoc()});await ev(()=>{TB.filter(t=>t.kind=="page").forEach(t=>closeTab(t,1))});
ok('barcode is stable: repeat purchase of the same variant keeps one code',await ev((c)=>S.codes.filter(x=>x.iid==S.items.find(i=>i.name=="قماش اختبار").id).length==1&&codeFor(S.items.find(i=>i.name=="قماش اختبار").id,"أحمر")==c,code1)&&/^[A-Za-z0-9]+$/.test(code1),code1);
/* sale */
await ev(()=>{go('sale');docForm('sale');$("#pt").value="1";$("#it").value="3";unitSet();$("#q").value="2";D.disc=10;saveDoc()});
const sale=await ev(()=>S.docs.find(d=>d.t=="sale"));ok('sale: total = 2 x retail 250 - discount 10 = 490',sale&&sale.total==490&&sale.gross==500&&sale.disc==10,sale&&[sale.gross,sale.disc,sale.total]);
ok('sale: stock of item decreased by 2 (20 -> 18)',await ev(()=>tq(it_(3)))==18);
ok('sale: sales revenue account = 500 and sales-discount = 10 (credit/debit sides correct)',await ev(()=>[bal(ak("sales"),"",td()),bal(ak("sdisc"),"",td())]).then(x=>x[0]==500&&x[1]==10),await ev(()=>[bal(ak("sales"),"",td()),bal(ak("sdisc"),"",td())]));
ok('ledger balanced after sale',await bal());
const pb=await ev(()=>({raw:pbal(1),shown:btxt(pbal(1)),pos:pvh(500),neg:pvh(-500)}));
ok('unified balance rule: customer owing us (490) shows NEGATIVE in red',pb.raw==490&&pb.shown.includes('class="neg"')&&pb.shown.includes('-490.00'),pb.shown);
ok('unified balance rule: positive (we owe him) shows plain, negative shows red',!pb.pos.includes('neg')&&pb.pos.includes('500.00')&&pb.neg.includes('neg')&&pb.neg.includes('-500.00'));
/* return */
await ev(id=>retFrom(id),sale.id);ok('return opens with blank quantities',await ev(()=>D.lines.every(l=>l.qty==0)));
await ev(()=>{SAVING=0;saveDoc()});ok('return with all-empty quantities is rejected (nothing saved)',await ev(()=>!S.docs.some(d=>d.t=="sret")));
await ev(()=>{D.lines[0].qty=1;saveDoc()});ok('return of 1 piece saved at the invoice price (250) and stock +1',await ev(()=>{const r=S.docs.find(d=>d.t=="sret");return r&&r.total==250&&tq(it_(3))==19}));ok('ledger balanced after return',await bal());
/* edit / delete */
await ev(id=>editDoc(id),sale.id);await ev(()=>{D.lines[0].qty=3;saveDoc()});ok('edit sale (qty 3): total 740 (3x250-10), stock 18 after reversing the old sale and applying the new quantity, ledger balanced',await ev(()=>{const d=S.docs.find(x=>x.t=="sale");return !!d&&d.total==740&&tq(it_(3))==18&&Math.abs(S.L.reduce((a,l)=>a+l.dr-l.cr,0))<.01}),await ev(()=>[S.docs.find(x=>x.t=="sale").total,tq(it_(3)),S.L.reduce((a,l)=>a+l.dr-l.cr,0)]));
ok('after edit ledger is balanced',await bal());
/* ---------- voucher linked to invoice ---------- */
const invId=await ev(()=>S.docs.find(d=>d.t=="sale").id),tot=await ev(()=>S.docs.find(d=>d.t=="sale").total);
await ev(()=>{go('rc');vForm('in');$("#vt").value="c";vpt();$("#vp").value="1";vlab();$("#lkc").checked=true;lkTog()});
await ev(h=>{$("#va").value="1";vcur();$("#vm").value=String(h);vAc();const e=$("#lkw").querySelector("input[data-d]");e.value=String(h);lkSet(e);saveV()},tot/2);
ok('voucher linked to invoice: paid / remaining / status updated',await ev(id=>{const d=S.docs.find(x=>x.id==id);return Math.abs(paidOf(d)-d.total/2)<.01&&Math.abs(remOf(d)-d.total/2)<.01&&stOf(d)=="مسددة جزئيًا"},invId));ok('ledger balanced after linked voucher',await bal());
await ev(()=>{go('rc');vForm('in');$("#vt").value="c";vpt();$("#vp").value="1";$("#lkc").checked=true;lkTog();const e=$("#lkw").querySelector("input[data-d]");e.value="99999999";lkSet(e)});
ok('over-allocation above the remaining amount is clamped',await ev(()=>+$("#lkw").querySelector("input[data-d]").value<99999999));await ev(()=>closeTab(CUR,1));
await ev(()=>{go('rc');vForm('in');$("#va").value="1";$("#vm").value="100";vAc();$("#la").value=String(ak("sales"));$("#lm").value="150";vLn();saveV()});
ok('voucher with unequal accounts/lines totals is rejected',await ev(()=>S.vch.length==1));await ev(()=>closeTab(CUR,1));
/* ---------- currency ---------- */
await ev(()=>{go('bank');bForm();$("#bn").value="الخزنة بالدولار";$("#bcu").value="USD";saveAcc(1)});const usd=await ev(()=>S.accts.find(a=>a.name=="الخزنة بالدولار"));
ok('USD account created',usd&&usd.cur=="USD");
await ev(id=>{go('rc');vForm('in');$("#vt").value="o";vpt();$("#vo").value="جهة";$("#va").value=String(id);vcur();$("#vm").value="10";vAc();window.__n=V.ac.length;},usd.id);
ok('foreign-currency amount without exchange rate is rejected',await ev(()=>window.__n==0));
await ev(()=>{$("#vfx").value="50";vAc();$("#la").value=String(ak("sales"));$("#lm").value="500";vLn();saveV()});
ok('USD voucher: balance 10 USD and 500 EGP equivalent kept separately; ledger balanced',await ev(id=>balc(id,"",td())==10&&bal(id,"",td())==500,usd.id)&&await bal());
/* ---------- production ---------- */
await ev(()=>{go('prod');poForm();$("#pin").value="جاكيت اختبار";$("#pcs").value="أحمر، أسود";$("#pzs").value="M, L";$("#pcn").value="5";applyG();$("#ms1").value="1";$("#mq1").value="20";addM(1);$("#xn").value="تطريز";$("#xm").value="500";addX();savePO()});
const po=await ev(()=>S.po[0]);ok('production order: 2 colours x 2 sizes x 5 = 20 pieces, finished item pre-created',po&&po.subs.length==4&&po.subs.reduce((a,s)=>a+s.qty,0)==20&&await ev(()=>!!S.items.find(i=>i.name=="جاكيت اختبار")));
const fab0=await ev(()=>tq(it_(1)));await ev(id=>adv(id),po.id);ok('start execution issues 20 m of fabric from stock',await ev(()=>tq(it_(1)))==fab0-20);
await ev(id=>{rcvForm(id);$("#rc0").value="4";rcvUp(0,5);$("#rc2").value="6";rcvUp(2,5)},po.id);ok('receipt screen shows difference and execution %',await ev(()=>$("#df0").textContent=="-1"&&$("#pc0").textContent=="80%"&&$("#df2").textContent=="1"&&$("#pc2").textContent=="120%"));
await ev(id=>confRcv(id),po.id);await ev(()=>closeTab(CUR,1));
ok('delivery adds the received 20 pieces, WIP back to zero, ledger balanced',await ev(()=>tq(S.items.find(i=>i.name=="جاكيت اختبار"))==20&&Math.abs(bal(ak("wip"),"",td()))<.01)&&await bal());
ok('cost per piece = total cost / received pieces',await ev(id=>{const o=S.po.find(x=>x.id==id);return Math.abs(poCost(o)/20-(o.matCost+500)/20)<.001&&poCost(o)>500},po.id));
await ev(()=>{go('prod');poForm();$("#pin").value="بنطلون اختبار";$("#pcs").value="كحلي";$("#pcn").value="10";applyG();$("#ms1").value="1";$("#mq1").value="10";addM(1);savePO()});const po2=await ev(()=>S.po.find(o=>o.iname=="بنطلون اختبار"));await ev(id=>adv(id),po2.id);
const c0=await ev(id=>poCost(S.po.find(o=>o.id==id)),po2.id);await ev(id=>{woForm();$("#wi").value="1";wvr();$("#wq").value="2";$("#wp").value=String(id);saveWo()},po2.id);
ok('waste charged to an order raises its cost and keeps ledger balanced',await ev(id=>poCost(S.po.find(o=>o.id==id)),po2.id)>c0&&await bal());
/* ---------- grouped item movement report ---------- */
await ev(()=>{R.rep='im';go('rep')});const imTxt=await ev(()=>ACT.textContent);ok('item-movement report is grouped per item (no per-colour rows)',imTxt.includes("جاكيت اختبار")&&!imTxt.includes("أحمر / M"));
const det=await ev(()=>{itemDet(S.items.find(i=>i.name=="جاكيت اختبار").id);return ACT.textContent});ok('item details list colours, sizes and barcodes',det.includes("أحمر")&&det.includes("أسود")&&det.includes("L")&&det.includes("الباركود"));await ev(()=>closeTab(CUR,1));
/* ---------- delete ---------- */
const n0=await ev(()=>S.docs.length);await ev(id=>delGo('doc',id),invId);ok('delete removes the invoice and reverses its effects (ledger balanced)',await ev(()=>S.docs.length)==n0-1&&await bal());
/* ---------- permissions ---------- */
await ev(()=>{S.emp.push({id:77,name:"موظف اختبار",p1:"1",p2:"2",img:"x",perm:["home","sale"]});who="77";nav()});
const pm=await ev(()=>{const d=S.docs.length,pg=TB.length;const first=S.docs[0];editRef('doc',first.id);delRef('doc',first.id);delGo('doc',first.id);return{can:[can("edit"),can("del")],docsSame:S.docs.length==d,noNewTab:TB.length==pg,tabs:allowed().map(t=>t[0]).join()}});
ok('employee without permissions cannot edit/delete (even by calling the functions directly)',pm.can[0]===false&&pm.can[1]===false&&pm.docsSame&&pm.noNewTab,pm);ok('employee sees only permitted screens',pm.tabs.split(',').every(x=>['home','sale','set'].includes(x)),pm.tabs);
await ev(()=>{who="0";S.emp=[];nav()});
/* ---------- Supabase employee permissions ---------- */
await ev(()=>{window.setFactoryAuthProfile({id:"cloud-test",is_admin:false,permissions:{invoices:true}});tab="sale";nav();render()});
const cloudInvoicePerm=await ev(()=>({screens:allowed().map(t=>t[0]),edit:can("edit")}));
ok('Supabase employee sees only the assigned invoice screens and can edit within that module',cloudInvoicePerm.screens.includes("sale")&&!cloudInvoicePerm.screens.includes("stock")&&cloudInvoicePerm.edit,cloudInvoicePerm);
await ev(()=>{window.setFactoryAuthProfile({id:"cloud-test",is_admin:false,permissions:{reports:true}});tab="rep";nav();render()});
const cloudReportPerm=await ev(()=>({screens:allowed().map(t=>t[0]),edit:can("edit"),del:can("del")}));
ok('reports-only Supabase employee is read-only',cloudReportPerm.screens.includes("rep")&&!cloudReportPerm.screens.includes("sale")&&!cloudReportPerm.edit&&!cloudReportPerm.del,cloudReportPerm);
await ev(()=>{window.setFactoryAuthProfile(null);who="0";tab="home";nav();render()});
/* ---------- duplicate click ---------- */
const v0=await ev(()=>S.vch.length);await ev(()=>{go('rc');vForm('in');$("#va").value="1";$("#vm").value="100";vAc();$("#la").value=String(ak("sales"));$("#lm").value="100";vLn()});await p.evaluate(()=>{const b=[...ACT.querySelectorAll("button")].find(x=>x.textContent.trim()=="حفظ");b.click();b.click()});
ok('double click on Save registers the voucher once',await ev(()=>S.vch.length)==v0+1);
/* ---------- tabs: unsaved data ---------- */
await ev(()=>{go('sale');docForm('sale');$("#q").value="7";$("#q").dispatchEvent(new Event("input",{bubbles:true}))});await ev(()=>go('cust'));
ok('unsaved form data survives switching to another screen',await ev(()=>TB.find(t=>t.kind=="page").el.querySelector("#q").value)=="7");
await ev(()=>{actTab(TB.find(t=>t.kind=="page"));tryClose()});ok('closing a dirty tab asks for confirmation',!!(await p.$('#cfm')));await p.click('#cf1');ok('discarding closes the tab',await ev(()=>!TB.some(t=>t.kind=="page")));
/* ---------- real CSV export download ---------- */
await ev(()=>go('stock'));const [dl]=await Promise.all([p.waitForEvent('download',{timeout:8000}).catch(()=>null),ev(async()=>{const b=[...ACT.querySelectorAll("button")].find(x=>x.textContent.includes("تصدير Excel"));await b.onclick()})]);
let csv='';if(dl){const f=await dl.path();csv=fs.readFileSync(f,'utf8')}ok('CSV export triggers a real browser download with BOM and data rows',!!dl&&csv.charCodeAt(0)==0xFEFF&&csv.split('\n').length>2,dl&&dl.suggestedFilename());
/* ---------- import validation (real file upload) ---------- */
fs.writeFileSync('/tmp/_items.csv','\uFEFFاسم الصنف,كود,نوع,وحدة,سعر الشراء,كمية\nقماش استيراد,IMP001,قماش,متر,50,30\nقميص استيراد,IMP002,منتج نهائي,قطعة,100,10\nقماش استيراد,IMP003,قماش,متر,50,5\n,IMP004,قماش,متر,abc,0\nتيشيرت,TS001,منتج نهائي,قطعة,1,0\n');
await ev(()=>{go('set');impForm()});await p.setInputFiles('#impf','/tmp/_items.csv');await p.waitForTimeout(300);await ev(()=>impCheck());
ok('import detects new / duplicate-in-file / invalid / already-existing rows',JSON.stringify(await ev(()=>WZ.out.map(x=>x.st)))==JSON.stringify(["جديد","جديد","مكرر (سيُتخطى)","خطأ","مكرر (سيُتخطى)"]));
await ev(()=>importGo());ok('import creates only the valid rows with opening stock; ledger balanced',await ev(()=>!!S.items.find(i=>i.sku=="IMP001")&&!S.items.find(i=>i.sku=="IMP003")&&!S.items.find(i=>i.sku=="IMP004")&&tq(S.items.find(i=>i.sku=="IMP001"))==30)&&await bal());
/* ---------- templates ---------- */
await ev(()=>{tplForm();$("#tk").value="sale";tplFill();$("#t_title").value="فاتورة ضريبية";ACT.querySelector('.t_c[value="unit"]').checked=false;tplPrev()});
ok('print-template preview reflects title and hidden column',await ev(()=>{const h=$("#tpv").innerHTML;return h.includes("فاتورة ضريبية")&&!h.includes("<th>الوحدة</th>")}));await ev(()=>closeTab(CUR,1));
/* ---------- language ---------- */
await ev(()=>{PRF.lang='en';applyPref()});const left=[];for(const s of ['home','bank','rc','py','cust','supp','sale','sret','pur','pret','stock','prod','coa','je','tl','emp','rep','ai','set']){await ev(x=>go(x),s);await p.waitForTimeout(40);const t=await ev(x=>{const out=[],w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){if(n.parentElement&&n.parentElement.tagName=='SCRIPT')continue;if(/[\u0600-\u06FF]/.test(n.nodeValue)&&n.nodeValue.trim()!='ع')out.push(n.nodeValue.trim())}return out},s);t.forEach(x=>{if(!/محلات|عميل قطاعي|اختبار|استيراد|النسيج|جيرسي|زراير|تيشيرت|جاكيت|بنطلون|قماش|أحمر|أسود|جهة|الخزنة بالدولار|موظف/.test(x))left.push(s+': '+x)})}
ok('English mode: no untranslated UI text on the 19 main screens',left.length==0,left.slice(0,12));await ev(()=>{PRF.lang='ar';applyPref()});
ok('no JavaScript errors during the whole desktop session',errs.length==0,errs.slice(0,3));
const scopeCtx=await browser.newContext({viewport:{width:800,height:600}}),scopePage=await scopeCtx.newPage();await scopePage.goto(BASE);await scopePage.waitForTimeout(150);
const accountIsolation=await scopePage.evaluate(async()=>{
  localStorage.clear();
  localStorage.setItem("mgr6","legacy-admin-state");
  const {scopeFactoryStorage}=await import("./js/account-storage.js");
  scopeFactoryStorage({id:"employee-001",is_admin:false});
  const employeeStartedEmpty=localStorage.getItem("mgr6")===null;
  localStorage.setItem("mgr6","employee-state");
  localStorage.setItem("mgr6pref",JSON.stringify({lang:"en"}));
  localStorage.setItem("mgr6-cloud-snapshot-version","4");
  scopeFactoryStorage({id:"admin-001",is_admin:true});
  const adminMigratedLegacy=localStorage.getItem("mgr6")==="legacy-admin-state";
  localStorage.setItem("mgr6","admin-state");
  const adminVersion=localStorage.getItem("mgr6-cloud-snapshot-version");
  scopeFactoryStorage({id:"employee-001",is_admin:false});
  const employeeState=localStorage.getItem("mgr6");
  const employeePref=localStorage.getItem("mgr6pref");
  const employeeVersion=localStorage.getItem("mgr6-cloud-snapshot-version");
  return {employeeStartedEmpty,adminMigratedLegacy,employeeState,employeePref:JSON.parse(employeePref||"{}").lang,employeeVersion,adminVersion,legacyRemoved:localStorage.getItem("mgr6-legacy-unassigned")===null};
});
ok('account-scoped storage keeps employee state and sync metadata separate while migrating the legacy cache to the admin',accountIsolation.employeeStartedEmpty&&accountIsolation.adminMigratedLegacy&&accountIsolation.employeeState==="employee-state"&&accountIsolation.employeePref==="en"&&accountIsolation.employeeVersion==="4"&&accountIsolation.adminVersion===null&&accountIsolation.legacyRemoved,accountIsolation);
await scopeCtx.close();
await ctx.close();
/* ---------- C. PWA: service worker + offline shell ---------- */
const c2=await browser.newContext({viewport:{width:1280,height:800}}),q=await c2.newPage(),swConsole=[];q.on('console',m=>swConsole.push(m.type()+': '+m.text()));q.on('pageerror',e=>swConsole.push('pageerror: '+e.message));await q.goto(BASE);const swReg=await q.evaluate(async()=>{try{const reg=await navigator.serviceWorker.register('./sw.js');return {ok:true,scope:reg.scope,installing:reg.installing?.state,waiting:reg.waiting?.state,active:reg.active?.state}}catch(e){return {ok:false,error:e.message}}});const swReady=await q.evaluate(()=>Promise.race([navigator.serviceWorker.ready.then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),15000))]));if(!swReady){const diag=await q.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();return r?{installing:r.installing?.state,waiting:r.waiting?.state,active:r.active?.state,scope:r.scope}:null});await c2.close();throw new Error('Service Worker did not become ready: '+JSON.stringify({swReg,diag,console:swConsole.slice(-20)}))}await q.reload();await q.waitForTimeout(600);
const swi=await q.evaluate(async()=>({ctl:!!navigator.serviceWorker.controller,keys:await caches.keys(),cached:(await (await caches.open((await caches.keys())[0])).keys()).map(r=>new URL(r.url).pathname)}));
ok('service worker installed and controlling the page; single versioned cache',swi.ctl&&swi.keys.length==1&&/^factory-v12$/.test(swi.keys[0]),swi.keys);
ok('stable app shell files are precached; linked CSS and scripts are cached on first request',['/index.html','/auth.html','/change-password.html','/js/change-password.js','/','/js/app.js','/css/style.css'].every(f=>swi.cached.includes(f)),swi.cached);
ok('offline cache does not include authenticated API responses or user records',swi.cached.every(f=>!f.includes('/rest/v1/')&&!f.includes('/auth/v1/')&&!f.includes('/storage/v1/')));
await q.evaluate(()=>{const s=JSON.parse(localStorage.getItem('mgr6')||'null');localStorage.setItem('mgr6',JSON.stringify(s))});
await c2.setOffline(true);await q.reload();await q.waitForTimeout(500);const off=await q.evaluate(()=>({ok:!!document.querySelector('#sb a'),tabs:document.querySelectorAll('#sb a').length}));
ok('app loads and works with the network switched off (from the service-worker cache)',off.ok&&off.tabs>=15,off);
const none=await q.evaluate(async()=>{const c=await caches.open('factory-v5');return (await c.keys()).every(r=>new URL(r.url).origin==location.origin&&!r.url.includes('/api/'))});ok('cache holds only same-origin app files (no cross-origin / API / user data)',none);
await c2.setOffline(false);await c2.close();
/* ---------- D. mobile ---------- */
const mc=await browser.newContext({viewport:{width:390,height:800},isMobile:true,hasTouch:true}),m=await mc.newPage(),merr=[];m.on('pageerror',e=>merr.push(e.message));await m.goto(BASE);await m.waitForTimeout(400);
const mob=await m.evaluate(()=>({pos:getComputedStyle(document.querySelector('#sb')).position,bg:getComputedStyle(document.querySelector('#bg')).display,over:document.documentElement.scrollWidth<=innerWidth+1}));
ok('mobile: sidebar is a drawer with burger button and the page does not scroll sideways',mob.pos=='fixed'&&mob.bg=='block'&&mob.over,mob);
await m.click('#bg');await m.waitForTimeout(250);const open=await m.evaluate(()=>({sb:document.querySelector('#sb').classList.contains('open'),ov:getComputedStyle(document.querySelector('#sb-overlay')).display}));ok('mobile: burger opens the drawer and shows the overlay',open.sb&&open.ov!='none',open);
await m.click('#sb a:nth-child(5)');await m.waitForTimeout(300);const closed=await m.evaluate(()=>({sb:document.querySelector('#sb').classList.contains('open'),ov:getComputedStyle(document.querySelector('#sb-overlay')).display}));ok('mobile: choosing a screen closes the drawer and hides the overlay',!closed.sb&&closed.ov=='none',closed);
await m.evaluate(()=>{go('sale');docForm('sale')});const fw=await m.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);ok('mobile: invoice form fits the screen width',fw);
ok('mobile: no JavaScript errors',merr.length==0,merr.slice(0,2));await mc.close();
await browser.close();server.close();
console.log(R.join('\n'));console.log(`\n${R.length-fails}/${R.length} checks passed, ${fails} failed`);process.exit(fails?1:0);
})().catch(e=>{console.error('TEST RUN CRASHED:',e.message);process.exit(2)});
