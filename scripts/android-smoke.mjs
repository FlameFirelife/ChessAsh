import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const exec = promisify(execFile);
const adb = path.join(process.cwd(), 'work', 'android-sdk', 'platform-tools', 'adb.exe');
const device = process.env.CHESSASH_DEVICE || 'emulator-5554';
const run = (...args) => exec(adb, ['-s', device, ...args], { maxBuffer: 1024 * 1024 });
await run('install', '-r', 'release/ChessAsh-1.0.0-android-debug.apk');
await run('shell', 'am', 'force-stop', 'dev.flamedev.chessash');
await run('shell', 'am', 'start', '-n', 'dev.flamedev.chessash/.MainActivity');
let pid;
for (let i = 0; i < 30; i++) {
  pid = await run('shell', 'pidof', 'dev.flamedev.chessash').then(result=>result.stdout.trim()).catch(()=>'');
  if (pid && (await run('shell', 'cat', '/proc/net/unix')).stdout.includes(`webview_devtools_remote_${pid}`)) break;
  await new Promise(resolve => setTimeout(resolve, 500));
}
await run('forward', 'tcp:9223', `localabstract:webview_devtools_remote_${pid}`);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { noDefaults: true });
try {
  const page = browser.contexts()[0].pages()[0];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: 'Import game', exact: true }).click();
  await page.getByRole('textbox', { name: 'Paste PGN' }).fill('[Event "Android smoke"]\n[White "Local test"]\n[Black "Stockfish"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1');
  await page.getByRole('button', { name: 'Import PGN', exact: true }).click();
  await page.getByRole('button', { name: /Start review|Analyse game/, exact: true }).click();
  await page.getByText('Review saved', { exact: false }).waitFor({ timeout: 120000 });
  const data = await page.evaluate(async () => {
    const request = indexedDB.open('chessash', 1);
    const db = await new Promise((resolve, reject) => {request.onsuccess=()=>resolve(request.result);request.onerror=reject;});
    const rows = await new Promise((resolve,reject) => {const r=db.transaction('games').objectStore('games').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=reject;});
    const game = rows.find(game => game.headers.Event === 'Android smoke');
    return { count:game.review.results.length, complete:game.review.completed, lastLabel:game.review.results.at(-1).label, wasm:typeof WebAssembly === 'object', native:window.Capacitor?.isNativePlatform(), overflow:document.documentElement.scrollWidth > innerWidth };
  });
  assert.equal(data.count,4); assert.equal(data.complete,true); assert.equal(data.wasm,true); assert.equal(data.native,true); assert.equal(data.overflow,false);
  assert.deepEqual(errors,[]);
  await fs.mkdir('work/screenshots',{recursive:true});
  await page.screenshot({path:'work/screenshots/android-review.png',fullPage:true});
  await page.reload();
  await page.getByText('Review saved', {exact:false}).waitFor({timeout:15000});
  console.log('Android WebView smoke passed: APK launch, PGN import, actual offline Stockfish review, persistence, no horizontal overflow.', JSON.stringify(data));
} finally { await browser.close(); await run('forward', '--remove', 'tcp:9223'); }

