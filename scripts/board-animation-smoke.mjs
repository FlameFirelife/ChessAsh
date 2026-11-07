import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
const app=await electron.launch({args:['.'],env:{...process.env,CHESSASH_TEST:'1',CHESSASH_TEST_DATA:path.resolve('work/qa/animation-'+Date.now())}});
const checks=[];
try{
 const page=await app.firstWindow();await page.emulateMedia({reducedMotion:'no-preference'});
 await page.evaluate(()=>localStorage.setItem('chessash:language','en'));await page.reload();
 await page.getByRole('button',{name:'Import game',exact:true}).click();await page.getByRole('textbox',{name:'Paste PGN'}).fill('[Event "Animation check"]\n\n1. e4 d5 2. exd5 Nf6 3. Nc3 *');await page.getByRole('button',{name:'Import PGN',exact:true}).click();
 for(const square of ['e4','d5','d5','f6']){
  await page.evaluate(()=>document.querySelector('button[aria-label="Next move"]').click());
  await page.waitForFunction(sq=>{const p=document.querySelector(`.piece-in-motion[data-square="${sq}"]`);return p?.getAnimations().some(a=>a.effect instanceof KeyframeEffect&&a.effect.getKeyframes().some(k=>k.transform));},square);
  const samples=await page.locator(`.piece-in-motion[data-square="${square}"]`).evaluate(node=>{
   const animation=node.getAnimations().find(a=>a.effect.getKeyframes().some(k=>k.transform));animation.pause();
   const duration=Number(animation.effect.getTiming().duration);
   return [0,duration/2,duration].map(time=>{animation.currentTime=time;return getComputedStyle(node).transform;});
  });assert.equal(new Set(samples).size,3);checks.push({square,samples});
 }
 await page.evaluate(()=>document.querySelector('button[aria-label="Previous move"]').click());await page.waitForFunction(()=>!!document.querySelector('.piece-in-motion'));
 assert.ok(await page.locator('.piece-in-motion').first().evaluate(node=>node.getAnimations().length>0));
 await page.evaluate(()=>document.documentElement.dataset.motion='reduced');await page.waitForFunction(()=>[...document.querySelectorAll('.moving-piece')].every(node=>node.getAnimations().length===0));
 await page.evaluate(()=>document.querySelector('button[aria-label="Next move"]').click());await page.waitForTimeout(100);assert.equal(await page.locator('.moving-piece').evaluateAll(nodes=>nodes.reduce((sum,node)=>sum+node.getAnimations().length,0)),0);
 await mkdir('verification',{recursive:true});await writeFile('verification/board-animation-results.json',JSON.stringify({passed:true,checks,backward:true,reducedMotion:true,limitation:'Controlled animation-timeline sampling in Electron; not physical Android verification'},null,2));console.log('Board animation rendered transforms passed.');
}finally{await app.close();}
