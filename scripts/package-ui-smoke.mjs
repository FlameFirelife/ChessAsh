import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
const root=process.cwd();
const executable=process.env.CHESSASH_EXECUTABLE || path.join(root,'release/win-unpacked/ChessAsh.exe');
const profile=path.join(root,'work/packaged-ui-profile');
await fs.mkdir(profile,{recursive:true});
const app=await electron.launch({executablePath:executable,args:[],env:{...process.env,CHESSASH_TEST:'1',CHESSASH_TEST_DATA:profile}});
try {
 const page=await app.firstWindow();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.getByRole('button',{name:'Import game',exact:true}).click();
 await page.getByRole('textbox',{name:'Paste PGN'}).fill('[Event "Packaged review"]\n[White "Local"]\n[Black "Foxash"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1');
 await page.getByRole('button',{name:'Import PGN',exact:true}).click();
 await page.getByRole('button',{name:/Start review|Analyse game/,exact:true}).click();
 await page.getByText('Review saved',{exact:false}).waitFor({timeout:120000});
 const bridge=await page.evaluate(async()=>({platform:window.chessash.platform,labels:await window.chessash.reviewFacts([{loss:120}]),noNode:typeof window.require==='undefined'}));
 assert.equal(bridge.platform,'windows');assert.equal(bridge.labels[0].label,'mistake');assert.equal(bridge.noNode,true);assert.deepEqual(errors,[]);
 await fs.mkdir('work/screenshots',{recursive:true});await page.screenshot({path:'work/screenshots/windows-packaged.png'});
 console.log('Packaged Windows UI passed: PGN import, full Stockfish review, actual bundled Foxash, isolated renderer.');
} finally {await app.close();}

