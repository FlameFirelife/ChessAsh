import {_electron as electron} from 'playwright';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const report=JSON.parse(await readFile('work/qa/playful-results.json','utf8'));
const app=await electron.launch({args:['.'],env:{...process.env,CHESSASH_TEST:'1',CHESSASH_TEST_DATA:report.profile}});
try{
 const page=await app.firstWindow();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));await page.setViewportSize({width:1440,height:1000});await page.locator('.board-message').waitFor();
 const button=page.locator('button.primary').first();assert.equal(await button.evaluate(e=>getComputedStyle(e).color),'rgb(249, 252, 244)');assert.equal(await button.evaluate(e=>getComputedStyle(e).fontWeight),'700');
 assert.equal(await page.locator('.super-king-avatar img').count(),1);assert.equal(await page.locator('.ash-avatar').count(),0);
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('.accuracy-ring')).every(e=>parseInt(e.querySelector('strong').textContent,10)===Number(e.dataset.score)));
 await page.screenshot({path:'work/qa/playful-review-desktop.png',fullPage:true,animations:'disabled'});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setMinimumSize(320,500));await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'work/qa/playful-review-mobile.png',fullPage:true,animations:'disabled'});
 await page.setViewportSize({width:1440,height:1000});await page.getByRole('tab',{name:'Tutor',exact:true}).click();await page.getByRole('combobox',{name:'Tutor connection',exact:true}).waitFor();await page.screenshot({path:'work/qa/playful-tutor.png',fullPage:true,animations:'disabled'});
 console.log('Final previews: bold white green-button text, super-king and responsive review verified.');
}finally{await app.close();}
