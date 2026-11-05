import { chromium } from 'playwright';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
const exec=promisify(execFile);
const adb='work/android-sdk/platform-tools/adb.exe';
const run=(...args)=>exec(adb,['-s','emulator-5554',...args],{maxBuffer:1024*1024});
const pid=(await run('shell','pidof','dev.flamedev.chessash')).stdout.trim();
await run('forward','tcp:9223',`localabstract:webview_devtools_remote_${pid}`);
const browser=await chromium.connectOverCDP('http://127.0.0.1:9223',{noDefaults:true});
try {
 const page=browser.contexts()[0].pages()[0];
 await page.getByRole('button',{name:'Export annotated PGN',exact:true}).click();
 let xml='';
 for(let i=0;i<10;i++){
  await run('shell','uiautomator','dump','/sdcard/chessash-picker.xml');
  xml=(await run('shell','cat','/sdcard/chessash-picker.xml')).stdout;
  if(xml.includes('action_menu_save')||xml.includes('text="SAVE"'))break;
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 await fs.writeFile('work/android-export-picker.xml',xml);
 const saveNode=xml.match(/<node[^>]*(?:resource-id="[^"]*action_menu_save"|text="SAVE")[^>]*>/)?.[0];
 if(!saveNode)throw new Error('Native document picker save action not found.');
 const bounds=saveNode.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
 if(!bounds)throw new Error('No picker save button bounds.');
 await run('shell','input','tap',String((Number(bounds[1])+Number(bounds[3]))/2),String((Number(bounds[2])+Number(bounds[4]))/2));
 await new Promise(resolve=>setTimeout(resolve,700));
 const files=(await run('shell','ls','/sdcard/Download')).stdout.split(/\r?\n/).filter(name=>name.startsWith('ChessAsh-')&&name.endsWith('.pgn'));
 if(!files.length)throw new Error('No exported PGN found in Downloads.');
 const pgn=(await run('shell','cat',`/sdcard/Download/${files.at(-1)}`)).stdout;
 if(!pgn.includes('Qh4#')||!pgn.includes('[Event "Android smoke"]'))throw new Error('Exported file content did not match imported game.');
 console.log('Android native PGN export passed: system document picker saved annotated PGN to Downloads.');
}finally{await browser.close();await run('forward','--remove','tcp:9223');}
