const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'css/preview-ui.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'js/preview-ui.js'), 'utf8');

assert(!css.includes('.factory-balance-row,.factory-recent-row{'), 'table rows must not share the flex card rule');
assert(ui.includes('class="factory-summary-recent-row" role="button" data-open-source=') && ui.includes("'.factory-summary-recent-row[role=\"button\"]'"), 'recent rows must use the table-specific accessible class');
assert(ui.includes("const recent=e.target.closest('[data-open-source]');if(recent){openRef(recent.dataset.openSource,recent.dataset.openId);return;}"), 'click must open the selected source and ID');
assert(ui.includes("event.target.closest?.('.factory-summary-recent-row[role=\"button\"]')") && ui.includes("event.key==='Enter'||event.key===' '") && ui.includes('openRef(row.dataset.openSource,row.dataset.openId)'), 'Enter and Space must open a focused recent row');
const fitterStart = app.indexOf('function factoryApplyFixedTableLayout(table){');
const fitterEnd = app.indexOf('const factoryEnhBeforeFixedLayout=enh;', fitterStart);
const fitter = app.slice(fitterStart, fitterEnd);
const summarySkip = fitter.slice(0, fitter.indexOf('const header='));
assert(summarySkip.includes("if(table?.classList?.contains('factory-summary-mini-table'))return;") && !summarySkip.includes('colgroup') && !summarySkip.includes('style.width'), 'generic table fitter must skip summary table before writing widths or colgroups');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [320, 390, 768, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
      await page.setContent('<!doctype html><html dir="rtl"><head><meta charset="utf-8"><style>:root{--pr:#0f766e;--pr2:#e5f4f1;--card:#fff;--tx:#17212b;--mu:#64748b;--bd:#d9e1e8;--bg:#f7f9fb}*{box-sizing:border-box}html,body{margin:0;width:100%;max-width:100%;font-family:Arial,sans-serif}main{width:100%;max-width:100%;padding:10px}.card{width:100%;min-width:0;padding:12px}.factory-table-scroll{width:100%;max-width:100%;overflow:auto}table.l{width:100%;display:block;overflow-x:auto;max-width:100%}</style><style>' + css + '</style></head><body><main><section class="card factory-summary-recent"><div class="factory-table-scroll factory-summary-table-scroll"><table class="l factory-summary-mini-table"><thead><tr><th>\u0627\u0644\u062a\u0627\u0631\u064a\u062e</th><th>\u0627\u0644\u0646\u0648\u0639</th><th>\u0627\u0644\u0645\u0631\u062c\u0639</th><th>\u0627\u0644\u0637\u0631\u0641</th><th>\u0627\u0644\u0645\u0628\u0644\u063a</th><th>\u0627\u0644\u062d\u0627\u0644\u0629</th></tr></thead><tbody>' + Array.from({length:6},(_,i)=>'<tr class="factory-summary-recent-row" role="button" data-open-source="doc" data-open-id="'+(100+i)+'" tabindex="0"><td>17/11/2026</td><td>\u0641\u0627\u062a\u0648\u0631\u0629 \u0645\u0628\u064a\u0639\u0627\u062a \u0646\u0642\u062f\u064a\u0629</td><td dir="ltr">INV-2026-000'+i+'</td><td>\u0634\u0631\u0643\u0629 \u0627\u0644\u0623\u0645\u0644 \u0644\u0644\u062a\u062c\u0627\u0631\u0629 \u0648\u0627\u0644\u0645\u0642\u0627\u0648\u0644\u0627\u062a</td><td class="factory-summary-amount" dir="ltr">125,450.75 \u062c.\u0645</td><td><span class="factory-chip">\u0645\u0633\u062f\u062f\u0629 \u062c\u0632\u0626\u064a\u0627</span></td></tr>').join('')+'</tbody></table></div></section></main></body></html>');
      const metrics = await page.evaluate(() => {
        const table=document.querySelector('table.factory-summary-mini-table');
        const wrapper=document.querySelector('.factory-summary-table-scroll');
        const head=[...table.tHead.rows[0].cells].map(x=>x.getBoundingClientRect().width);
        const rows=[...table.tBodies[0].rows];
        const cellWidths=rows.flatMap(r=>[...r.cells].map((c,i)=>({delta:Math.abs(c.getBoundingClientRect().width-head[i]),width:c.getBoundingClientRect().width})));
        return {tableDisplay:getComputedStyle(table).display,wrapperWidth:wrapper.getBoundingClientRect().width,wrapperScrollWidth:wrapper.scrollWidth,tableWidth:table.getBoundingClientRect().width,scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,rowDisplays:rows.map(r=>getComputedStyle(r).display),rowHeights:rows.map(r=>r.getBoundingClientRect().height),cellWidths};
      });
      assert.equal(metrics.tableDisplay,'table', 'table display at '+width+'px');
      assert(metrics.rowDisplays.every(x=>x==='table-row'), 'all six rows must compute to table-row at '+width+'px: '+metrics.rowDisplays.join(','));
      assert(metrics.cellWidths.every(x=>x.delta<=1.5), 'body cells must align with their header columns at '+width+'px; max delta '+Math.max(...metrics.cellWidths.map(x=>x.delta)));
      assert(metrics.rowHeights.every(x=>x>=28&&x<=80), 'row height must remain natural at '+width+'px: '+metrics.rowHeights.join(','));
      assert(metrics.scrollWidth<=metrics.clientWidth, 'dashboard table must not expand the page horizontally at '+width+'px ('+metrics.scrollWidth+' > '+metrics.clientWidth+')');
      assert(width<=480 ? metrics.tableWidth>=metrics.wrapperWidth-1 && metrics.wrapperScrollWidth>=metrics.tableWidth-1 : metrics.tableWidth<=metrics.wrapperWidth+1, 'table overflow must stay inside its own wrapper at '+width+'px');

      const interaction = await page.evaluate(() => {
        const calls=[];const openRef=(source,id)=>calls.push([source,id]);
        document.addEventListener('click',e=>{const recent=e.target.closest('[data-open-source]');if(recent){openRef(recent.dataset.openSource,recent.dataset.openId);return;}});
        const row=document.querySelector('tbody tr');row.click();
        const keyHandler=(event)=>{const targetRow=event.target.closest?.('.factory-summary-recent-row[role="button"]');if(targetRow&&(event.key==='Enter'||event.key===' ')){event.preventDefault();openRef(targetRow.dataset.openSource,targetRow.dataset.openId);}};
        document.addEventListener('keydown',keyHandler);row.focus();const enter=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});row.dispatchEvent(enter);const space=new KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true});row.dispatchEvent(space);
        return {calls,enterPrevented:enter.defaultPrevented,spacePrevented:space.defaultPrevented,tabIndex:row.tabIndex};
      });
      assert.deepEqual(interaction.calls,[['doc','100'],['doc','100'],['doc','100']], 'click, Enter and Space must open the selected record');
      assert.equal(interaction.enterPrevented,true);assert.equal(interaction.spacePrevented,true);assert.equal(interaction.tabIndex,0);
      console.log('PASS summary table '+width+'px: six rows, table-row display, aligned columns, natural height, no page overflow, click/Enter/Space');
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});

