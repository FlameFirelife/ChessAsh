import { mkdir, writeFile, readFile, readdir, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';

await mkdir('public/pieces', { recursive: true });
const oldManifest = JSON.parse(await readFile('public/asset-sources.json', 'utf8'));
if (oldManifest.assets.some(a => a.file.startsWith('pieces/') && a.url?.includes('lichess'))) {
  await mkdir('work/previous-pieces', { recursive: true });
  for (const name of await readdir('public/pieces')) await rename('public/pieces/' + name, 'work/previous-pieces/' + name);
}

const shapes = {
  P: `<path d="M24 29C24 35 20 38 18 47C16 52 21 54 32 54S48 52 46 47C44 38 40 35 40 29Z"/>
      <path d="M23 35C20 42 22 47 28 48" fill="none" stroke="SHADE" stroke-width="5"/>
      <path d="M21 29C21 25 25 24 32 24S43 25 43 29S39 34 32 34S21 33 21 29Z"/>
      <circle cx="32" cy="18.5" r="11.5"/>
      <path d="M25 15C26 12 28 11 30 11" fill="none" stroke="HIGHLIGHT" stroke-width="3"/>`,
  R: `<path d="M20 27C23 34 20 39 18 47C16 51 21 54 32 54S48 51 46 47C44 39 41 34 44 27Z"/>
      <path d="M22 34C21 40 22 45 27 47" fill="none" stroke="SHADE" stroke-width="5"/>
      <path d="M15 13Q15 10 18 10H23Q26 10 26 13V19H29V13Q29 10 32 10H34Q37 10 37 13V19H40V13Q40 10 43 10H47Q50 10 50 13V27Q50 32 45 32H20Q15 32 15 27Z"/>
      <path d="M21 27H44" fill="none" stroke="SHADE" stroke-width="3"/>`,
  B: `<path d="M26 32C28 38 23 41 20 47C17 52 21 54 32 54S47 52 44 47C41 41 36 38 38 32Z"/>
      <path d="M25 42Q24 46 28 48" fill="none" stroke="SHADE" stroke-width="5"/>
      <path d="M32 10C28 15 17 20 18 29C19 36 25 39 32 39S45 36 46 29C47 20 36 15 32 10Z"/>
      <path d="M36 18L28 29" fill="none" stroke="DETAIL" stroke-width="3.6"/>
      <circle cx="32" cy="8.5" r="3.5"/>
      <path d="M24 23Q22 26 23 29" fill="none" stroke="HIGHLIGHT" stroke-width="3"/>`,
  N: `<path d="M17 49C18 42 22 36 29 31C24 30 23 35 18 34C13 33 12 28 15 24L23 15C23 10 24 6 27 6L34 13C47 13 51 26 50 37C49 43 47 47 47 51Z"/>
      <path d="M37 20C40 28 34 32 30 36C26 40 26 44 26 47" fill="none" stroke="SHADE" stroke-width="6"/>
      <path d="M27 11L30 15" fill="none" stroke="HIGHLIGHT" stroke-width="2.5"/>
      <path d="M25 22Q28 20 30 22" fill="none" stroke="DETAIL" stroke-width="3"/>
      <circle cx="19" cy="28" r="1.5" fill="DETAIL" stroke="none"/>
      <path d="M17 32Q20 33 22 30" fill="none" stroke="DETAIL" stroke-width="2"/>`,
  Q: `<path d="M24 31C27 37 24 41 20 47C17 52 21 54 32 54S47 52 44 47C40 41 37 37 40 31Z"/>
      <path d="M25 41Q24 45 28 48" fill="none" stroke="SHADE" stroke-width="5"/>
      <path d="M15 18C18 18 22 23 24 25L29 13Q32 8 35 13L40 25C42 23 46 18 49 18L45 34Q44 38 39 38H25Q20 38 19 34Z"/>
      <circle cx="15" cy="16.5" r="3.5"/><circle cx="32" cy="9" r="3.5"/><circle cx="49" cy="16.5" r="3.5"/>
      <path d="M24 32Q32 34 40 32" fill="none" stroke="SHADE" stroke-width="3"/>`,
  K: `<path d="M24 29C27 36 24 40 20 47C17 52 21 54 32 54S47 52 44 47C40 40 37 36 40 29Z"/>
      <path d="M25 41Q24 45 28 48" fill="none" stroke="SHADE" stroke-width="5"/>
      <path d="M29 7Q29 5 31 5H33Q35 5 35 7V12H41Q43 12 43 14V16Q43 18 41 18H35V25H29V18H23Q21 18 21 16V14Q21 12 23 12H29Z"/>
      <path d="M20 26C20 21 26 21 32 25C38 21 44 21 44 26C44 30 41 35 39 37H25C23 35 20 30 20 26Z"/>
      <path d="M25 30Q32 33 39 30" fill="none" stroke="SHADE" stroke-width="3"/>`
};

const manifest = oldManifest.assets.filter(a => !a.file.startsWith('pieces/'));
for (const color of ['w', 'b']) for (const type of Object.keys(shapes)) {
  const white = color === 'w';
  const edge = white ? '#64675f' : '#343631';
  const fill = white ? '#e2e4dc' : '#62645f';
  const detail = white ? '#64675f' : '#30322e';
  const base = white ? '#d5d8ce' : '#565853';
  const name = ({ P: 'pawn', N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king' })[type];
  const silhouette = type === 'N' ? shapes[type].replace(/<path\b[^>]*stroke="DETAIL"[^>]*\/>/g, '').replace(/<circle\b[^>]*fill="DETAIL"[^>]*\/>/g, '') : shapes[type];
  const shape = silhouette
    .replace(/<path\b[^>]*stroke="(?:SHADE|HIGHLIGHT)"[^>]*\/>/g, '')
    .replace(/stroke="DETAIL" stroke-width="[^"]+"/g, 'stroke="DETAIL" stroke-width="1.8"')
    .replaceAll('DETAIL', detail);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><title>${white ? 'White' : 'Black'} ${name}</title><g fill="${fill}" stroke="${edge}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${shape}<path d="M18 49C13 49 11 52 11 55C11 59 16 60 32 60S53 59 53 55C53 52 51 49 46 49Z" fill="${base}"/></g></svg>\n`;
  const file = `pieces/${color}${type}.svg`;
  await writeFile('public/' + file, svg);
  manifest.push({ file, origin: 'Original ChessAsh artwork', source: 'scripts/create-pieces.mjs', license: 'GPL-3.0-or-later', sha256: createHash('sha256').update(svg).digest('hex') });
}
await writeFile('public/pieces/NOTICE.md', '# ChessAsh pieces\n\nOriginal rounded SVG chess pieces created for ChessAsh. Their editable source is scripts/create-pieces.mjs. Distributed with ChessAsh under GPL-3.0-or-later. These assets do not use Lichess or Chess.com artwork.\n');
await writeFile('public/asset-sources.json', JSON.stringify({ updated: '2026-11-05', assets: manifest }, null, 2));
console.log('Created twelve original soft ChessAsh pieces.');
