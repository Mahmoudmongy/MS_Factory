/* Production PDF regression: real inv -> ppage -> docPrintHtml -> pw -> #pr -> mkPdf.
 * Uses synthetic in-memory data only; no persistence or database writes.
 * Requires Chromium via Playwright and network access to the same CDN libraries used by production.
 */
const http=require('http'),fs=require('fs'),path=require('path');
let playwright;
try{playwright=require('playwright')}catch(error){console.error('Playwright is required. Install project dependencies first.');process.exit(2)}
const ROOT=path.join(__dirname,'..');
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};
const server=http.createServer((request,response)=>{
 let url=decodeURIComponent(request.url.split('?')[0]);
 if(url.endsWith('/'))url+='index.html';
 if(url==='/index.html'){
  let html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  html=html.replace(/<style>html\{visibility:visible\}#app\{visibility:hidden\}<\/style>/,'');
  html=html.replace(/<div id="factory-boot-screen"[\s\S]*?<\/div>\s*<\/div>/,'');
  html=html.replace(/<script type="module">[\s\S]*?<\/script>/,'');
  html=html.replace('<script type="module" src="./js/cloud-sync.js"></script>','');
  html=html.replace('<script type="module" src="./js/database-first.js"></script>','');
  html=html.replace('<script type="module" src="./js/manager-history.js"></script>','');
  response.writeHead(200,{'Content-Type':'text/html'});response.end(html);return;
 }
 const file=path.join(ROOT,url);
 if(!file.startsWith(ROOT)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){response.writeHead(404);response.end('not found');return}
 response.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(response);
});
(async()=>{
 await new Promise(resolve=>server.listen(0,resolve));
 const browser=await playwright.chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
 try{
  await page.goto('http://127.0.0.1:'+server.address().port+'/');
  await page.waitForTimeout(500);
  const result=await page.evaluate(async()=>{
   const originalDocs=S.docs,originalPartners=S.partners,oldPartyName=window.__pdfPartyName;
   const originalRoute={ppage:window.ppage,docPrintHtml:window.docPrintHtml,pw:window.pw},routeCalls={ppage:0,docPrintHtml:0,pw:0};
   const priorFpages=new Set(document.querySelectorAll('.fpage'));
   const fixtureId='PDFQA'+Date.now(),partnerId='PDFQAPARTNER'+Date.now(),fixtureCount=72;
   const partner={id:partnerId,name:'PDF QA Synthetic Partner',phone:'',c:1,s:0,type:'w',gov:'',city:'',adr:''};
   const lines=Array.from({length:fixtureCount},(_,index)=>({
    name:'ITEM'+String(index+1).padStart(3,'0'),
    v:'RED / XL',unit:'piece',qty:2,price:125,
    note:'NOTE'+String(index+1).padStart(3,'0')+' detailed line description'
   }));
   const total=lines.reduce((sum,line)=>sum+line.qty*line.price,0);
   const fixture={id:fixtureId,no:fixtureId,t:'sale',date:td(),ts:Date.now(),pid:partnerId,lines,disc:0,gross:total,total,note:'QATOTAL'+total};
   let originalCapture=null,captureCanvas=null,captureMeta=null;
   try{
    S.partners=[...originalPartners,partner];
    S.docs=[...originalDocs,fixture];
    window.ppage=function(...args){routeCalls.ppage++;return originalRoute.ppage.apply(this,args)};
    window.docPrintHtml=function(...args){routeCalls.docPrintHtml++;return originalRoute.docPrintHtml.apply(this,args)};
    window.pw=function(...args){routeCalls.pw++;return originalRoute.pw.apply(this,args)};
    inv(fixtureId);
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const printNode=document.querySelector('#pr');
    if(!printNode)throw new Error('The real inv() route did not create #pr through ppage()');
    const domRows=[...printNode.querySelectorAll('tr')].filter(row=>row.querySelector('td'));
    const domText=printNode.innerText||'';
    const expected=lines.map((line,index)=>({item:'ITEM'+String(index+1).padStart(3,'0'),note:'NOTE'+String(index+1).padStart(3,'0')+' detailed line description'}));
    const ancestors=[];
    for(let node=printNode;node;node=node.parentElement){
     const css=getComputedStyle(node),rect=node.getBoundingClientRect();
     ancestors.push({tag:node.tagName,id:node.id,cls:String(node.className||'').slice(0,90),height:rect.height,scrollHeight:node.scrollHeight,clientHeight:node.clientHeight,cssHeight:css.height,maxHeight:css.maxHeight,overflow:css.overflow,overflowY:css.overflowY});
    }
    const before={
     rowCount:domRows.length,firstRow:domRows[0]?.innerText||'',lastRow:domRows.at(-1)?.innerText||'',
     allFixtureItemsPresent:expected.every(row=>domRows.some(domRow=>domRow.innerText.includes(row.item)&&domRow.innerText.includes(row.note))),
     totalVisible:domText.includes('QATOTAL'+total),rootWidth:printNode.getBoundingClientRect().width,
     rootHeight:printNode.getBoundingClientRect().height,ancestors
    };
    if(before.rowCount!==fixtureCount||!before.allFixtureItemsPresent||!before.totalVisible)throw new Error('The production invoice DOM is incomplete before capture: '+JSON.stringify(before));
    await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';script.onload=resolve;script.onerror=()=>reject(new Error('Could not load production html2canvas 1.4.1 from CDN'));document.head.appendChild(script)});
    await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';script.onload=resolve;script.onerror=()=>reject(new Error('Could not load production jsPDF 2.5.1 from CDN'));document.head.appendChild(script)});
    if(typeof window.html2canvas!=='function'||typeof window.jspdf?.jsPDF!=='function')throw new Error('Real html2canvas/jsPDF globals are unavailable');
    originalCapture=window.html2canvas;
    window.html2canvas=async(...args)=>{
     const node=args[0],rect=node.getBoundingClientRect(),header=[...node.querySelectorAll('tr')].find(row=>row.querySelector('th'));
     const captureAncestors=[];for(let current=node;current;current=current.parentElement){const style=getComputedStyle(current),bounds=current.getBoundingClientRect();captureAncestors.push({tag:current.tagName,id:current.id,height:bounds.height,maxHeight:style.maxHeight,overflow:style.overflow,overflowY:style.overflowY})}captureMeta={targetIsProductionNode:node===printNode,rowsAtCapture:[...node.querySelectorAll('tr')].filter(row=>row.querySelector('td')).length,rootWidth:rect.width,rootHeight:rect.height,repeatHeaderCssHeight:header?header.getBoundingClientRect().bottom-rect.top:0,ancestors:captureAncestors,options:args[1]};
     captureCanvas=await originalCapture.apply(window,args);
     captureMeta.canvasWidth=captureCanvas.width;captureMeta.canvasHeight=captureCanvas.height;
     captureMeta.scaleX=captureCanvas.width/Math.max(1,rect.width);captureMeta.scaleY=captureCanvas.height/Math.max(1,rect.height);
     return captureCanvas;
    };
    const pdf=await mkPdf();
    window.html2canvas=originalCapture;
    if(!pdf||typeof pdf.output!=='function'||typeof pdf.addPage!=='function'||!captureCanvas||!captureMeta?.targetIsProductionNode)throw new Error('mkPdf did not use the real html2canvas capture and jsPDF document');
    const blob=pdf.output('blob');
    if(blob.size<10000)throw new Error('The generated PDF blob is unexpectedly small');
    const bytes=new Uint8Array(await blob.arrayBuffer()),signature=new TextDecoder().decode(bytes.slice(0,5));
    if(signature!=='%PDF-')throw new Error('The exported bytes are not a PDF file');
    await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';script.onload=resolve;script.onerror=()=>reject(new Error('Could not load PDF.js to inspect the generated PDF'));document.head.appendChild(script)});
    const parsed=await pdfjsLib.getDocument({data:bytes,disableWorker:true}).promise;
    const rendered=[],pageTexts=[],visualPages=[];
    for(let pageNo=1;pageNo<=parsed.numPages;pageNo++){
     const pdfPage=await parsed.getPage(pageNo),viewport=pdfPage.getViewport({scale:1.5}),canvas=document.createElement('canvas');
     canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
     await pdfPage.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
     rendered.push(canvas);
     const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
     let nonWhiteSamples=0;for(let i=0;i<pixels.length;i+=16)if(pixels[i]<245||pixels[i+1]<245||pixels[i+2]<245)nonWhiteSamples++;
     visualPages.push({page:pageNo,width:canvas.width,height:canvas.height,nonWhiteSamples});
    }
    await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';script.onload=resolve;script.onerror=()=>reject(new Error('Could not load Tesseract.js for PDF content verification'));document.head.appendChild(script)});
    const worker=await Tesseract.createWorker('eng');
    try{for(const canvas of rendered){const result=await worker.recognize(canvas);pageTexts.push(result.data.text||'')}}finally{await worker.terminate()}
    const extractMarkers=(texts,prefix)=>{
     const found=[];
     texts.forEach((text,pageIndex)=>{
      const compact=text.toUpperCase().replace(/\s+/g,'');
      const pattern=new RegExp(prefix+'([A-Z0-9]{2,5})','g');let match;
      while((match=pattern.exec(compact))){
       let digits=match[1].replace(/O/g,'0').replace(/S/g,'5').replace(/[^0-9]/g,'');
       if(digits.length>3)digits=digits.slice(-3);
       if(digits.length<3)digits=digits.padStart(3,'0');
       const number=Number(digits);if(number>=1&&number<=fixtureCount)found.push({number,page:pageIndex+1});
      }
     });
     return found;
    };
    const noteMarkers=extractMarkers(pageTexts,'NOTE'),itemMarkers=[];
    pageTexts.forEach((text,pageIndex)=>{for(const line of text.split(/\r?\n/)){if(!/ITEM/.test(line.toUpperCase()))continue;for(const marker of extractMarkers([line],'NOTE'))itemMarkers.push({number:marker.number,page:pageIndex+1})}});
    const expectedNumbers=Array.from({length:fixtureCount},(_,index)=>index+1);
    const numbers=markers=>markers.map(marker=>marker.number);

    const exactSequence=markers=>JSON.stringify(numbers(markers))===JSON.stringify(expectedNumbers);
    const itemByNumber=new Map(itemMarkers.map(marker=>[marker.number,marker.page]));
    const noteByNumber=new Map(noteMarkers.map(marker=>[marker.number,marker.page]));
    const rowsStayIntact=expectedNumbers.every(number=>itemByNumber.get(number)===noteByNumber.get(number)&&itemByNumber.has(number)&&noteByNumber.has(number));
    const combined=pageTexts.join('\n').toUpperCase().replace(/\s+/g,'');
    const totalOccurrences=(combined.match(new RegExp('QATOTAL'+total,'g'))||[]).length;
    const totalOnFinalPage=(pageTexts.at(-1)||'').toUpperCase().replace(/[^A-Z0-9]/g,'').includes('QATOTAL'+total);
    const headerTextRepeated=pageTexts.every(text=>text.includes('MS Factory'));
    const pageRows=pageTexts.map((_,index)=>new Set(noteMarkers.filter(marker=>marker.page===index+1).map(marker=>marker.number)).size);
    const repeatHeaderPx=Math.max(1,Math.ceil(captureMeta.repeatHeaderCssHeight*captureMeta.scaleX*rendered[0].width/captureCanvas.width));
    const referenceHeader=rendered[0].getContext('2d').getImageData(0,0,rendered[0].width,repeatHeaderPx).data;
    const headerPixelDiff=rendered.slice(1).map(canvas=>{
     const actual=canvas.getContext('2d').getImageData(0,0,canvas.width,repeatHeaderPx).data;let totalDiff=0,samples=0;
     for(let i=0;i<referenceHeader.length;i+=16){totalDiff+=Math.abs(referenceHeader[i]-actual[i])+Math.abs(referenceHeader[i+1]-actual[i+1])+Math.abs(referenceHeader[i+2]-actual[i+2]);samples++}
     return samples?totalDiff/(samples*3):999;
    });
    const missing=expectedNumbers.filter(number=>itemMarkers.filter(marker=>marker.number===number).length===0);
    const duplicates=expectedNumbers.filter(number=>itemMarkers.filter(marker=>marker.number===number).length!==1||noteMarkers.filter(marker=>marker.number===number).length!==1);
    return {
     before,routeCalls,capture:captureMeta,pdfBytes:blob.size,pdfSignature:signature,pdfApi:typeof pdf.output==='function'&&typeof pdf.addPage==='function'&&typeof pdf.addImage==='function',pdfPages:parsed.numPages,visualPages,
     itemMarkers:itemMarkers.length,noteMarkers:noteMarkers.length,missing,duplicates,
     itemSequenceExact:exactSequence(itemMarkers),noteSequenceExact:exactSequence(noteMarkers),rowsStayIntact,
     firstAndLastVisible:itemByNumber.has(1)&&itemByNumber.has(fixtureCount)&&noteByNumber.has(1)&&noteByNumber.has(fixtureCount),
     totalVisible:combined.includes('QATOTAL'+total),totalOccurrences,totalOnFinalPage,headerTextRepeated,pageRows,repeatHeaderPx,headerPixelDiff
    };
   }finally{
    if(originalCapture)window.html2canvas=originalCapture;
    window.ppage=originalRoute.ppage;window.docPrintHtml=originalRoute.docPrintHtml;window.pw=originalRoute.pw;
    S.docs=originalDocs;S.partners=originalPartners;window.__pdfPartyName=oldPartyName;
    for(const node of document.querySelectorAll('.fpage'))if(!priorFpages.has(node))node.remove();
   }
  });
  const valid=result.routeCalls.ppage===1&&result.routeCalls.docPrintHtml===1&&result.routeCalls.pw===1&&result.pdfApi&&result.pdfPages>=2&&result.visualPages.length===result.pdfPages&&result.before.rowCount===72&&result.before.allFixtureItemsPresent&&result.before.totalVisible&&result.capture.targetIsProductionNode&&result.capture.rowsAtCapture===72&&result.capture.scaleX>1.9&&result.capture.scaleX<2.1&&result.capture.scaleY>1.9&&result.capture.scaleY<2.1&&result.capture.rootHeight>result.capture.rootWidth*210/297*2&&result.capture.ancestors.every(a=>a.maxHeight==='none'&&!/(hidden|auto|scroll)/.test(a.overflow))&&result.itemMarkers===72&&result.noteMarkers===72&&result.missing.length===0&&result.duplicates.length===0&&result.itemSequenceExact&&result.noteSequenceExact&&result.rowsStayIntact&&result.firstAndLastVisible&&result.totalVisible&&result.totalOccurrences===1&&result.totalOnFinalPage&&result.headerTextRepeated&&result.headerPixelDiff.every(diff=>diff<12)&&result.visualPages.every(page=>page.nonWhiteSamples>1000);
  console.log(JSON.stringify({pass:valid,result,pageErrors},null,2));
  if(!valid||pageErrors.length)process.exitCode=1;
 }finally{await browser.close();server.close()}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;server.close()});










\n
