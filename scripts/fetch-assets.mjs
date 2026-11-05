import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const fonts = [
  ['host-grotesk-latin.woff2', 'https://fonts.gstatic.com/s/hostgrotesk/v5/co3BmWBnlCJ3U42vbbfdwMjZpFjm.woff2'],
  ['host-grotesk-latin-ext.woff2', 'https://fonts.gstatic.com/s/hostgrotesk/v5/co3BmWBnlCJ3U42vbbfdwMjZqljm0U0.woff2'],
  ['atkinson-hyperlegible-mono-latin.woff2', 'https://fonts.gstatic.com/s/atkinsonhyperlegiblemono/v8/tss4AoFBci4C4gvhPXrt3wjT1MqSzhA4t7IIcncBiwKthFw.woff2'],
  ['atkinson-hyperlegible-mono-latin-ext.woff2', 'https://fonts.gstatic.com/s/atkinsonhyperlegiblemono/v8/tss4AoFBci4C4gvhPXrt3wjT1MqSzhA4t7IIcncBiwKjhFyRHQ.woff2'],
  ['Host-Grotesk-OFL.txt', 'https://raw.githubusercontent.com/google/fonts/main/ofl/hostgrotesk/OFL.txt'],
  ['Atkinson-Hyperlegible-Mono-OFL.txt', 'https://raw.githubusercontent.com/google/fonts/main/ofl/atkinsonhyperlegiblemono/OFL.txt'],
];
const manifest = [];
for (const [folder, files] of [['fonts', fonts]]) {
  await mkdir(`public/${folder}`, { recursive: true });
  await Promise.all(files.map(async ([filename, url]) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${filename}: HTTP ${response.status}`);
    const data = Buffer.from(await response.arrayBuffer());
    if (filename.endsWith('.svg') && !data.toString().includes('<svg')) throw new Error(`Invalid SVG: ${filename}`);
    if (filename.endsWith('.woff2') && data.subarray(0, 4).toString() !== 'wOF2') throw new Error(`Invalid WOFF2: ${filename}`);
    await writeFile(`public/${folder}/${filename}`, data);
    manifest.push({ file: `${folder}/${filename}`, url, sha256: createHash('sha256').update(data).digest('hex') });
  }));
}
await writeFile('public/asset-sources.json', JSON.stringify({ retrieved: '2026-11-05', assets: manifest.sort((a, b) => a.file.localeCompare(b.file)) }, null, 2));
console.log(`Downloaded and validated ${manifest.length} licensed interface assets.`);
await import('./create-pieces.mjs');
