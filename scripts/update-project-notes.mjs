import {readFile,writeFile,copyFile,mkdir} from 'node:fs/promises';
const repo='https://github.com/FlameFirelife/foxash/';
for(const file of ['README.md','HANDOFF.md','BUILDLOG.md','PLATFORMS.md','NATIVE_REBUILD.md','rules/README.md']){
 let text=await readFile(file,'utf8');
 if(!text.includes(repo))text+='\n## Foxash source\n\nFoxash by FlameDev Studios: [github.com/FlameFirelife/foxash]('+repo+'). Windows bundles the runtime and corresponding source archive.\n';
 await writeFile(file,text);
}
await mkdir('public/licenses',{recursive:true});
await copyFile('THIRD_PARTY_NOTICES.md','public/licenses/THIRD_PARTY_NOTICES.md');
await copyFile('CREDITS.md','public/licenses/CREDITS.md');
console.log('Updated documentation and in-app licence copies.');
