import { _electron as electron } from 'playwright';
import { Chess } from 'chess.js';
import path from 'node:path';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

function fixture(id, sans, label = 'best', initialFen) {
  const board = new Chess(initialFen), positions = [board.fen()], results = [];
  for (const san of sans) {
    const move = board.move(san);
    positions.push(board.fen());
    results.push({ ply: results.length + 1, move: move.lan, san: move.san, color: move.color, before: 0, after: 0, loss: 0, label, best: move.lan, pv: [], replyPv: [], depth: 12, explanation: 'Visual test fixture', hints: [], key: true });
  }
  return { id, pgn: board.pgn(), headers: { White: 'Visual fixture', Black: id }, moves: sans, positions, source: 'PGN', lastPly: sans.length, reviewAs: 'w', review: { version: 1, engine: 'synthetic visual fixture', depth: 12, results, completed: true }, notes: {} };
}
const games = [fixture('sacrifice', ['e4'], 'sacrifice'), fixture('critical', ['e4'], 'great'), fixture('capture', ['e4', 'd5', 'exd5']), fixture('check', ['e4', 'f6', 'Qh5+']), fixture('mate', ['f3', 'e5', 'g4', 'Qh4#']), fixture('stale', [], 'best', 'k7/2Q5/2K5/8/8/8/8/8 b - - 0 1'), fixture('castle', ['O-O'], 'best', 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'), fixture('promotion', ['a8=Q+'], 'best', '7k/P7/8/8/8/8/8/7K w - - 0 1')];
const app = await electron.launch({ args: ['.'], env: { ...process.env, CHESSASH_TEST: '1', CHESSASH_TEST_DATA: path.resolve('work/qa/animation-upgrade-' + Date.now()) } });
const checks = [], errors = [];
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(async games => {
    localStorage.setItem('chessash:language', 'en');
    localStorage.setItem('chessash:prefs', JSON.stringify({ reduced: false, sound: false }));
    const db = await new Promise(resolve => { const r = indexedDB.open('chessash', 1); r.onupgradeneeded = () => r.result.createObjectStore('games', { keyPath: 'id' }); r.onsuccess = () => resolve(r.result); });
    await new Promise(resolve => { const t = db.transaction('games', 'readwrite'); for (const game of games) t.objectStore('games').put(game); t.oncomplete = resolve; });
    db.close();
  }, games);
  async function open(id) {
    await page.evaluate(id => { localStorage.setItem('chessash:active', id); localStorage.setItem('chessash:screen', 'board'); }, id);
    await page.reload();
    await page.locator('.board-workspace .chessboard, .board-shell .chessboard').first().waitFor();
    await page.waitForFunction(() => !document.querySelector('.welcome-board') && !!document.querySelector('.piece-layer'));
  }
  async function freeze(time) {
    return page.evaluate(time => {
      for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = time; }
    }, time);
  }
  await mkdir('verification', { recursive: true });
  await open('sacrifice');
  assert.equal(await page.locator('[data-animation="sound-sacrifice"]').count(), 1);
  await freeze(650);
  assert.ok(await page.locator('.sacrifice-sequence').isVisible());
  await page.locator('.chessboard').screenshot({ path: 'verification/animation-sacrifice-desktop.png' });
  const hero = await page.locator('.sacrifice-title').evaluate(node => {
    const animation = node.getAnimations()[0];
    return [0, 450, 950, 1750].map(time => { animation.currentTime = time; const css = getComputedStyle(node); return { time, opacity: css.opacity, scale: css.scale }; });
  });
  assert.equal(Number(hero[0].opacity), 0);
  assert.ok(Number(hero[1].opacity) > .9 && Number(hero[2].opacity) > .9);
  assert.equal(Number(hero[3].opacity), 0);
  await freeze(650);
  const prior = await page.locator('.sacrifice-title').evaluate(node => { window.originalHero = node; return true; });
  assert.ok(prior);
  await page.getByRole('button', { name: 'Flip board', exact: true }).click();
  await freeze(650);
  assert.ok(await page.evaluate(() => window.originalHero === document.querySelector('.sacrifice-title')));
  await page.getByRole('button', { name: 'Previous move', exact: true }).click();
  assert.equal(await page.locator('.sacrifice-sequence').count(), 0);
  checks.push('Sound sacrifice alone has the 1750ms cinematic sequence; navigation removes it');
  await open('critical');
  assert.equal(await page.locator('.sacrifice-sequence').count(), 0);
  assert.equal(await page.locator('.quality-great .quality-landing').count(), 1);
  checks.push('Critical find uses regular board feedback');
  for (const [id, kind] of [['check', 'check'], ['mate', 'checkmate'], ['stale', 'stalemate']]) {
    await open(id);
    assert.equal(await page.locator(`.position-${kind}`).count(), 1);
    assert.equal(await page.locator('.sacrifice-sequence').count(), 0);
    await freeze(650);
    await page.locator('.chessboard').screenshot({ path: `verification/animation-${kind}.png` });
    const target = await page.locator('.king-focus').evaluate(node => { const r = node.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.getByRole('button', { name: 'Flip board', exact: true }).click();
    await freeze(650);
    const flipped = await page.locator('.king-focus').evaluate(node => { const r = node.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    assert.notDeepEqual(target, flipped);
    checks.push(`${kind}: distinct effect, king target follows orientation, no cinematic`);
  }
  for (const id of ['capture', 'castle', 'promotion']) {
    await open(id);
    await page.evaluate(() => document.querySelector('button[aria-label="Previous move"]').click());
    await page.evaluate(() => document.querySelector('button[aria-label="Next move"]').click());
    const expected = id === 'castle' ? 2 : 1;
    assert.equal(await page.locator('.piece-in-motion').count(), expected);
    assert.equal(await page.locator('.move-arrival').count(), expected);
    if (id === 'capture') assert.equal(await page.locator('.captured-piece').count(), 1);
    checks.push(`${id}: moved pieces retain identity and receive landing feedback`);
  }
  await open('sacrifice');
  await page.setViewportSize({ width: 390, height: 844 });
  await freeze(650);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator('.chessboard').screenshot({ path: 'verification/animation-sacrifice-phone.png' });
  const bounds = await page.locator('.sacrifice-title strong').evaluate(node => { const r = node.getBoundingClientRect(), board = node.closest('.chessboard').getBoundingClientRect(); return r.left >= board.left && r.right <= board.right; });
  assert.ok(bounds);
  await page.evaluate(() => document.documentElement.dataset.motion = 'reduced');
  assert.equal(await page.locator('.quality-effects').evaluate(node => getComputedStyle(node).display), 'none');
  await page.evaluate(() => { localStorage.setItem('chessash:prefs', JSON.stringify({ reduced: true })); localStorage.setItem('chessash:language', 'it'); });
  await open('mate');
  assert.equal(await page.locator('.position-announcement').innerText(), '#\nScacco matto');
  assert.equal(await page.locator('.position-announcement').evaluate(node => getComputedStyle(node).animationName), 'none');
  await page.evaluate(() => document.documentElement.dataset.motion = 'normal');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.king-focus i').first().evaluate(node => getComputedStyle(node).display), 'none');
  checks.push('390px layout, Italian, app and system reduced-motion fallbacks');
  assert.deepEqual(errors, []);
  await writeFile('verification/animation-upgrade-results.json', JSON.stringify({ passed: true, checks, hero, errors, limitation: 'Synthetic saved-review fixtures, controlled CSS timelines in hidden Electron; not engine classification validation or physical Android smoothness.' }, null, 2));
  console.log('Animation upgrade checks passed:', checks.length);
} finally { await app.close(); }
