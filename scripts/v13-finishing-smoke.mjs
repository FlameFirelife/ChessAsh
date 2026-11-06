import {_electron as electron} from 'playwright';
import {Chess} from 'chess.js';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const board=new Chess(),moves=['f3','e5','g4','Qh4#'],positions=[board.fen()],results=[];
for(const san of moves){const m=board.move(san);positions.push(board.fen());results.push({ply:results.length+1,move:m.lan,san:m.san,color:m.color,before:0,after:0,loss:150,label:results.length===2?'blunder':'best',best:results.length===2?'b1c3':m.lan,pv:[],replyPv:results.length===2?['d8h4']:[],depth:12,explanation:'fixture',hints:[],key:true});}
const game={id:'resume-fixture',pgn:board.pgn(),headers:{White:'Local player',Black:'Opponent'},moves,positions,source:'PGN',lastPly:1,reviewAs:'w',review:{version:1,engine:'fixture',depth:12,results,completed:true},notes:{3:'Preserve this note'}};
const profile=path.resolve('work/qa/v13-finishing-'+Date.now());await mkdir(profile,{recursive:true});
let app;let page;const errors=[],checks=[];
async function launch(){app=await electron.launch({args:['.'],env:{...process.env,CHESSASH_TEST:'1',CHESSASH_TEST_DATA:profile}});page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));}
try{
 await launch();
 await page.evaluate(async game=>{localStorage.setItem('chessash:active',game.id);localStorage.setItem('chessash:language','en');const db=await new Promise(resolve=>{const r=indexedDB.open('chessash',1);r.onupgradeneeded=()=>r.result.createObjectStore('games',{keyPath:'id'});r.onsuccess=()=>resolve(r.result)});await new Promise(resolve=>{const t=db.transaction('games','readwrite');t.objectStore('games').put(game);t.oncomplete=resolve});db.close()},game);
 await page.reload();await page.getByRole('button',{name:'Training',exact:true}).click();await page.getByRole('button',{name:/Start training/}).click();
 await page.getByRole('button',{name:'Open source position',exact:true}).click();await page.locator('.message-quality').waitFor();assert.match(await page.locator('.message-quality').innerText(),/g4/);assert.equal(await page.getByRole('tab',{name:'Review',exact:true}).getAttribute('aria-selected'),'true');checks.push('source button opens the exact original move on Review');
 await page.getByRole('button',{name:'Training',exact:true}).click();await page.getByRole('heading',{name:'Find a better move',exact:true}).waitFor();
 await page.keyboard.press('ArrowRight');assert.equal(await page.getByRole('heading',{name:'Find a better move',exact:true}).count(),1);
 await page.waitForFunction(()=>!!localStorage.getItem('chessash:training:v1:selected-pgn-sides:session'));
 await app.close();app=null;await launch();await page.getByRole('heading',{name:'Find a better move',exact:true}).waitFor();assert.equal(await page.locator('.training-screen').count(),1);checks.push('full app restart resumes the unfinished exercise automatically');
 await page.getByRole('button',{name:/^b1 White knight$/}).click();await page.getByRole('button',{name:'c3',exact:true}).click();await page.getByRole('heading',{name:'Well found!',exact:true}).waitFor();
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('chessash:training:v1:selected-pgn-sides:session')).state==='correct');
 await app.close();app=null;await launch();await page.getByRole('heading',{name:'Well found!',exact:true}).waitFor();
 const record=await page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('chessash:training:v1:selected-pgn-sides')))[0]);assert.equal(record.attempts,1);checks.push('restored solved answer does not record another attempt');
 await page.getByRole('button',{name:'Finish',exact:true}).click();await page.getByRole('button',{name:'See your patterns',exact:true}).click();await page.getByRole('heading',{name:'Progress over time',exact:true}).waitFor();assert.match(await page.locator('.training-progress').innerText(),/1 \/ 1 solved without revealing/);checks.push('completed session appears in persistent per-pattern progress');
 const eventCount=await page.evaluate(()=>JSON.parse(localStorage.getItem('chessash:training:v1:selected-pgn-sides:events')).length);assert.equal(eventCount,1);
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'work/qa/v13-progress-phone.png',fullPage:true});
 await page.evaluate(()=>localStorage.setItem('chessash:language','it'));await page.reload();await page.getByRole('heading',{name:'Progressi nel tempo',exact:true}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'work/qa/v13-progress-it.png',fullPage:true});checks.push('Italian progress labels fit the phone viewport');
 assert.equal(await page.locator('.app-header nav button').evaluateAll(buttons=>buttons.every(button=>{const r=button.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&button.scrollWidth<=button.clientWidth+1;})),true);
 assert.match(await page.locator('.training-progress').innerText(),/1 sessione completata/);
 const saved=await page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('chessash',1);r.onsuccess=()=>resolve(r.result)});return new Promise(resolve=>{const r=db.transaction('games').objectStore('games').get('resume-fixture');r.onsuccess=()=>resolve(r.result)})});assert.deepEqual(saved.review,game.review);assert.deepEqual(saved.notes,game.notes);assert.deepEqual(errors,[]);
 await mkdir('verification',{recursive:true});await writeFile('verification/v13-finishing-results.json',JSON.stringify({passed:true,checks,errors,testing:'hidden Electron; no physical device timing tests'},null,2));console.log('V1.3 finishing PASS',JSON.stringify(checks));
}finally{if(app)await app.close();}
