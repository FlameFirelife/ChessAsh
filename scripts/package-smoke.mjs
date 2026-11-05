import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
const root = process.cwd();
const profile = path.join(root, 'work', 'electron-smoke-profile');
await fs.mkdir(profile, { recursive: true });
const app = await electron.launch({ executablePath: path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'), args: [root], env: { ...process.env, CHESSASH_TEST: '1', CHESSASH_TEST_DATA: profile } });
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.chessash));
  const result = await page.evaluate(async () => {
    const bridge = window.chessash;
    const original = await bridge.policyGetPack();
    const facts = [{loss:120,playedBest:false,book:false,missedChance:false,critical:false,sacrifice:false,verified:false}];
    const standard = await bridge.reviewFacts(facts);
    await bridge.policySavePack({...original,name:'Smoke test',mistake:150});
    const changed = await bridge.reviewFacts(facts);
    await bridge.policySavePack(original);
    let blocked = false;
    try { await bridge.apiFetch('https://example.com/'); } catch { blocked = true; }
    await bridge.tutorSaveSettings({mode:'api',endpoint:'https://example.com/v1',model:'test',apiKey:'test-key-not-real'});
    const settings = await bridge.tutorGetSettings();
    await bridge.tutorSaveSettings({mode:'off',endpoint:'http://localhost:11434',model:'',clearKey:true});
    return { platform:bridge.platform,standard:standard[0].label,changed:changed[0].label,blocked,hasKey:settings.hasKey,keyAbsent:!settings.apiKey };
  });
  assert.equal(result.platform,'windows'); assert.equal(result.standard,'mistake'); assert.equal(result.changed,'inaccuracy');
  assert.equal(result.blocked,true); assert.equal(result.hasKey,true); assert.equal(result.keyAbsent,true);
  const encrypted = await fs.readFile(path.join(profile, 'tutor-settings.json'),'utf8');
  assert.ok(!encrypted.includes('test-key-not-real'));
  console.log('Electron smoke passed: sandbox bridge, Foxash rule change, API allowlist, encrypted credentials.');
} finally { await app.close(); }
