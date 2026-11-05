import { _electron as electron } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const profile = path.resolve('work', 'accounts-ui-' + Date.now());
await mkdir('work/qa', { recursive: true });
const makePgn = (event, white, black, link, date) => `[Event "${event}"]\n[White "${white}"]\n[Black "${black}"]\n[Date "2026.11.05"]\n[UTCTime "${date}"]\n[Link "${link}"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 1-0`;
const sharedPgn = makePgn('Shared account game', 'main_user', 'guest_master', 'https://www.chess.com/game/live/10001', '12:00:00');
const mainPgn = makePgn('Main account game', 'main_user', 'someone_else', 'https://www.chess.com/game/live/10002', '13:00:00');
const guestPgn = makePgn('Guest account game', 'guest_master', 'another_player', 'https://www.chess.com/game/live/10003', '14:00:00');
const app = await electron.launch({ args: ['.'], env: { ...process.env, CHESSASH_TEST: '1', CHESSASH_TEST_DATA: profile } });
let page;
try {
  await app.evaluate((_electron, fixtures) => {
    globalThis.__accountRequests = [];
    globalThis.fetch = async url => {
      const parsed = new URL(String(url));
      if (parsed.hostname !== 'api.chess.com') throw new Error('Unexpected test network host');
      globalThis.__accountRequests.push(parsed.href);
      const username = parsed.pathname.match(/\/player\/([^/]+)/)?.[1];
      if (!['main_user', 'guest_master'].includes(username)) return new Response('{}', { status: 404 });
      const archive = `https://api.chess.com/pub/player/${username}/games/2026/11`;
      const data = parsed.pathname.endsWith('/archives') ? { archives: [archive] } : { games: (username === 'main_user' ? [fixtures.sharedPgn, fixtures.mainPgn] : [fixtures.sharedPgn, fixtures.guestPgn]).map((pgn, index) => ({ pgn, url: pgn.match(/\[Link "([^"]+)"\]/)[1], end_time: 1_793_900_000 + index, rules: 'chess', time_class: 'rapid' })) };
      return new Response(JSON.stringify(data), { status: 200, headers: { 'Cache-Control': 'max-age=120', 'Content-Type': 'application/json' } });
    };
  }, { sharedPgn, mainPgn, guestPgn });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const allowForegroundChecks = () => page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  });
  await allowForegroundChecks();
  async function importUser(username, main) {
    await page.getByRole('button', { name: 'Import game', exact: true }).click();
    await page.waitForFunction(expected => document.querySelector('.modal input[type="checkbox"]')?.checked === expected, main);
    const checkbox = page.getByRole('checkbox', { name: 'This is my account. Keep it synced.', exact: true });
    assert.equal(await checkbox.isChecked(), main);
    await page.getByLabel('Chess.com username', { exact: true }).fill(username);
    await page.getByRole('button', { name: 'Fetch finished games', exact: true }).click();
    await page.locator('.modal').waitFor({ state: 'detached' });
  }
  await importUser('main_user', true);
  await page.waitForFunction(() => localStorage.getItem('chessash:main-username') === 'main_user');
  await importUser('guest_master', false);
  assert.equal(await page.evaluate(() => localStorage.getItem('chessash:main-username')), 'main_user');
  await page.getByRole('button', { name: /^Library/ }).click();
  assert.equal(await page.locator('.account-container').count(), 2);
  assert.equal(await page.locator('.account-main .account-title strong').innerText(), 'main_user');
  assert.equal(await page.locator('.account-guest .account-title strong').innerText(), 'guest_master');
  assert.equal(await page.locator('.account-guest .account-toggle').getAttribute('aria-expanded'), 'false');
  await page.locator('.account-guest .account-toggle').click();
  assert.equal(await page.locator('.account-main .game-row').count(), 2);
  assert.equal(await page.locator('.account-guest .game-row').count(), 2);
  assert.equal(await app.evaluate(() => globalThis.__accountRequests.length), 4);
  await page.getByRole('button', { name: 'Check now', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.account-refresh.spinning'));
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange')); });
  assert.equal(await app.evaluate(() => globalThis.__accountRequests.length), 4);
  const stored = await page.evaluate(async () => {
    await new Promise(resolve => setTimeout(resolve, 650));
    const db = await new Promise(resolve => { const r = indexedDB.open('chessash'); r.onsuccess = () => resolve(r.result); });
    const games = await new Promise(resolve => { const r = db.transaction('games').objectStore('games').getAll(); r.onsuccess = () => resolve(r.result); });
    const shared = games.find(game => game.headers.Event === 'Shared account game');
    shared.notes = { 1: 'Keep this account annotation' };
    shared.lastPly = 2;
    shared.review = { version: 1, engine: 'Account preservation fixture', depth: 12, completed: true, results: [] };
    await new Promise((resolve, reject) => { const transaction = db.transaction('games', 'readwrite'); transaction.objectStore('games').put(shared); transaction.oncomplete = resolve; transaction.onerror = reject; });
    return { total: games.length, names: shared.accountUsernames.sort() };
  });
  assert.equal(stored.total, 3);
  assert.deepEqual(stored.names, ['guest_master', 'main_user']);
  await page.reload(); await allowForegroundChecks();
  await importUser('guest_master', false);
  await page.waitForTimeout(700);
  const preserved = await page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('chessash'); r.onsuccess = () => resolve(r.result); });
    const games = await new Promise(resolve => { const r = db.transaction('games').objectStore('games').getAll(); r.onsuccess = () => resolve(r.result); });
    const shared = games.find(game => game.headers.Event === 'Shared account game');
    return { count: games.length, notes: shared.notes, engine: shared.review.engine, completed: shared.review.completed, names: shared.accountUsernames.sort() };
  });
  assert.equal(preserved.count, 3);
  assert.equal(preserved.notes[1], 'Keep this account annotation');
  assert.equal(preserved.engine, 'Account preservation fixture');
  assert.equal(preserved.completed, true);
  assert.deepEqual(preserved.names, ['guest_master', 'main_user']);
  await page.getByRole('button', { name: 'Import game', exact: true }).click();
  await page.getByRole('textbox', { name: 'Paste PGN' }).fill('[Event "Local board"]\n[White "Club player"]\n[Black "Friend"]\n\n1. d4 d5 *');
  await page.getByRole('button', { name: 'Import PGN', exact: true }).click();
  await page.getByRole('button', { name: /^Library/ }).click();
  assert.equal(await page.locator('.account-container').count(), 3);
  assert.equal(await page.locator('.account-files .game-row').count(), 1);
  assert.equal(await page.locator('.account-main .account-title strong').innerText(), 'main_user');
  await page.locator('.account-guest .account-toggle').click();
  await page.screenshot({ path: 'work/qa/accounts-library.png', fullPage: true });
  assert.deepEqual(errors, []);
  const report = { status: 'passed', profile, checks: ['explicit main-account import', 'guest import does not replace main', 'separate main/guest/PGN containers', 'shared game appears in both accounts without duplicate storage', 'focus/manual refresh uses cache', 'saved review and notes survive reload/reimport'], mockedPublicRequests: await app.evaluate(() => globalThis.__accountRequests.length), preservationFixture: 'Stored review metadata and note, not an engine-quality test', packaging: 'paused' };
  await writeFile('work/qa/accounts-ui-results.json', JSON.stringify(report, null, 2));
  console.log('ACCOUNTS UI PASS', JSON.stringify(report));
} catch (error) {
  if (page) { await writeFile('work/qa/accounts-ui-failure.txt', await page.locator('body').innerText()); await page.screenshot({ path: 'work/qa/accounts-ui-failure.png', fullPage: true }); }
  throw error;
} finally { await app.close(); }
