import {cp,mkdir,readdir,rm,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd();
const {version}=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
if(!/^\d+\.\d+\.\d+$/.test(version))throw new Error('Invalid source release version');
const out=path.join(root,'work','source',`ChessAsh-${version}`);
if(!out.startsWith(path.join(root,'work','source')+path.sep))throw new Error('Invalid staging path');
await rm(out,{recursive:true,force:true});
await mkdir(out,{recursive:true});
const excludes=new Set(['node_modules','dist','work','release','verification','.git','.private','.release-upload','.gradle','.idea','local.properties','tsconfig.tsbuildinfo','preview-animations.mjs','HANDOFF.md','STATUS.md','BUILDLOG.md','NATIVE_REBUILD.md']);
for(const entry of await readdir(root,{withFileTypes:true})){
 if(excludes.has(entry.name))continue;
 await cp(path.join(root,entry.name),path.join(out,entry.name),{recursive:true,filter:src=>{
  const relative=path.relative(root,src).replaceAll('\\','/');
  return !relative.split('/').some(p=>excludes.has(p)||(/^\.env(?:\.|$)/.test(p)&&p!=='.env.example'))&&!(relative.startsWith('android/') && relative.split('/').includes('build'))&&!relative.startsWith('android/build')&&!relative.startsWith('android/app/src/main/assets/public')&&!/\.(keystore|jks|dpapi|pfx|p12)$/i.test(relative);
 }});
}
await writeFile(path.join(out,'SOURCE-EXPORT.txt'),'Complete application source and bundled assets. Dependencies and SDK caches are omitted. Android signing keys are intentionally excluded. See README.md and PLATFORMS.md.\n');
console.log(out);
