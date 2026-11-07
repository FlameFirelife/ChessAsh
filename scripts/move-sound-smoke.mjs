import { _electron as electron } from 'playwright';
import path from 'node:path';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const app = await electron.launch({ args: ['.'], env: { ...process.env, CHESSASH_TEST: '1', CHESSASH_TEST_DATA: path.resolve('work/qa/move-sound-' + Date.now()) } });
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  await page.addInitScript(() => {
    window.soundChecks = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      const samples = this.buffer.getChannelData(0);
      const peak = samples.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0);
      window.soundChecks.push({ duration: this.buffer.duration, peak, state: this.context.state });
      return start.apply(this, args);
    };
  });
  await page.evaluate(() => {
    localStorage.setItem('chessash:language', 'en');
    localStorage.setItem('chessash:prefs', JSON.stringify({ sound: true, reduced: true }));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Import game', exact: true }).click();
  await page.getByRole('textbox', { name: 'Paste PGN' }).fill('[Event "Sound check"]\n\n1. e4 d5 2. exd5 Nf6 *');
  await page.getByRole('button', { name: 'Import PGN', exact: true }).click();
  const count = () => page.evaluate(() => window.soundChecks.length);
  const expectCount = n => page.waitForFunction(n => window.soundChecks.length === n, n);
  assert.equal(await count(), 0);
  for (let n = 1; n <= 3; n++) {
    await page.getByRole('button', { name: 'Next move', exact: true }).click();
    await expectCount(n);
  }
  await page.getByRole('button', { name: 'Previous move', exact: true }).click();
  await expectCount(4);
  await page.getByRole('button', { name: 'Flip board', exact: true }).click();
  await page.waitForTimeout(200);
  assert.equal(await count(), 4);
  await page.getByRole('button', { name: /^g1 White knight$/ }).click();
  await page.getByRole('button', { name: 'f3', exact: true }).click();
  await expectCount(5);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Move sounds', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Previous move', exact: true }).click();
  await page.waitForTimeout(200);
  assert.equal(await count(), 5);
  const sounds = await page.evaluate(() => window.soundChecks);
  assert.ok(sounds.every(s => s.duration >= 0.17 && s.duration <= 0.19 && s.peak > 0.1 && s.peak < 0.9 && s.state === 'running'));
  await mkdir('verification', { recursive: true });
  await writeFile('verification/move-sound-results.json', JSON.stringify({ passed: true, checks: ['initial load silent', 'forward moves and capture once each', 'backward navigation', 'flip silent', 'manual move once', 'sound independent of reduced motion', 'toggle off silent'], sounds, limitation: 'Actual Web Audio source playback exercised in isolated Electron; speaker audibility, subjective timbre and physical Android remain unverified.' }, null, 2));
  console.log('Move sound playback checks passed.');
} finally { await app.close(); }
