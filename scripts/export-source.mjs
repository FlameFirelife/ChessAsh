import {cp, mkdir, readdir, rm, writeFile, readFile} from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const {version} = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid source release version');
const exportRoot = path.join(root, 'work', 'source');
const out = path.join(exportRoot, 'ChessAsh-' + version);
if (path.dirname(out) !== exportRoot) throw new Error('Invalid staging path');

const excludedNames = new Set([
  '.git', '.private', '.release-upload', '.codex-attachments', '.gradle', '.idea',
  'node_modules', 'dist', 'work', 'release', 'verification', 'edit-studio', 'target',
  'local.properties', 'preview-animations.mjs', 'HANDOFF.md', 'STATUS.md', 'BUILDLOG.md',
  'NATIVE_REBUILD.md',
]);
const generatedPaths = [
  'android/build', 'android/app/build', 'android/capacitor-cordova-android-plugins',
  'android/app/src/main/assets/capacitor.config.json',
  'android/app/src/main/assets/capacitor.plugins.json', 'android/app/src/main/res/xml/config.xml',
  'android/app/src/main/assets/public', 'native/android/build', 'native/android/app/build',
  'native/android/app/src/main/jniLibs', 'native/engines', 'native/runtime',
];

function include(src) {
  const relative = path.relative(root, src).split(path.sep).join('/');
  const parts = relative.split('/');
  return !parts.some(part => excludedNames.has(part) ||
    (/^\.env(?:\.|$)/.test(part) && part !== '.env.example')) &&
    !generatedPaths.some(generated => relative === generated || relative.startsWith(generated + '/')) &&
    !/\.(keystore|jks|dpapi|pfx|p12|tsbuildinfo)$/i.test(relative);
}

await rm(out, {recursive: true, force: true});
await mkdir(out, {recursive: true});
for (const entry of await readdir(root)) {
  const src = path.join(root, entry);
  if (include(src)) await cp(src, path.join(out, entry), {recursive: true, filter: include});
}
await writeFile(path.join(out, 'SOURCE-EXPORT.txt'),
  'Complete application source and bundled assets. Dependencies and SDK caches are omitted. Android signing keys are intentionally excluded. See README.md and PLATFORMS.md.\n');
console.log(out);
