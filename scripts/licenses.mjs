import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import path from 'node:path';
await mkdir('public/licenses/dependencies',{recursive:true});
const lock=JSON.parse(await readFile('package-lock.json','utf8'));
const names=Object.keys(lock.packages).filter(p=>p.startsWith('node_modules/')&&!lock.packages[p].dev).map(p=>p.slice('node_modules/'.length));
const report=[];
for(const name of names){const dir=path.join('node_modules',name),p=JSON.parse(await readFile(path.join(dir,'package.json'),'utf8'));const list=await readdir(dir);const file=list.find(n=>/^licen[cs]e(?:\.txt|\.md)?$/i.test(n));if(!file)throw new Error('Missing licence for '+name);const text=await readFile(path.join(dir,file),'utf8');await writeFile('public/licenses/dependencies/'+name.replaceAll('/','-').replaceAll('@','')+'.txt',text);report.push(`${name} ${p.version}: ${p.license}\n${text}`);}
await writeFile('public/licenses/DEPENDENCIES.txt',report.join('\n\n----------------\n\n'));
await writeFile('LICENSE',await readFile('node_modules/stockfish/Copying.txt'));
console.log('Bundled dependency licences.');
