const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  const ext = path.extname(file);
  res.setHeader('Content-Type', ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : 'text/html');
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise(resolve => server.listen(0, resolve));
  const browser = await chromium.launch();
  const source = fs.readFileSync(path.join(ROOT, 'js/database-first.js'), 'utf8').replace(/\r\n/g, '\n');
  const start = source.indexOf('let conflictExportedInSession = false;');
  const end = source.indexOf("window.addEventListener('factory-database-ready', updateConflictExportButton);", start);
  if (start < 0 || end < 0) throw new Error('Conflict notice code block was not found.');
  const noticeCode = source.slice(start, end);

  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, acceptDownloads: true, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
    const page = await context.newPage();
    await page.goto('http://localhost:' + server.address().port + '/');
    const setup = await page.evaluate(code => {
      document.getElementById('factory-boot-error')?.remove();
      document.getElementById('factory-boot-screen')?.remove();
      window.__downloadCapture = null;
      window.__exportBlob = null;
      URL.createObjectURL = blob => { window.__exportBlob = blob; return 'blob:ms-factory-test'; };
      URL.revokeObjectURL = () => {};
      HTMLAnchorElement.prototype.click = function() {
        window.__downloadCapture = { href: this.href, download: this.download };
      };
      const queue = [{ id: 'queued-1', type: 'sale' }];
      const archives = [{ rejectedOperationCount: 1, rejectedOperations: [{ id: 'archived-1' }] }];
      localStorage.setItem('notice-test-queue', JSON.stringify(queue));
      localStorage.setItem('notice-test-archives', JSON.stringify(archives));
      const recovery = {
        readArchives: () => JSON.parse(localStorage.getItem('notice-test-archives')),
        hasBlock: () => true,
        getExportPayload: currentQueue => ({ archives: recovery.readArchives(), stillQueuedOperations: currentQueue })
      };
      const getQueue = () => JSON.parse(localStorage.getItem('notice-test-queue'));
      const run = new Function('ownerId', 'conflictWriteLock', 'conflictRecovery', 'getQueue', 'scopedKey', 'QUEUE_KEY', code);
      run('test-account', false, () => recovery, getQueue, key => key, 'notice-test-queue');
      return { visible: !document.getElementById('factory-conflict-export-notice').hidden };
    }, noticeCode);
    if (!setup.visible) throw new Error('Notice did not appear at viewport ' + viewport.width);

    await page.evaluate(() => document.getElementById('factory-conflict-export-close').click());
    await page.evaluate(() => window.dispatchEvent(new Event('factory-database-ready')));
    const dismissed = await page.locator('#factory-conflict-export-notice').evaluate(el => el.hidden);
    if (!dismissed) throw new Error('Manual close did not persist after UI refresh at viewport ' + viewport.width);

    await page.evaluate(() => window.dispatchEvent(new CustomEvent('factory-db-conflict', { detail: { message: 'new conflict' } })));
    if (await page.locator('#factory-conflict-export-notice').evaluate(el => el.hidden)) throw new Error('New conflict did not show the notice again.');

    await page.evaluate(() => document.getElementById('factory-conflict-export').click());
    const afterExport = await page.evaluate(async () => ({
      hidden: document.getElementById('factory-conflict-export-notice').hidden,
      queue: JSON.parse(localStorage.getItem('notice-test-queue')),
      archives: JSON.parse(localStorage.getItem('notice-test-archives')),
      download: window.__downloadCapture,
      blob: window.__exportBlob ? await window.__exportBlob.text() : ''
    }));
    if (!afterExport.download?.download?.endsWith('.json') || !afterExport.download.href.startsWith('blob:') ||
        !afterExport.blob.includes('queued-1') || !afterExport.blob.includes('archived-1')) {
      throw new Error('Export did not produce a JSON download containing all saved operations: ' + JSON.stringify(afterExport.download));
    }
    if (!afterExport.hidden || afterExport.queue[0]?.id !== 'queued-1' || afterExport.archives[0]?.rejectedOperations[0]?.id !== 'archived-1') {
      throw new Error('Successful export must hide the notice and preserve both queued and archived operations: ' + JSON.stringify(afterExport));
    }

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('factory-db-conflict', { detail: { message: 'failure simulation' } }));
      URL.createObjectURL = () => { throw new Error('simulated browser download failure'); };
    });
    await page.evaluate(() => document.getElementById('factory-conflict-export').click());
    const failure = await page.locator('#factory-conflict-export').textContent();
    const failureState = await page.locator('#factory-conflict-export-notice').evaluate(el => ({
      hidden: el.hidden,
      closeDisabled: document.getElementById('factory-conflict-export-close').disabled
    }));
    if (!failure.includes('تعذر التصدير') || failureState.hidden || !failureState.closeDisabled) {
      throw new Error('Export failure must remain visible with a clear reason: ' + JSON.stringify({ failure, failureState }));
    }

    const layout = await page.evaluate(() => {
      const notice = document.getElementById('factory-conflict-export-notice').getBoundingClientRect();
      return { viewport: innerWidth, scroll: document.documentElement.scrollWidth, left: notice.left, right: notice.right, width: notice.width };
    });
    if (layout.scroll > layout.viewport + 1 || layout.left < 0 || layout.right > layout.viewport + 1) {
      throw new Error('Notice layout overflows viewport: ' + JSON.stringify(layout));
    }
    console.log('PASS conflict export notice: ' + viewport.width + 'px — close, re-show, successful export, preservation, failure, responsive layout');
    await context.close();
  }
  await browser.close();
  server.close();
})().catch(error => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
