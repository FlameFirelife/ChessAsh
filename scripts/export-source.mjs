import {cp,mkdir,readdir,rm,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd();
const out=path.join(root,'work','source','ChessAsh');
if(!out.startsWith(path.join(root,'work')+path.sep))throw new Error('Invalid staging path');
await mkdir(out,{recursive:true});
const excludes=new Set(['node_modules','work','release','.git','.private','.gradle','.idea','local.properties','tsconfig.tsbuildinfo']);
for(const entry of await readdir(root,{withFileTypes:true})){
 if(excludes.has(entry.name))continue;
 await cp(path.join(root,entry.name),path.join(out,entry.name),{recursive:true,filter:src=>{
  const relative=path.relative(root,src).replaceAll('\\','/');
  return !relative.split('/').some(p=>excludes.has(p))&&!relative.startsWith('android/app/build')&&!relative.startsWith('android/build')&&!relative.startsWith('android/app/src/main/assets/public')&&!relative.endsWith('.keystore')&&!relative.endsWith('.jks')&&!relative.endsWith('.dpapi');
 }});
}
await writeFile(path.join(out,'SOURCE-EXPORT.txt'),'Complete application source and bundled assets. Dependencies and SDK caches are omitted. Android signing keys are intentionally excluded. See README.md and PLATFORMS.md.\n');
console.log(out);
