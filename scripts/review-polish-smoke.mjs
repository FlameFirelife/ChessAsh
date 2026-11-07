import { _electron as electron } from 'playwright';
import path from 'node:path';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const app = await electron.launch({ args: ['.'], env: { ...process.env, CHESSASH_TEST: '1', CHESSASH_TEST_DATA: path.resolve('work/qa/review-polish-' + Date.now()) } });
const checks = [], errors = [];
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.webContents.setBackgroundThrottling(false); window.showInactive(); });
  await page.evaluate(() => { localStorage.setItem('chessash:language', 'en'); localStorage.setItem('chessash:prefs', JSON.stringify({ sound: false, reduced: false })); });
  await page.reload();
  await page.getByRole('button', { name: 'Import game', exact: true }).click();
  await page.getByRole('textbox', { name: 'Paste PGN' }).fill('[Event "Review polish check"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O *');
  await page.getByRole('button', { name: 'Import PGN', exact: true }).click();
  await page.evaluate(() => document.querySelector('.move-disclosure').open = true);
  await page.locator('.moves-scroll').waitFor({ state: 'visible' });
  const bounds = await page.locator('.chessboard').boundingBox();
  const rapid = await page.evaluate(async () => {
    const next = document.querySelector('button[aria-label="Next move"]');
    next.click();
    await new Promise(resolve => setTimeout(resolve, 30));
    const slow = document.querySelector('.piece-in-motion').getAnimations().find(a => a.effect.getKeyframes().some(k => k.transform));
    const slowDuration = slow.effect.getTiming().duration;
    next.click();
    await new Promise(resolve => setTimeout(resolve, 10));
    const fast = document.querySelector('.piece-in-motion[data-square="e5"]').getAnimations().find(a => a.effect.getKeyframes().some(k => k.transform));
    const ghosts = document.querySelectorAll('.piece-speed-ghost').length;
    const fastDuration = fast.effect.getTiming().duration;
    const counterAnimations = document.querySelector('.move-counter-value').getAnimations().length;
    const selectionAnimations = document.querySelector('.move-selection').getAnimations().length;
    return { slowDuration, fastDuration, ghosts, counterAnimations, selectionAnimations };
  });
  assert.equal(rapid.slowDuration, 330);
  assert.ok(rapid.fastDuration >= 150 && rapid.fastDuration < 330);
  assert.ok(rapid.ghosts > 0 && rapid.ghosts <= 12);
  assert.ok(rapid.counterAnimations > 0 && rapid.selectionAnimations > 0);
  checks.push('rapid navigation accelerates movement and adds bounded afterimages, counter and move-list motion');
  await page.waitForTimeout(600);
  assert.equal(await page.locator('.piece-speed-ghost').count(), 0);
  assert.deepEqual(await page.locator('.chessboard').boundingBox(), bounds);
  const aligned = await page.evaluate(() => {
    const selected = document.querySelector('.active-move').getBoundingClientRect(), marker = document.querySelector('.move-selection').getBoundingClientRect();
    return selected.width > 40 && selected.height >= 30 && ['x', 'y', 'width', 'height'].every(key => Math.abs(selected[key] - marker[key]) < 1);
  });
  assert.ok(aligned);
  checks.push('afterimages clean up; highlight aligns with selected move; board stays fixed');
  await page.evaluate(async () => {
    document.querySelector('button[aria-label="Next move"]').click();
    await new Promise(resolve => setTimeout(resolve, 25));
    document.querySelector('button[aria-label="Next move"]').click();
  });
  await page.evaluate(() => { for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = Number(animation.effect.getTiming().duration) * .25; } });
  await mkdir('verification', { recursive: true });
  await page.locator('.chessboard').screenshot({ path: 'verification/review-speed-trails.png' });
  await page.evaluate(() => { for (const animation of document.getAnimations()) animation.play(); });
  await page.evaluate(async () => {
    document.querySelector('button[aria-label="Next move"]').click();
    await new Promise(resolve => setTimeout(resolve, 25));
    document.querySelector('button[aria-label="Previous move"]').click();
  });
  await page.getByRole('button', { name: 'Flip board', exact: true }).click();
  assert.equal(await page.locator('.piece-speed-ghost').count(), 0);
  checks.push('reversal remains legal and orientation clears trails');
  for (const mode of ['app', 'system']) {
    if (mode === 'app') await page.evaluate(() => document.documentElement.dataset.motion = 'reduced');
    else { await page.evaluate(() => document.documentElement.dataset.motion = 'normal'); await page.emulateMedia({ reducedMotion: 'reduce' }); }
    await page.evaluate(async () => { document.querySelector('button[aria-label="Next move"]').click(); await new Promise(resolve => setTimeout(resolve, 20)); document.querySelector('button[aria-label="Next move"]').click(); });
    await page.waitForTimeout(50);
    assert.equal(await page.locator('.piece-speed-ghost').count(), 0);
    assert.equal(await page.locator('.move-counter-value, .move-selection').evaluateAll(nodes => nodes.reduce((sum, node) => sum + node.getAnimations().length, 0)), 0);
  }
  checks.push('app and system reduced motion disable new effects');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Last move', exact: true }).click();
  await page.waitForTimeout(350);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.ok(await page.evaluate(() => { const a = document.querySelector('.active-move').getBoundingClientRect(), b = document.querySelector('.move-selection').getBoundingClientRect(); return Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1; }));
  await page.screenshot({ path: 'verification/review-polish-phone.png', fullPage: true });
  checks.push('phone layout has no overflow; highlight tracks resize and last-move jump');
  assert.deepEqual(errors, []);
  await writeFile('verification/review-polish-results.json', JSON.stringify({ passed: true, checks, rapid, errors, limitation: 'Isolated visible Electron; no physical Android verification.' }, null, 2));
  console.log('Review polish checks passed:', checks.length);
} finally { await app.close(); }
