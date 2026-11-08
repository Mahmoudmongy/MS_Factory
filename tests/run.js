/* Real browser tests: they load the actual index.html / js/app.js / sw.js through a local static server
 * and exercise the real functions. No mocks of app logic. Exit code != 0 if any check fails.
 * Run: npm test   (requires: npm install  -> playwright)                                         */
const http=require('http'),fs=require('fs'),path=require('path');let pw;try{pw=require('playwright')}catch(e){console.error('playwright is not installed. Run: npm install && npx playwright install chromium');process.exit(2)}
const ROOT=path.join(__dirname,'..'),MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.md':'text/plain'};
const server=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u.endsWith('/'))u+='index.html';if(u==='/index.html'){let html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');html=html.replace('<style>html{visibility:hidden}</style>','');html=html.replace(/<script type="module">[\s\S]*?<\/script>/,'');html=html.replace('<script type="module" src="./js/cloud-sync.js"></script>','');r.writeHead(200,{'Content-Type':'text/html'});r.end(html);return}const f=path.join(ROOT,u);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end('nf');return}r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r)});
const R=[];let fails=0;const ok=(n,c,x)=>{R.push(`${c?'PASS':'FAIL'}  ${n}${x!==undefined?'  => '+(typeof x=='object'?JSON.stringify(x):x):''}`);if(!c)fails++};
(async()=>{
await new Promise(r=>server.listen(0,r));const BASE='http://localhost:'+server.address().port+'/';
const browser=await pw.chromium.launch();
/* ---------- A. static checks on the real files ---------- */
const app=fs.readFileSync(path.join(ROOT,'js/app.js'),'utf8'),idx=fs.readFileSync(path.join(ROOT,'index.html'),'utf8'),cloud=fs.readFileSync(path.join(ROOT,'js/cloud-sync.js'),'utf8'),css=fs.readFileSync(path.join(ROOT,'css/style.css'),'utf8');
const names=[...app.matchAll(/^(?:async )?function ([A-Za-z0-9_$]+)\(/gm)].map(m=>m[1]),dup=[...new Set(names.filter((n,i)=>names.indexOf(n)!==i))];
ok('app.js has no duplicate top-level function definitions',dup.length==0,dup);
ok('conditional form values and descriptions are escaped, not inserted as HTML',/escapeHTML\(p\?p\.name/.test(app)&&/escapeHTML\(pre\.desc/.test(app)&&/escapeHTML\(v\.split/.test(app));
ok('HTML text and attribute values are escaped before rendering user-controlled fields',/const escapeHTML =/.test(app)&&/escapeHTML\(p\.name\)/.test(app)&&/escapeHTML\(x\.name\)/.test(app)&&/escapeHTML\(S\.name\)/.test(app));
ok('image URLs are restricted to safe image, HTTPS, relative or blob sources',/const safeImageSrc =/.test(app)&&/safeImageSrc\(s\)/.test(app));
ok('customer/supplier rows expose permission-gated edit actions',app.includes('pForm(${c},${p.id})')&&app.includes('can("edit")'));
ok('partner edit preserves the stable record ID and updates the existing object',app.includes('function saveP(id)')&&app.includes('if(old)Object.assign(old,data)'));
ok('employee edit preserves the existing employee record',app.includes('function saveE(id)')&&app.includes('if(old)Object.assign(old,data)'));
ok('warehouse names can be edited without replacing warehouse IDs',app.includes('function saveWh(id)')&&app.includes('w.name=n'));
ok('chart-of-account names can be edited while preserving their account IDs',app.includes('function saveAccName(id)')&&app.includes('a.name=n'));
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
ok('offline saves are durably queued and retried on reconnect, focus and visibility',/mgr6-sync-pending/.test(cloud)&&/function markPendingSync/.test(cloud)&&/function scheduleAutoSync/.test(cloud)&&/addEventListener\("online", \(\) => \{ retryCount = 0; scheduleAutoSync\(500\); \}\)/.test(cloud)&&/addEventListener\("focus"/.test(cloud)&&/visibilitychange/.test(cloud)&&/scheduleAutoSync\(1500\)/.test(cloud));
ok('sync toolbar is removed but conflict recovery remains reachable from the connection indicator',!app.includes('["🔄 حالة الاتصال والمزامنة","syncPage()"]')&&/id="net" onclick="syncPage\(\)"/.test(idx)&&/ms-logout-btn/.test(cloud)&&!/cloud-badge|رفع الآن|Upload Now|تحميل/.test(cloud.slice(cloud.indexOf('function drawAll()'))));

ok('invoice cloud sync uses the atomic versioned RPC',/rpc\(["']sync_invoice["']/.test(cloud)&&/p_expected_version/.test(cloud)&&/sync_version/.test(cloud));
ok('inventory sync uploads the actual S.items array used by the stock screens',/for \(const arr of \[S\.items, S\.products, S\.prods\]\)/.test(cloud));
ok('inventory sync totals all colour/size variants instead of reading a missing qty field',/Object\.values\(variants\)\.reduce/.test(cloud)&&/const variants = pr\.st/.test(cloud));
ok('inventory sync stores the full local item in products.raw for lossless restoration',/image_url:[\s\S]{0,500}raw: pr/.test(cloud));
ok('inventory download restores records into S.items, the real inventory source used by the app',/if \(!Array\.isArray\(S\.items\)\) S\.items = \[\]/.test(cloud)&&/S\.items = m\.arr/.test(cloud));
ok('employee detail-only sync remains marked partial in the background',/admin \? "synced" : "partial"/.test(cloud)&&/مزامنة القيود والحركات المحاسبية الكاملة لحساب الموظف لم تكتمل بعد/.test(cloud));
ok('production-only employees can upload and pull their production orders',/if \(!admin && !\["customers", "suppliers", "invoices", "inventory", "production"\]\.some\(canWrite\)\)/.test(cloud)&&/if \(canWrite\("production"\)\)/.test(cloud)&&/if \(!\["customers","suppliers","invoices","inventory","production","reports"\]\.some\(canRead\)\)/.test(cloud));
const detailSyncMigration=fs.readFileSync(path.join(ROOT,'supabase/migrations/20261108000100_atomic_versioned_factory_detail_sync.sql'),'utf8');
ok('returns, vouchers and production orders use the atomic versioned detail RPC',/rpc\(["']sync_factory_detail["']/.test(cloud)&&/p_expected_version/.test(cloud)&&/sync_version/.test(cloud));
ok('detail sync reads server versions and preserves stale-cloud copies as explicit conflicts',/remoteVersion > localVersion/.test(cloud)&&/serverCopy: remote/.test(cloud)&&/d\._cloudVersion = Number\(result\.row\.sync_version\)/.test(cloud)&&/v\._cloudVersion = Number\(result\.row\.sync_version\)/.test(cloud)&&/o\._cloudVersion = Number\(result\.row\.sync_version\)/.test(cloud));
ok('detail sync SQL enforces compare-and-swap and module-specific permissions',/SECURITY INVOKER/.test(detailSyncMigration)&&/FOR UPDATE/.test(detailSyncMigration)&&/40001/.test(detailSyncMigration)&&/private\.can_access_factory_owner\(v_owner_id, v_permission, true\)/.test(detailSyncMigration));

ok('invoice sync does not delete invoice items through separate client requests',!/from\(["']invoice_items["']\)\.delete/.test(cloud));
ok('returns are not misclassified as sale/purchase invoices',/\["sale", "pur"\]\.includes\(d\.t\)/.test(cloud));
ok('cloud invoice merge preserves newer remote copies as explicit conflicts',/mergeCloudInvoices/.test(cloud)&&/serverCopy: remote/.test(cloud));
ok('online reconnect pulls remote changes before uploading local cache',/const pulled = await loadFromTablesMerge\(true\)/.test(cloud)&&cloud.indexOf('const pulled = await loadFromTablesMerge(true)')<cloud.indexOf('const pushed = await uploadToTables(false)'));
ok('online startup sync runs even when local cache already has data',/if \(navigator\.onLine\) \{\s*\/\/ Always refresh remote data on launch/.test(cloud)&&/scheduleAutoSync\(1200\)/.test(cloud));
ok('offline boot permits only a previously verified cached profile for the same user',/factory-profile:/.test(idx)&&/cachedProfile\.id === data\.session\.user\.id/.test(idx)&&/if \(!navigator\.onLine\)/.test(idx));
ok('reconnect refreshes the profile before using permissions for cloud sync',/myProfile = null; ownerIdCache = null; window\.__factoryAuthProfile = null;/.test(cloud)&&/const freshProfile = await getMyProfile\(\)/.test(cloud));

ok('offline shell precaches the stable production app and first-login password page',/auth\.html/.test(sw)&&/change-password\.html/.test(sw)&&/js\/change-password\.js/.test(sw)&&/js\/app\.js/.test(sw)&&/factory-v10/.test(sw));
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
ok('offline service worker pre-caches Vite module assets discovered from the HTML shell',/matchAll\(\/\(\?:src\|href\)/.test(sw)&&/modulepreload/.test(idx+sw)&&/factory-v10/.test(sw));


ok('invoice sync migration uses optimistic version checks and invoker security',/sync_version/.test(fs.readFileSync(path.join(ROOT,'supabase/migrations/20261107090901_20261107111000_atomic_invoice_sync.sql'),'utf8'))&&/SECURITY INVOKER/.test(fs.readFileSync(path.join(ROOT,'supabase/migrations/20261107090901_20261107111000_atomic_invoice_sync.sql'),'utf8'))&&/40001/.test(fs.readFileSync(path.join(ROOT,'supabase/migrations/20261107090901_20261107111000_atomic_invoice_sync.sql'),'utf8')));
ok('full factory snapshots use optimistic versioned RPC writes instead of blind upserts',/rpc\(["']sync_factory_state["']/.test(cloud)&&/p_expected_version/.test(cloud)&&/40001/.test(fs.readFileSync(path.join(ROOT,'supabase/migrations/20261107155417_version_factory_state_snapshot.sql'),'utf8')));
ok('internal snapshot and trigger RPC helpers explicitly revoke anonymous execution',/REVOKE ALL ON FUNCTION public\.sync_factory_state\(integer, jsonb\) FROM anon/.test(fs.readFileSync(path.join(ROOT,'supabase/migrations/20261107160145_revoke_anon_rpc_execute.sql'),'utf8'))&&/REVOKE ALL ON FUNCTION public\.touch_transaction_detail_updated_at\(\) FROM anon/.test(fs.readFileSync(path.join(ROOT,'supabase/migrations/20261107160145_revoke_anon_rpc_execute.sql'),'utf8')));
ok('cross-device snapshot conflicts preserve local data and offer an explicit backed-up cloud restore',/mgr6-cloud-snapshot-conflict/.test(cloud)&&/window\.resolveCloudSnapshotConflict/.test(cloud)&&/resolveCloudSnapshotConflict\(\)/.test(app));
ok('return invoices are uploaded and restored through the atomic versioned RPC',/syncVersionedDetail\(["']returns["']/.test(cloud)&&/cloudReturns/.test(cloud)&&/mergeCloudRecords/.test(cloud));
ok('cash receipt/payment vouchers are uploaded and restored with full raw details through the atomic versioned RPC',/syncVersionedDetail\(["']vouchers["']/.test(cloud)&&/cloudVouchers/.test(cloud));
ok('production orders are uploaded and restored with breakdown, cost and status through the atomic versioned RPC',/syncVersionedDetail\(["']production_orders["']/.test(cloud)&&/cloudOrders/.test(cloud));
ok('return, voucher and production records preserve server versions and timestamps for conflict detection',/function mergeCloudRecords/.test(cloud)&&/remoteVersion > localVersion/.test(cloud)&&/result\.row\.updated_at/.test(cloud)&&/copy\._cloudVersion = Number\(remote\.sync_version/.test(cloud));
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
await ctx.close();
/* ---------- C. PWA: service worker + offline shell ---------- */
const c2=await browser.newContext({viewport:{width:1280,height:800}}),q=await c2.newPage(),swConsole=[];q.on('console',m=>swConsole.push(m.type()+': '+m.text()));q.on('pageerror',e=>swConsole.push('pageerror: '+e.message));await q.goto(BASE);const swReg=await q.evaluate(async()=>{try{const reg=await navigator.serviceWorker.register('./sw.js');return {ok:true,scope:reg.scope,installing:reg.installing?.state,waiting:reg.waiting?.state,active:reg.active?.state}}catch(e){return {ok:false,error:e.message}}});const swReady=await q.evaluate(()=>Promise.race([navigator.serviceWorker.ready.then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),15000))]));if(!swReady){const diag=await q.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();return r?{installing:r.installing?.state,waiting:r.waiting?.state,active:r.active?.state,scope:r.scope}:null});await c2.close();throw new Error('Service Worker did not become ready: '+JSON.stringify({swReg,diag,console:swConsole.slice(-20)}))}await q.reload();await q.waitForTimeout(600);
const swi=await q.evaluate(async()=>({ctl:!!navigator.serviceWorker.controller,keys:await caches.keys(),cached:(await (await caches.open((await caches.keys())[0])).keys()).map(r=>new URL(r.url).pathname)}));
ok('service worker installed and controlling the page; single versioned cache',swi.ctl&&swi.keys.length==1&&/^factory-v10$/.test(swi.keys[0]),swi.keys);
ok('stable app shell files are precached; linked CSS and scripts are cached on first request',['/index.html','/auth.html','/change-password.html','/js/change-password.js','/','/js/app.js','/css/style.css'].every(f=>swi.cached.includes(f)),swi.cached);
ok('offline cache does not include authenticated API responses or user records',swi.cached.every(f=>!f.includes('/rest/v1/')&&!f.includes('/auth/v1/')&&!f.includes('/storage/v1/')));
await q.evaluate(()=>{const s=JSON.parse(localStorage.getItem('mgr6')||'null');localStorage.setItem('mgr6',JSON.stringify(s))});
await c2.setOffline(true);await q.reload();await q.waitForTimeout(500);const off=await q.evaluate(()=>({ok:!!document.querySelector('#sb a'),tabs:document.querySelectorAll('#sb a').length}));
ok('app loads and works with the network switched off (from the service-worker cache)',off.ok&&off.tabs>=15,off);
const none=await q.evaluate(async()=>{const c=await caches.open('factory-v10');const keys=await c.keys();return keys.length>0&&keys.every(r=>new URL(r.url).origin==location.origin&&!r.url.includes('/rest/v1/')&&!r.url.includes('/auth/v1/')&&!r.url.includes('/storage/v1/'))});ok('active factory-v10 cache holds only same-origin app files (no authenticated API or user data)',none);
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
