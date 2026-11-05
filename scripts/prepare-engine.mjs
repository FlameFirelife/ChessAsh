import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
await mkdir('public/engine',{recursive:true});
await copyFile('node_modules/stockfish/bin/stockfish-19-lite-single.js','public/engine/stockfish.js');
await copyFile('node_modules/stockfish/bin/stockfish-19-lite-single.wasm','public/engine/stockfish.wasm');
await copyFile('node_modules/stockfish/Copying.txt','public/engine/COPYING.txt').catch(async()=>writeFile('public/engine/COPYING.txt',await readFile('node_modules/stockfish/COPYING','utf8')));
console.log('Prepared Stockfish 19 lite single-thread engine.');
