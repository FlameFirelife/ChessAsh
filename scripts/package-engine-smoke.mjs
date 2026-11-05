import { _electron as electron } from 'playwright';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root=process.cwd();
const app=await electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[root],env:{...process.env,CHESSASH_TEST:'1',CHESSASH_TEST_DATA:path.join(root,'work/electron-engine-profile')}});
try {
  const page=await app.firstWindow();
  const workerUrl=pathToFileURL(path.join(root,'public/engine/stockfish.js')).href;
  const lines=await page.evaluate(url=>new Promise((resolve,reject)=>{
    const worker=new Worker(url); const lines=[];
    const timeout=setTimeout(()=>{worker.terminate();reject(new Error('Worker timeout: '+lines.join('\n')));},30000);
    worker.onerror=event=>{clearTimeout(timeout);worker.terminate();reject(new Error('Worker error: '+event.message));};
    worker.onmessage=event=>{lines.push(String(event.data));if(String(event.data).includes('uciok'))worker.postMessage('position startpos');if(String(event.data).includes('uciok'))worker.postMessage('go depth 8');if(String(event.data).includes('bestmove ')){clearTimeout(timeout);worker.terminate();resolve(lines.slice(-3));}};
    worker.postMessage('uci');
  }),workerUrl);
  console.log('Electron file-origin engine smoke passed',JSON.stringify(lines));
} finally {await app.close();}
