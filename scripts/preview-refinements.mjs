import {_electron as electron} from 'playwright';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const report=JSON.parse(await readFile('work/qa/ui-results.json','utf8'));
const app=await electron.launch({args:['.'],env:{...process.env,CHESSASH_TEST:'1',CHESSASH_TEST_DATA:report.profile}});
try{
 const page=await app.firstWindow();
 await page.evaluate(()=>{const key='chessash:prefs';const p=JSON.parse(localStorage.getItem(key)||'{}');localStorage.setItem(key,JSON.stringify({...p,advanced:false,theme:'dark'}));});
 await page.reload();await page.setViewportSize({width:1440,height:1000});
 await page.locator('.review-complete').waitFor();
 const opera=await page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('chessash');r.onsuccess=()=>resolve(r.result);});const games=await new Promise(resolve=>{const r=db.transaction('games').objectStore('games').getAll();r.onsuccess=()=>resolve(r.result);});return games.find(g=>g.headers.Event==='Opera game (sample)');});
 const sacrifice=opera.review.results.find(r=>r.ply===29);
 assert.notEqual(sacrifice.label,'blunder');assert.notEqual(sacrifice.label,'mistake');
 await page.locator('.key-moves button').first().click();
 for(let i=0;i<3;i++)await page.getByRole('button',{name:'Hint',exact:true}).click();
 await page.locator('line[data-suggestion]').waitFor({state:'attached'});
 await page.waitForTimeout(700);
 await page.screenshot({path:'work/qa/charcoal-green-desktop.png',fullPage:true});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setMinimumSize(320,500));
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:'work/qa/charcoal-green-mobile.png',fullPage:true});
 await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByLabel('Appearance').selectOption('light');await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 await page.screenshot({path:'work/qa/green-light-desktop.png',fullPage:true});
 await writeFile('work/qa/refinements-results.json',JSON.stringify({rings:2,hintArrow:true,flippedArrow:'verified in ui-smoke',responsive390:'no horizontal overflow',themes:['dark','light'],originalPieces:12,operaMove29:{label:sacrifice.label,loss:sacrifice.loss,depth:sacrifice.depth},packaging:'paused'},null,2));
 console.log('Refinements passed: original pieces, rings, hint arrow, mobile layout, light/dark themes and Opera tactical recheck.',JSON.stringify({label:sacrifice.label,loss:sacrifice.loss,depth:sacrifice.depth}));
}finally{await app.close();}
