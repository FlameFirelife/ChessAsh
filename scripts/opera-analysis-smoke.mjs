import { chromium } from 'playwright';
import { createServer } from 'vite';
import { writeFile } from 'node:fs/promises';
const server = await createServer({ configFile: false, optimizeDeps: { entries: ['index.html'] }, server: { watch: { ignored: ['**/work/**', '**/android/**', '**/release/**'] }, host: '127.0.0.1', port: 5176, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5176/engine/COPYING.txt');
  await page.evaluate(() => { const base = document.createElement('base'); base.href = 'http://127.0.0.1:5176/'; document.head.append(base); });
  const result = await page.evaluate(async () => {
    const core = await import('/src/core/index.ts');
    const pgn = '1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0';
    const game = core.parsePgn(pgn);
    const review = await core.analyzeGame(game, { depth: 10 });
    return review;
  });
  await writeFile('work/opera-analysis.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result.results.slice(22).map(r => ({ ply: r.ply, san: r.san, label: r.label, before: r.before, after: r.after, mate: r.mate, loss: r.loss, facts: r.facts, best: r.best, pv: r.pv, replyPv: r.replyPv })), null, 2));
} finally { await browser.close(); await server.close(); }
