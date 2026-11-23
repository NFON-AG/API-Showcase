'use strict';
// Optional real-Chrome suite. The application and provider are ephemeral, loopback-only fixtures.
// Run with Node 22; PLAYWRIGHT_MODULE_PATH/BROWSER_EXECUTABLE_PATH may override browser tooling.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {fixture}=require('./helpers/fixture.cjs');
const {isolatedBrowser}=require('../../CTI_API/test/helpers/browser-isolation.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const out=path.resolve(process.env.CANVAS_OUTPUT||'output/playwright/callflow-fixes-2026-11-02/canvas-pdf');
fs.mkdirSync(out,{recursive:true});
const report={cases:[],limitations:['Downloaded PDF bytes are checked directly; browser download-folder preferences remain user settings.']};
let harness;
const poppler=name=>process.env.POPPLER_BIN?path.join(process.env.POPPLER_BIN,name):name;
async function overlaps(p){return p.evaluate(()=>{const boxes=[...document.querySelectorAll('#callflow-canvas .flow-node')].map(e=>({id:e.dataset.nodeId,left:parseFloat(e.style.left),top:parseFloat(e.style.top),width:e.offsetWidth,height:e.offsetHeight}));const hits=[];for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];if(a.left<b.left+b.width&&a.left+a.width>b.left&&a.top<b.top+b.height&&a.top+a.height>b.top)hits.push([a.id,b.id]);}return {boxes,hits};});}
async function queue(p){await p.locator('[data-flow-menu="queues"]').click();await p.locator('[data-flow-menu-content="queues"] [data-flow-palette-target]').first().press('Enter');const id=await p.evaluate(()=>state.flow.nodes.find(n=>n.type==='QUEUE'&&n.id.startsWith('local-')).id);return id;}
async function expand(p,id){if(await p.locator('#toggle-did-rail').isVisible())await p.locator('#toggle-did-rail').click();await p.locator(`[data-node-members-toggle="${id}"]`).click();await p.waitForFunction(()=>document.querySelectorAll('#callflow-canvas .is-service-member').length===20);}
async function didMenuAboveCanvas(p, palette, {scrollToEnd=false}={}) {
 const selector=p.locator('#flow-did-selector'),menu=p.locator('#flow-did-menu');
 const initialTitle=await selector.locator('strong').innerText();
 await selector.click();
 await menu.waitFor({state:'visible'});
 assert.equal(await selector.getAttribute('aria-expanded'),'true');
 const initialId=await menu.locator('.flow-did-option.is-selected').getAttribute('data-did-id');
 if(scrollToEnd)await menu.evaluate(element=>{element.scrollTop=element.scrollHeight;});
 const bounds=await menu.evaluate(element=>{
  const rect=element.getBoundingClientRect();
  const clips=[];
  for(let parent=element.parentElement;parent;parent=parent.parentElement){
   if(/^(auto|scroll|hidden|clip)$/.test(getComputedStyle(parent).overflowY)){
    const r=parent.getBoundingClientRect();clips.push({selector:parent.className||parent.tagName,bottom:r.top+parent.clientTop+parent.clientHeight});
   }
  }
  return {bottom:rect.bottom,height:rect.height,scroll:element.scrollHeight,client:element.clientHeight,
   viewport:visualViewport?visualViewport.offsetTop+visualViewport.height:innerHeight,clips};
 });
 assert(bounds.bottom<=bounds.viewport+1,`${palette}: the menu must fit inside the visible viewport`);
 assert(bounds.clips.every(clip=>bounds.bottom<=clip.bottom+1),`${palette}: no option may be clipped by an ancestor: ${JSON.stringify(bounds)}`);
 if(scrollToEnd)assert(bounds.scroll>bounds.client,'A long DID list must scroll within the menu');
 const hits=await menu.evaluate(element=>{
  const menuRect=element.getBoundingClientRect();
  const toolbar=document.querySelector('.flow-menu-launcher').getBoundingClientRect();
  const panel=document.querySelector('.flow-picker').getBoundingClientRect();
  const inside=(r,x,y)=>x>r.left&&x<r.right&&y>r.top&&y<r.bottom;
  return [...element.querySelectorAll('.flow-did-option')].flatMap(option=>{
   const r=option.getBoundingClientRect();
   const left=Math.max(r.left,menuRect.left+element.clientLeft,0);
   const right=Math.min(r.right,menuRect.left+element.clientLeft+element.clientWidth,innerWidth);
   const top=Math.max(r.top,menuRect.top+element.clientTop,0);
   const bottom=Math.min(r.bottom,menuRect.top+element.clientTop+element.clientHeight,innerHeight);
   if(right-left<12||bottom-top<4)return [];
   const y=(top+bottom)/2;
   return [left+4,(left+right)/2,right-4].map(x=>{
    const hit=document.elementFromPoint(x,y);
    return {id:option.dataset.didId,x,y,reachable:hit?.closest('.flow-did-option')===option,
     hit:hit?`${hit.tagName}.${hit.className}`:null,aboveToolbar:inside(toolbar,x,y),abovePalette:inside(panel,x,y)};
   });
  });
 });
 assert(hits.length>=6,`${palette}: at least two visible DID options must be sampled`);
 assert(hits.every(hit=>hit.reachable),`${palette}: every visible left/centre/right option point must receive the click: ${JSON.stringify(hits.filter(hit=>!hit.reachable))}`);
 const alternatives=menu.locator('.flow-did-option:not(.is-selected)');
 const alternative=scrollToEnd?alternatives.last():alternatives.first();
 const alternativeId=await alternative.getAttribute('data-did-id');
 await alternative.click();
 await menu.waitFor({state:'hidden'});
 assert.equal(await selector.getAttribute('aria-expanded'),'false');
 assert.notEqual(await selector.locator('strong').innerText(),initialTitle,'Selecting another DID must update the number title');
 await selector.click();
 assert.equal(await menu.locator('.flow-did-option.is-selected').getAttribute('data-did-id'),alternativeId);
 await menu.locator(`[data-did-id="${initialId}"]`).click();
 await menu.waitFor({state:'hidden'});
 assert.equal(await selector.locator('strong').innerText(),initialTitle,'Returning to the original DID must restore its title');
 return {palette,initialId,alternativeId,bounds,hits};
}
async function actualPdf(p,name){
 const flowBefore=await p.evaluate(()=>JSON.stringify({flow:state.flow,zoom:state.flowZoom,scroll:[document.querySelector('#callflow-canvas').scrollLeft,document.querySelector('#callflow-canvas').scrollTop]}));
 const overviewTitles=await p.locator('#callflow-canvas .node-title').allTextContents();
 await p.evaluate(()=>{window.__printCalls=0;window.print=()=>window.__printCalls++;});
 const [download]=await Promise.all([p.waitForEvent('download',{timeout:10000}),p.locator('#export-flow-pdf').click()]);
 assert.equal(await p.evaluate(()=>window.__printCalls),0,'PDF download must never open the print dialog');
 assert.match(download.suggestedFilename(),/^callflow-.*\.pdf$/i);
 const file=path.join(out,name+'.pdf');await download.saveAs(file);
 assert.equal(fs.readFileSync(file).subarray(0,5).toString(),'%PDF-','Download must contain actual PDF bytes');
 const svgFile=path.join(out,name+'-overview.svg');
 execFileSync(poppler('pdftocairo'),['-svg','-f','1','-l','1',file,svgFile]);
 const svg=fs.readFileSync(svgFile,'utf8');
 const paths=[...svg.matchAll(/<path\b[^>]+>/g)].map(match=>match[0]);
 const diagramEdges=paths.filter(tag=>/fill="none"/.test(tag)&&/\bd="[^"]*\bC /.test(tag)).length;
 const directions=paths.filter(tag=>/fill-rule="nonzero"/.test(tag)&&!tag.includes('stroke-width')&&/\bd="M [^MLCZ]+ L [^MLCZ]+ L [^MLCZ]+ Z/.test(tag)).length;
 const text=execFileSync(poppler('pdftotext'),['-layout',file,'-'],{encoding:'utf8'});
 const overviewText=execFileSync(poppler('pdftotext'),['-f','1','-l','1',file,'-'],{encoding:'utf8'}).replace(/\s+/g,' ');
 const xml=execFileSync(poppler('pdftohtml'),['-xml','-stdout','-i','-zoom','1',file],{encoding:'utf8'});
 const fontSpecs=[...xml.matchAll(/<fontspec[^>]*id="(\d+)"[^>]*size="([\d.]+)"/g)].map(m=>({id:m[1],size:+m[2]}));
 const fontSizes=fontSpecs.map(f=>f.size),readableFonts=new Set(fontSpecs.filter(f=>f.size>=9).map(f=>f.id));
 const readableText=[...xml.matchAll(/<text\b[^>]*font="(\d+)"[^>]*>([\s\S]*?)<\/text>/g)].filter(m=>readableFonts.has(m[1])).map(m=>m[2].replace(/<[^>]+>/g,'')).join(' ');
 const pages=+[...execFileSync(poppler('pdfinfo'),[file],{encoding:'utf8'}).matchAll(/Pages:\s+(\d+)/g)][0][1];
 execFileSync(poppler('pdftoppm'),['-scale-to','1400','-png',file,path.join(out,name+'-page')]);
 fs.writeFileSync(path.join(out,name+'.txt'),text);
 assert.equal(await p.locator('.flow-print-export').count(),0,'print cleanup');
 assert.equal(await p.evaluate(()=>JSON.stringify({flow:state.flow,zoom:state.flowZoom,scroll:[document.querySelector('#callflow-canvas').scrollLeft,document.querySelector('#callflow-canvas').scrollTop]})),flowBefore,'Export must preserve the draft, zoom and scroll');
 assert(!/Show targets|Hide targets|Callflow as PDF|Delete local draft/.test(text),'Document must contain no editor controls');
 for(const title of overviewTitles)assert(new RegExp(title.trim().replace(/\s+/g,' ').replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?![\\p{L}\\p{N}])','u').test(overviewText),`Overview must retain node ${title}`);
 return {file,diagramEdges,directions,text,pages,fontSizes,readableText,overviewText};
}
async function complex(p){await p.evaluate(()=>{const inbound=state.flow.nodes.find(n=>n.locked);inbound.x=4;inbound.y=55;const tc={id:'hours',type:'TIMECONTROL',title:'Office hours',titleUserEdited:true,x:27,y:55,config:{portalMode:'new',name:'Office hours',hours:'Mon-Fri 09:00-17:00',openTarget:{type:'IVR',title:'Main menu',targetNumber:'7100',routeNumber:'1',config:{portalMode:'existing',ivrKeys:['1','2'],announcement:'Welcome',key1Target:{type:'PHONEEXTENSION',title:'Sales',targetNumber:'201',routeNumber:'201'},key2Target:{type:'PHONEEXTENSION',title:'Support',targetNumber:'202',routeNumber:'202'},timeoutTarget:{type:'HANGUP',title:'No input'}}},closedTarget:{type:'HANGUP',title:'Office closed'}}};state.flow={nodes:[inbound,tc],edges:[{from:inbound.id,to:tc.id}]};materializeBranchNodes(state.flow);for(const n of state.flow.nodes){if(n.sourceId===tc.id){n.x=55;n.y=n.branchField==='openTarget'?35:95;}else if(n.sourceId){n.x=85;n.y=n.branchField==='key1Target'?10:n.branchField==='key2Target'?45:80;}}state.selectedNodeId='hours';renderCallflow();});}
async function arrowBranches(p){await p.evaluate(()=>{const inbound=state.flow.nodes.find(n=>n.locked);inbound.x=10;inbound.y=38;const ivr={id:'testivr',type:'IVR',title:'Routing Menu',x:40,y:38,config:{portalMode:'new',announcement:'Welcome message',ivrKeys:['0','2','9'],key0Target:{type:'PHONEEXTENSION',title:'Reception',targetNumber:'200',routeNumber:'200'},key2Target:{type:'PHONEEXTENSION',title:'Technical support',targetNumber:'201',routeNumber:'201'},key9Target:{type:'PHONEEXTENSION',title:'Sales enquiries',targetNumber:'202',routeNumber:'202'},timeoutTarget:{type:'HANGUP',title:'Timeout end'}}};state.flow={nodes:[inbound,ivr],edges:[{from:inbound.id,to:ivr.id}]};materializeBranchNodes(state.flow);let i=0;for(const n of state.flow.nodes){if(n.sourceId){n.x=75;n.y=10+24*i++;}}renderCallflow();});}
async function one(name,fn,{theme='admin-portal',width=1280,height=900,provider={}}={}){if(process.env.CANVAS_CASE_FILTER&&!name.includes(process.env.CANVAS_CASE_FILTER))return;const cleanup=[],r={name};report.cases.push(r);try{
 const app=await fixture({after:f=>cleanup.push(f)},{public:true,provider});const base=`http://127.0.0.1:${app.port}`;const c=await harness.context(base);cleanup.push(()=>c.close());const p=await c.newPage();p.setDefaultTimeout(10000);await p.setViewportSize({width,height});await p.goto(base+`/?theme=${theme}&lang=en#callflow`);await p.locator('[data-node-id="inbound"]').waitFor();await p.waitForLoadState('networkidle');
 try{await fn(p,r);}finally{await p.screenshot({path:path.join(out,name+'.png'),fullPage:true});r.writes=await app.control('writes');assert.equal(r.writes.length,0);}
 r.pass=true;
 }catch(error){r.pass=false;r.error=error.stack;}finally{for(const f of cleanup.reverse())await f();console.log(r.pass?'PASS':'FAIL',name,r.error?.split('\n')[0]||'');}}
(async()=>{harness=await isolatedBrowser(chromium,process.env.BROWSER_EXECUTABLE_PATH||process.env.CHROME_PATH);
 for(const theme of ['admin-portal','classic'])for(const width of [1280,1024])await one(`DID-menu-layering-${theme}-${width}`,async(p,r)=>{
  r.menus=[];
  if(await p.locator('#toggle-did-rail').isVisible())await p.locator('#toggle-did-rail').click();
  r.menus.push(await didMenuAboveCanvas(p,'collapsed'));
  for(const key of ['extensions','queues','ivrs','skills','timeControls']){
   await p.locator(`[data-flow-menu="${key}"]`).click();
   await p.locator(`[data-flow-menu-content="${key}"]`).waitFor({state:'visible'});
   r.menus.push(await didMenuAboveCanvas(p,key));
  }
  const hits=r.menus.flatMap(menu=>menu.hits);
  assert(hits.some(hit=>hit.aboveToolbar),'The regression must exercise actual overlap with the canvas toolbar');
  assert(r.menus.filter(menu=>menu.palette!=='collapsed').every(menu=>menu.hits.some(hit=>hit.abovePalette)),'Each open resource palette must overlap tested menu points');
 },{theme,width});
 for(const theme of ['admin-portal','classic'])await one(`DID-menu-narrow-${theme}`,async(p,r)=>{
  r.menus=[];
  for(const key of ['extensions','queues','ivrs','skills','timeControls']){
   await p.locator(`[data-flow-menu="${key}"]`).click();
   await p.locator(`[data-flow-menu-content="${key}"]`).waitFor({state:'visible'});
   r.menus.push(await didMenuAboveCanvas(p,key,{scrollToEnd:true}));
  }
  await p.locator('#flow-did-selector').click();
  await p.setViewportSize({width:390,height:740});
  await p.waitForFunction(()=>{
   const menu=document.querySelector('#flow-did-menu'),panel=document.querySelector('.flow-panel');
   return menu.getBoundingClientRect().bottom<=Math.min(innerHeight,panel.getBoundingClientRect().bottom)+1;
  });
  await p.locator('#flow-did-selector').click();
  r.resized=await didMenuAboveCanvas(p,'resized',{scrollToEnd:true});
 },{theme,width:390,height:844,provider:{dids:12}});
 await one('PDF-small-flow-preserved',async(p,r)=>{r.pdf=await actualPdf(p,'PDF-small-flow-preserved');assert.equal(r.pdf.pages,1,'Simple flow should remain a one-page diagram');assert(r.pdf.diagramEdges>0,'Visual overview must be retained');assert(/Incoming call/.test(r.pdf.text)&&/Ext 0/.test(r.pdf.text));});
 await one('PDF-simple-classic-one-page',async(p,r)=>{r.pdf=await actualPdf(p,'PDF-simple-classic-one-page');assert.equal(r.pdf.pages,1,'Readable simple flows need no duplicate detail page');},{theme:'classic'});
 await one('PDF-measured-arrow-endpoints',async(p,r)=>{
  await arrowBranches(p);
  r.model=await p.evaluate(()=>flowPdfModel(document.querySelector('#callflow-canvas')));
  for(const edge of r.model.edges){const x=edge.points[6],y=edge.points[7];assert(!r.model.nodes.some(n=>x>n.x+.5&&x<n.x+n.width-.5&&y>n.y+.5&&y<n.y+n.height-.5),'An arrow endpoint must not be buried inside a target card');}
  r.pdf=await actualPdf(p,'PDF-measured-arrow-endpoints');assert(r.pdf.directions>=r.model.edges.length,'Every route needs a visible arrow');
 });
 await one('PDF-scrolled-draft-preserved',async(p,r)=>{await p.locator('#zoom-in').click();await p.locator('#zoom-in').click();await p.locator('#callflow-canvas').evaluate(e=>e.scrollTo(650,450));r.pdf=await actualPdf(p,'PDF-scrolled-draft-preserved');assert(r.pdf.diagramEdges>0);});
 await one('CF09-edge-insert',async(p,r)=>{await p.locator('[data-insert-from="inbound"]').click();r.layout=await overlaps(p);assert.deepEqual(r.layout.hits,[],'Inserted cards must not overlap');});
 await one('CF09-palette',async(p,r)=>{for(const key of ['extensions','queues','ivrs','skills','timeControls']){await p.locator(`[data-flow-menu="${key}"]`).click();await p.locator(`[data-flow-menu-content="${key}"] [data-flow-palette-target]`).first().press('Enter');}r.layout=await overlaps(p);assert.deepEqual(r.layout.hits,[],'Repeated palette additions must remain distinguishable');});
 await one('CF09-members',async(p,r)=>{await expand(p,await queue(p));r.layout=await overlaps(p);assert.deepEqual(r.layout.hits,[],'Expanded members must not cover each other or existing cards');});
 await one('CF08-scrolled-member-drag-undo',async(p,r)=>{
  await expand(p,await queue(p));
  const member=p.locator('[data-member-key="200"] .node-title');await member.scrollIntoViewIfNeeded();await p.waitForTimeout(100);
  const snapshot=()=>p.evaluate(()=>({coordinates:state.flow.nodes.map(n=>({id:n.id,x:n.x,y:n.y})),memberLayouts:state.flow.nodes.map(n=>({id:n.id,layouts:JSON.parse(JSON.stringify(n.config?.memberLayouts||{}))}))}));
  r.before=await snapshot();const b=await member.boundingBox();await p.mouse.move(b.x+b.width/2,b.y+b.height/2);await p.mouse.down();await p.mouse.move(b.x+b.width/2+55,b.y+b.height/2+65,{steps:12});await p.mouse.up();r.moved=await snapshot();assert.notDeepEqual(r.moved.memberLayouts,r.before.memberLayouts,'Real drag must change member coordinates');
  await p.locator('#undo-flow-change').click();r.restored=await snapshot();assert.deepEqual(r.restored,r.before,'Undo must restore the moved member without relocating any other node');
 });
 await one('CF10-real-drag',async(p,r)=>{for(let i=0;i<8;i++)await p.locator('#zoom-out').click();const b=await p.locator('[data-node-id="target"] .node-title').boundingBox();await p.mouse.move(b.x+b.width/2,b.y+b.height/2);await p.mouse.down();await p.mouse.move(1130,470,{steps:15});await p.mouse.up();await p.waitForTimeout(100);r.bounds=await p.evaluate(()=>{const s=document.querySelector('#callflow-canvas .flow-svg'),v=s.viewBox.baseVal;return {view:{x:v.x,y:v.y,width:v.width,height:v.height},paths:[...s.querySelectorAll('.flow-edge')].map(e=>{const b=e.getBBox();return {right:b.x+b.width,bottom:b.y+b.height}}),target:state.flow.nodes.find(n=>n.id==='target')};});r.pdf=await actualPdf(p,'CF10-real-drag');assert(r.bounds.target.x>100,'Mouse drag must move beyond initial world width');for(const b of r.bounds.paths){assert(b.right<=r.bounds.view.width,'SVG must contain actual path bounds');assert(b.bottom<=r.bounds.view.height);}});
 for(const theme of ['admin-portal','classic'])await one('CF11-labels-'+theme,async(p,r)=>{await complex(p);r.pdf=await actualPdf(p,'CF11-labels-'+theme);for(const label of ['inside','outside','key 1','key 2','timeout'])assert(r.pdf.readableText.toLowerCase().includes(label),`PDF needs readable routing condition ${label}`);assert(r.pdf.directions>0||/[→➜]/.test(r.pdf.text),'PDF needs explicit routing direction');},{theme});
 await one('CF12-readable-members',async(p,r)=>{await expand(p,await queue(p));r.pdf=await actualPdf(p,'CF12-readable-members');assert(r.pdf.diagramEdges>0,'Complex flow must retain its visual overview');assert(r.pdf.fontSizes.length>0,'PDF text must be extractable');for(let i=0;i<20;i++)assert(new RegExp(`Ext\\s+${i}(?!\\d)`).test(r.pdf.readableText),`Member ${i} needs a complete detail representation at >=9pt`);});
 await one('PDF-collapsed-members-complete',async(p,r)=>{await queue(p);r.pdf=await actualPdf(p,'PDF-collapsed-members-complete');for(let i=0;i<20;i++)assert(new RegExp(`Ext\\s+${i}(?!\\d)`).test(r.pdf.readableText),`Collapsed member ${i} needs static readable export data`);});
 await one('CF13-static-document',async(p,r)=>{const id=await queue(p);await p.locator(`[data-node-id="${id}"] .node-title`).click();r.pdf=await actualPdf(p,'CF13-static-document');assert(!/Show targets|Hide targets/i.test(r.pdf.text));});
 await one('PDF-repeat-and-unicode',async(p,r)=>{
  assert.equal(await p.locator('#export-flow-pdf').innerText(),'Download PDF');
  await p.evaluate(()=>window.NFON_I18N.setLanguage('de',true));
  assert.equal(await p.locator('#export-flow-pdf').innerText(),'PDF herunterladen');
  await p.evaluate(()=>window.NFON_I18N.setLanguage('en',true));
  await p.evaluate(()=>{state.flow.nodes.find(n=>n.id==='target').title='Zoë Müller · Łódź · Český';renderCallflow();});
  r.first=await actualPdf(p,'PDF-unicode-first');r.second=await actualPdf(p,'PDF-unicode-repeat');
  assert(r.second.text.includes('Zoë Müller')&&r.second.text.includes('Łódź')&&r.second.text.includes('Český'));
  assert.equal(r.first.text,r.second.text,'Repeated downloads must keep identical content');
 });
 await one('PDF-failure-recovery',async(p,r)=>{
  await p.evaluate(()=>{window.savedPdfCreator=window.NfonCallflowPdf.create;window.NfonCallflowPdf.create=()=>{throw new Error('Test export failure');};});
  await p.locator('#export-flow-pdf').click();await p.locator('#app-dialog-modal.is-open').waitFor();
  assert.equal(await p.locator('#app-dialog-title').innerText(),'PDF could not be created');
  assert.equal(await p.locator('#export-flow-pdf').isEnabled(),true);
  await p.locator('#app-dialog-confirm').click();
  await p.evaluate(()=>{window.NfonCallflowPdf.create=window.savedPdfCreator;});
  r.pdf=await actualPdf(p,'PDF-recovered');
 });
 await one('CF14-modern1024-palette',async(p,r)=>{r.palette=await p.locator('.flow-menu-launcher').evaluate(e=>{const b=e.getBoundingClientRect();return {width:b.width,client:e.clientWidth,scroll:e.scrollWidth,buttons:[...e.querySelectorAll('button')].map(n=>{const r=n.getBoundingClientRect();return {text:n.innerText,inside:r.left>=b.left&&r.right<=b.right&&r.top>=b.top&&r.bottom<=b.bottom}})};});assert(r.palette.buttons.every(b=>b.inside),'Every resource category must be visible without hidden horizontal scrolling');assert(r.palette.scroll<=r.palette.client+1);r.initialNodes=await p.locator('#callflow-canvas').evaluate(e=>{const c=e.getBoundingClientRect();return [...e.querySelectorAll('.flow-node')].map(n=>{const b=n.getBoundingClientRect();return {id:n.dataset.nodeId,inside:b.left>=c.left&&b.right<=c.right&&b.top>=c.top&&b.bottom<=c.bottom};});});assert(r.initialNodes.every(n=>n.inside),'Initial cards must be visible in the available canvas');},{width:1024});
 for(const width of [390,768])await one('CF14-classic'+width+'-inspector',async(p,r)=>{if(width===768){await p.locator('[data-flow-menu="timeControls"]').click();await p.waitForFunction(()=>document.activeElement?.closest('[data-flow-menu-content="timeControls"]'));}await p.locator('[data-node-edit="target"]').focus();await p.keyboard.press('Enter');await p.locator('[data-node-field="type"]').waitFor();r.inspector=await p.locator('#flow-helper').evaluate(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,client:e.clientWidth,scroll:e.scrollWidth};});assert(r.inspector.width>=Math.min(320,width-32),'Inspector must retain a usable field width');assert(r.inspector.left>=0&&r.inspector.right<=width);assert(r.inspector.scroll<=r.inspector.client+1);},{theme:'classic',width});
})().catch(error=>{report.fatal=error.stack;process.exitCode=1;}).finally(async()=>{if(harness){report.isolation={proxyDenials:harness.proxyDenials,routeDenials:harness.routeDenials};await harness.close();}fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2)+'\n');if(report.cases.some(r=>!r.pass))process.exitCode=1;});
