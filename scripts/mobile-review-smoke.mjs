import { _electron as electron } from 'playwright';
import { Chess } from 'chess.js';
import path from 'node:path';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const board = new Chess(), moves = ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3'], positions = [board.fen()], results = [];
for (const san of moves) { const m = board.move(san); positions.push(board.fen()); results.push({ ply: results.length + 1, move: m.lan, san: m.san, color: m.color, before: 0, after: 0, loss: 0, label: 'best', best: m.lan, pv: [m.lan], replyPv: [], depth: 14, explanation: 'fixture', hints: [], key: true }); }
const game = { id: 'mobile-review', headers: { Event: 'Mobile review layout', White: 'Player', Black: 'Opponent' }, moves, positions, pgn: board.pgn(), source: 'PGN', reviewAs: 'w', lastPly: 2, review: { version: 1, engine: 'fixture', depth: 14, completed: true, results }, notes: {} };
const app = await electron.launch({ args: ['.'], env: { ...process.env, CHESSASH_TEST: '1', CHESSASH_TEST_DATA: path.resolve('work/qa/mobile-review-' + Date.now()) } });
const checks = [], measurements = [], errors = [];
try {
  const page = await app.firstWindow(); page.setDefaultTimeout(12000); page.on('pageerror', e => errors.push(e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setMinimumSize(300, 400));
  await page.evaluate(async game => {
    localStorage.setItem('chessash:language', 'en'); localStorage.setItem('chessash:active', game.id);
    const db = await new Promise(resolve => { const r = indexedDB.open('chessash', 1); r.onupgradeneeded = () => r.result.createObjectStore('games', { keyPath: 'id' }); r.onsuccess = () => resolve(r.result); });
    await new Promise(resolve => { const t = db.transaction('games', 'readwrite'); t.objectStore('games').put(game); t.oncomplete = resolve; }); db.close();
  }, game);
  await mkdir('verification', { recursive: true });
  for (const [width, height, language, font, inset] of [[390,844,'en',16,32],[390,844,'it',16,32],[360,740,'it',16,32],[430,932,'en',20,32],[390,844,'it',20,32],[320,640,'it',16,24],[768,1024,'en',16,32],[1440,960,'en',16,0]]) {
    await page.evaluate(({ language, font }) => { localStorage.setItem('chessash:language', language); localStorage.setItem('chessash:prefs', JSON.stringify({ font, reduced: true })); }, { language, font });
    await page.setViewportSize({ width, height }); await page.reload(); await page.locator('.speech-text').waitFor();
    await page.evaluate(inset => { const s = document.documentElement.style; s.setProperty('--safe-area-inset-top', `${inset}px`); s.setProperty('--safe-area-inset-bottom', inset ? '24px' : '0px'); window.scrollTo(0, 0); }, inset);
    await page.waitForTimeout(100);
    const data = await page.evaluate(() => {
      const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; };
      return { header: rect('.app-header'), coach: rect('.review-message-slot'), board: rect('.chessboard'), controls: rect('.board-controls'), headerItemsFit: [...document.querySelectorAll('.app-header nav button, .header-actions button')].every(b => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && b.scrollWidth <= b.clientWidth + 1; }), controlItemsFit: [...document.querySelectorAll('.board-controls button')].every(b => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }), overflow: document.documentElement.scrollWidth > innerWidth };
    });
    measurements.push({ width, height, language, font, inset, ...data });
    assert.equal(data.overflow, false); assert.ok(data.headerItemsFit); assert.ok(data.controlItemsFit);
    assert.ok(Math.abs(data.board.width - data.board.height) < 1);
    if (width <= 780) {
      assert.equal(data.header.height, 56);
      assert.ok(data.board.width >= 238);
      await page.evaluate(() => { const top = document.querySelector('.review-message-slot').getBoundingClientRect().top + scrollY; const header = document.querySelector('.app-header').getBoundingClientRect().bottom; window.scrollTo(0, Math.max(0, top - header - 4)); });
      if (height >= 740) {
        const visible = await page.evaluate(() => { const h = document.querySelector('.app-header').getBoundingClientRect(), c = document.querySelector('.review-message-slot').getBoundingClientRect(), b = document.querySelector('.board-controls').getBoundingClientRect(); return { coachTop: c.top, headerBottom: h.bottom, controlsBottom: b.bottom }; });
        assert.ok(visible.coachTop >= visible.headerBottom - 1, JSON.stringify({ width, height, visible }));
        assert.ok(visible.controlsBottom <= height - 24 + 1, JSON.stringify({ width, height, visible }));
      }
      const before = await page.locator('.chessboard').evaluate(n => ({ top: n.getBoundingClientRect().top + scrollY, width: n.getBoundingClientRect().width }));
      await page.evaluate(() => document.querySelector('.coach-expansion').open = true);
      const after = await page.locator('.chessboard').evaluate(n => ({ top: n.getBoundingClientRect().top + scrollY, width: n.getBoundingClientRect().width }));
      assert.deepEqual(after, before);
      if (width === 390 && font === 16) await page.screenshot({ path: `verification/mobile-review-${language}.png` });
    } else assert.equal(data.header.height, 68);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => localStorage.setItem('chessash:language', 'en')); await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click(); await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Import game', exact: true }).click(); await page.getByRole('textbox', { name: 'Paste PGN' }).waitFor();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  checks.push('56px single-row review header retains Settings and Import', 'EN/IT, large text, safe-area and phone/tablet width matrix', 'coach, square board and navigation fit together on tested 740px+ portrait screens', 'short phones retain a readable board and scroll access', 'explanation disclosure keeps board fixed', 'desktop header unchanged');
  assert.deepEqual(errors, []);
  await writeFile('verification/mobile-review-results.json', JSON.stringify({ passed: true, checks, measurements, errors, limitation: 'Isolated Electron viewport/inset simulations; physical Android and browser keyboard behavior unverified.' }, null, 2));
  console.log('Mobile review space checks passed.');
} finally { await app.close(); }
