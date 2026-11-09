import { _electron as electron } from 'playwright';
import { createServer } from 'vite';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
let app;
try {
  await server.listen();
  app = await electron.launch({ args: ['.'], env: { ...process.env, CHESSASH_TEST: '1', CHESSASH_DEV_URL: `http://127.0.0.1:${server.httpServer.address().port}/`, CHESSASH_TEST_DATA: path.resolve('work/qa/testing-followup-' + Date.now()) } });
  const page = await app.firstWindow(); page.setDefaultTimeout(20000);
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.webContents.setBackgroundThrottling(false); w.showInactive(); });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.exposeFunction('reportProgress', n => { if (n % 20 === 0) console.log('Rook-game review: ' + n + ' plies'); });
  const reviewed = await page.evaluate(async pgn => {
    const { parsePgn } = await import('/src/core/pgn.ts');
    const { analyzeGame } = await import('/src/core/analysis.ts');
    const game = parsePgn(pgn); game.reviewAs = 'w'; game.lastPly = 1;
    game.review = await analyzeGame(game, { depth: 8, fresh: true, classify: async facts => (await window.chessash.reviewFacts([facts]))[0], onProgress: n => window.reportProgress(n) });
    return game;
  }, await readFile('tests/fixtures/rook-stalemate.pgn', 'utf8'));
  assert.ok(reviewed.review.completed);
  const white = reviewed.review.results.filter(r => r.color === 'w');
  const sacrifices = white.filter(r => r.label === 'sacrifice');
  assert.ok(sacrifices.length >= 40, `${sacrifices.length}/${white.length} rook sacrifices`);
  assert.ok(sacrifices.every(r => r.sacrificeEvidence?.outcome === 'stalemate'));
  console.log(`Actual Stockfish/Foxash: ${sacrifices.length}/${white.length} white moves are verified stalemate sacrifices.`);
  await mkdir('verification', { recursive: true });
  await writeFile('verification/rook-sacrifice-results.json', JSON.stringify({ whiteMoves: white.length, sacrifices: sacrifices.length, results: reviewed.review.results }, null, 2));
  await page.addInitScript(() => {
    const NativeWorker = window.Worker; window.engineSearchCount = 0;
    window.Worker = class extends NativeWorker { postMessage(message, ...args) { if (typeof message === 'string' && message.startsWith('go ')) window.engineSearchCount++; return super.postMessage(message, ...args); } };
  });
  const small = await page.evaluate(async () => {
    const { parsePgn } = await import('/src/core/pgn.ts'); const { analyzeGame } = await import('/src/core/analysis.ts');
    const game = parsePgn('[White "Player"]\n[Black "Opponent"]\n1. e4 e5 *');
    game.review = await analyzeGame(game, { depth: 4 }); game.review.createdAt = 1; game.notes = { 1: 'Keep my annotation' };
    return game;
  });
  async function activate(game) {
    await page.evaluate(async game => {
      const { saveGames } = await import('/src/core/storage.ts'); await saveGames([game]);
      localStorage.setItem('chessash:active', game.id); localStorage.setItem('chessash:language', 'en'); localStorage.setItem('chessash:prefs', JSON.stringify({ depth: 4 }));
    }, game);
    await page.reload(); await page.getByText('Review saved', { exact: false }).waitFor();
  }
  await activate(small);
  assert.equal(await page.evaluate(() => window.engineSearchCount), 0);
  await page.getByRole('button', { name: 'Reanalyse', exact: true }).click();
  await page.waitForFunction(() => window.engineSearchCount > 0);
  await page.getByText('Review saved', { exact: false }).waitFor({ timeout: 120000 });
  let fresh;
  for (let i = 0; i < 100; i++) {
    fresh = await page.evaluate(async id => { const { loadGames } = await import('/src/core/storage.ts'); return (await loadGames()).find(g => g.id === id); }, small.id);
    if (fresh?.review?.completed && fresh.review.createdAt > 1) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(fresh.review.createdAt > 1); assert.equal(fresh.notes[1], 'Keep my annotation');
  const searches = await page.evaluate(() => window.engineSearchCount);
  await page.getByRole('button', { name: 'Reanalyse', exact: true }).click();
  await page.waitForFunction(previous => window.engineSearchCount > previous, searches);
  await page.getByText('Review saved', { exact: false }).waitFor({ timeout: 120000 });
  await activate(reviewed);
  await page.getByRole('button', { name: 'Last move', exact: true }).click();
  assert.match(await page.locator('.message-quality').innerText(), /Sound sacrifice/);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('combobox', { name: 'Move-quality names', exact: true }).selectOption('chesscom');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  assert.match(await page.locator('.message-quality').innerText(), /Brilliant/);
  assert.equal(await page.evaluate(() => window.engineSearchCount), 0);
  assert.equal(await page.locator('.board-quality svg').getAttribute('data-quality-symbol'), '!!');
  await page.reload(); assert.match(await page.locator('.message-quality').innerText(), /Brilliant/);
  const mistake = structuredClone(small); mistake.lastPly = 1; mistake.review.results[0].label = 'mistake'; mistake.review.results[1].label = 'book';
  await activate(mistake);
  await page.getByRole('button', { name: 'First move', exact: true }).click(); await page.getByRole('button', { name: 'Next move', exact: true }).click();
  await page.locator('.quality-details summary').click();
  const colors = await page.evaluate(() => ({ board: getComputedStyle(document.querySelector('.board-quality')).backgroundColor, list: getComputedStyle(document.querySelector('.classifications .label-mistake')).color, symbol: document.querySelector('.board-quality svg')?.getAttribute('data-quality-symbol') }));
  assert.equal(colors.board, 'rgb(242, 160, 139)'); assert.equal(colors.symbol, '?');
  await page.getByRole('button', { name: 'Next move', exact: true }).click();
  assert.equal(await page.locator('.board-quality [data-quality-icon="book"]').count(), 1);
  assert.equal(await page.locator('.message-quality [data-quality-icon="book"]').count(), 1);
  assert.equal(await page.locator('.classifications .label-book [data-quality-icon="book"]').count(), 1);
  const live = await page.evaluate(async () => {
    const { parseLichessGames } = await import('/src/core/importer.ts');
    const data = await window.chessash.apiFetch('https://lichess.org/api/games/user/thibault?max=1&ongoing=false&finished=true&pgnInJson=true&moves=true&perfType=bullet,blitz,rapid,classical');
    const game = parseLichessGames(data)[0];
    const single = parseLichessGames(await window.chessash.apiFetch(`https://lichess.org/game/export/${game.id.slice(8)}?pgnInJson=true&moves=true`))[0];
    if (single?.id !== game.id) throw new Error('Live Lichess single-game import differs');
    return game;
  });
  assert.equal(live.source, 'Lichess'); assert.ok(live.moves.length > 0);
  const fixture = { id: 'AbCd1234', variant: 'standard', status: 'resign', speed: 'rapid', pgn: '[Event "Import fixture"]\n[Site "https://lichess.org/AbCd1234"]\n[White "FixturePlayer"]\n[Black "Opponent"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 1-0' };
  await app.evaluate((_electron, fixture) => { const original = globalThis.fetch; globalThis.fetch = async (url, options) => String(url).startsWith('https://lichess.org/') ? new Response(JSON.stringify(fixture), { status: 200, headers: { 'Content-Type': 'application/json' } }) : original(url, options); }, fixture);
  await page.getByRole('button', { name: 'Import game', exact: true }).click();
  await page.getByRole('combobox', { name: 'Game source', exact: true }).selectOption('lichess');
  await page.getByLabel('Lichess username', { exact: true }).fill('FixturePlayer');
  await page.getByRole('button', { name: 'Fetch finished games', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: /^Library(?:\s|$)/ }).click();
  await page.getByText('fixtureplayer · Lichess', { exact: true }).first().waitFor();
  await page.getByRole('button', { name: 'Settings', exact: true }).click(); await page.locator('#app-language').selectOption('it'); await page.getByRole('button', { name: 'Chiudi finestra', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.getByRole('button', { name: 'Importa partita', exact: true }).click();
  assert.equal(await page.getByRole('combobox', { name: 'Origine delle partite', exact: true }).inputValue(), 'lichess');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator('.modal-backdrop').evaluate(async element => { await Promise.all(element.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))); });
  await page.screenshot({ path: 'verification/testing-followup-lichess-phone.png' });
  assert.deepEqual(errors, []);
  await mkdir('verification', { recursive: true });
  await writeFile('verification/testing-followup-results.json', JSON.stringify({ passed: true, rookGame: { whiteMoves: white.length, sacrifices: sacrifices.length, results: reviewed.review.results }, freshSearches: searches, colors, liveLichess: { id: live.id, moves: live.moves.length }, checks: ['actual Stockfish/Foxash user PGN', 'two UI reanalyses issue new UCI searches', 'notes preserved', 'quality naming persists', 'matching symbols and original palette', 'shared book icon', 'live public Lichess username and single-game APIs', 'fixture-driven native-bridge import UI', 'Italian phone layout'], limitation: 'Controlled Electron and live public API responses; not physical Android or Chess.com classification parity.' }, null, 2));
  console.log('Testing follow-up smoke passed.');
} finally { if (app) await app.close(); await server.close(); }
