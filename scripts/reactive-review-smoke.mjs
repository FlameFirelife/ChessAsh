import {_electron as electron} from 'playwright';
import {Chess} from 'chess.js';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
await mkdir('work/qa',{recursive:true});
const chess=new Chess(); const positions=[chess.fen()]; const moves=['e4','d5','exd5','Qxd5'];const results=[];
for(const san of moves){const m=chess.move(san);positions.push(chess.fen());results.push({ply:results.length+1,move:m.lan,san:m.san,color:m.color,before:0,after:0,loss:0,label:'best',best:m.lan,pv:[m.lan],depth:14,explanation:'Old technical wording',hints:[],key:true});}
results[2].replyPv=['d8d5'];results[2].pv=['e4d5','d8d5'];
const game={id:'reactive-fixture',pgn:chess.pgn(),headers:{Event:'Reactive review fixture',White:'White',Black:'Black',Result:'*'},moves,positions,source:'PGN',lastPly:3,review:{version:1,engine:'fixture',depth:14,results,completed:true}};
const app=await electron.launch({executablePath:process.env.CHESSASH_ELECTRON,args:['.'],env:{...process.env,CHESSASH_TEST:'1',CHESSASH_TEST_DATA:path.resolve('work/qa/reactive-profile-'+Date.now())}});
let page;const errors=[];
try{
page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));
await page.evaluate(async game=>{localStorage.setItem('chessash:active',game.id);const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('chessash',1);r.onupgradeneeded=()=>r.result.createObjectStore('games',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});await new Promise((resolve,reject)=>{const t=db.transaction('games','readwrite');t.objectStore('games').put(game);t.oncomplete=resolve;t.onerror=reject});db.close()},game);
await page.reload();await page.getByRole('button',{name:'Best move · before',exact:true}).waitFor();
assert.equal(await page.getByRole('button',{name:'Hint',exact:true}).count(),0);
assert.equal(await page.locator('line[data-suggestion="e4d5"]').count(),1);
assert.match(await page.locator('.speech-text').innerText(),/queen from d8 to d5/);
assert.match(await page.locator('.best-move-description').innerText(),/pawn e4 → d5/);
await page.getByRole('button',{name:'Highlight e4 on the board',exact:true}).first().hover();assert.ok((await page.locator('.square.review-focus').count())>=2);
await page.waitForTimeout(450);
await page.getByRole('button',{name:'Played move · after',exact:true}).click();
await page.locator('line[data-threat="d8d5"]').waitFor({state:'attached'});
const animated=await page.locator('.moving-piece').evaluateAll(p=>p.some(e=>e.getAnimations().some(a=>a.playState==='running')));assert.ok(animated,'played move should animate');
assert.equal(await page.locator('img[data-square="d5"]').count(),1);
await page.waitForTimeout(500);await page.screenshot({path:'work/qa/reactive-review-desktop.png',fullPage:true});
await page.getByRole('button',{name:'Flip board',exact:true}).click();assert.equal(await page.locator('line[data-threat]').getAttribute('x1'),'450');
await page.getByRole('button',{name:'Best move · before',exact:true}).click();assert.equal(await page.locator('img[data-square="e4"]').count(),1);
await page.getByRole('button',{name:'Try again',exact:true}).click();assert.equal(await page.locator('line[data-suggestion]').count(),0);await page.getByRole('button',{name:'Done',exact:true}).click();
await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setMinimumSize(320,500));await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'work/qa/reactive-review-phone.png',fullPage:true});
await page.locator('button.square[aria-label="e4 White pawn"]').click();await page.locator('button.square[aria-label="d5 Black pawn"]').click();
assert.equal(await page.locator('img[data-square="e4"]').count(),0);assert.equal(await page.locator('img[data-square="d5"]').count(),1);
const manualAnimation=await page.locator('.moving-piece').evaluateAll(p=>p.some(e=>e.getAnimations().some(a=>a.playState==='running')));assert.ok(manualAnimation,'manual move should animate');
await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByLabel('Reduce motion',{exact:true}).check();await page.getByRole('button',{name:'Close dialog',exact:true}).click();assert.equal(await page.locator('.moving-piece').first().evaluate(e=>getComputedStyle(e).transitionDuration),'0s');
assert.deepEqual(errors,[]);await writeFile('verification/reactive-review-results.json',JSON.stringify({passed:true,checks:['saved review receives explicit explanations without reanalysis','no Hint button','immediate best arrow','square text highlights','legal reply arrow','played move animation','flipped coordinates','retry hides answer','390px layout','manual capture animation','reduced motion'],pieceAnimationObserved:animated,pageErrors:errors,fixture:'seeded chess.js game and review; no engine-quality claim',packaging:'paused'},null,2));console.log('REACTIVE REVIEW UI PASS');
}finally{await app.close()}
