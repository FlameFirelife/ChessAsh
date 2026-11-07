import { _electron as electron } from 'playwright';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const app = await electron.launch({ args: ['.'], env: { ...process.env, CHESSASH_TEST: '1', CHESSASH_TEST_DATA: path.resolve('work/qa/animation-realtime-' + Date.now()) } });
try {
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.webContents.setBackgroundThrottling(false);
    window.showInactive();
  });
  await page.evaluate(() => localStorage.setItem('chessash:language', 'en'));
  await page.reload();
  await page.getByRole('button', { name: 'Import game', exact: true }).click();
  await page.getByRole('textbox', { name: 'Paste PGN' }).fill('[Event "Realtime animation"]\n\n1. e4 d5 2. exd5 Nf6 3. Nc3 *');
  await page.getByRole('button', { name: 'Import PGN', exact: true }).click();
  const result = await page.evaluate(async () => {
    const environment = { systemReduced: matchMedia('(prefers-reduced-motion: reduce)').matches, appMotion: document.documentElement.dataset.motion };
    const samples = [];
    const started = performance.now();
    document.querySelector('button[aria-label="Next move"]').click();
    await new Promise(resolve => {
      let firstFrame;
      function frame() {
        firstFrame ??= performance.now();
        const node = document.querySelector('.moving-piece[data-square="e4"]');
        samples.push({ time: performance.now() - started, transform: node && getComputedStyle(node).transform, animations: node?.getAnimations().map(a => ({ state: a.playState, time: a.currentTime })) });
        if (performance.now() - firstFrame < 650) requestAnimationFrame(frame); else resolve();
      }
      requestAnimationFrame(frame);
    });
    return { environment, samples };
  });
  await mkdir('verification', { recursive: true });
  await writeFile('verification/board-animation-realtime.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ environment: result.environment, frames: result.samples.length, distinctTransforms: new Set(result.samples.map(s => s.transform)).size, report: 'verification/board-animation-realtime.json' }));
  if (!result.environment.systemReduced && result.environment.appMotion !== 'reduced') assert.ok(new Set(result.samples.map(s => s.transform)).size > 3, 'Expected movement across naturally advancing frames');
} finally { await app.close(); }
