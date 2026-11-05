import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
const {version: appVersion} = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
const exec=promisify(execFile),adb='work/android-sdk/platform-tools/adb.exe';
const run=(...args)=>exec(adb,['-s','emulator-5554',...args],{maxBuffer:2*1024*1024});
const dump=async()=>{await run('shell','uiautomator','dump','/sdcard/chessash-ui.xml');return(await run('shell','cat','/sdcard/chessash-ui.xml')).stdout;};
async function tapText(text,xml){
 xml ??= await dump();
 const escaped=text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const node=xml.match(new RegExp('<node[^>]*text="'+escaped+'"[^>]*>'))?.[0];
 const bounds=node?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
 if(!bounds)return false;
 await run('shell','input','tap',String(Math.round((+bounds[1]+ +bounds[3])/2)),String(Math.round((+bounds[2]+ +bounds[4])/2)));return true;
}
await run('install','-r',`release/ChessAsh-${appVersion}-android.apk`);
await run('shell','am','force-stop','dev.flamedev.chessash');
await run('shell','am','start','-n','dev.flamedev.chessash/.MainActivity');
if(!await tapText('Explore a sample'))throw new Error('Release welcome did not load.');
let started=false;
for(let i=0;i<7;i++){
 const xml=await dump();if(await tapText('Start review',xml)){started=true;break;}
 await run('shell','input','swipe','520','2050','520','550','300');
}
if(!started)throw new Error('Release start review button unavailable.');
let complete=false;
for(let i=0;i<25;i++){
 const xml=await dump();if(xml.includes('Review saved')){complete=true;break;}
 if(xml.includes('engine could not')||xml.includes('timed out'))throw new Error('Native release engine failed.');
 await new Promise(resolve=>setTimeout(resolve,1000));
}
if(!complete)throw new Error('Release review did not complete within test budget.');
const image=await exec(adb,['-s','emulator-5554','exec-out','screencap','-p'],{encoding:'buffer',maxBuffer:10*1024*1024});
await fs.writeFile('work/screenshots/android-release-reviewed.png',image.stdout);
console.log('Signed Android release native UI passed: welcome, sample game, complete local review, no debugging connection.');
