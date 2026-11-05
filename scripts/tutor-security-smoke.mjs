import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
await mkdir('work/qa', { recursive: true });
const credentials = [];
const server = createServer((request, response) => {
  credentials.push({ url: request.url, authorization: request.headers.authorization || '' });
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ data: [{ id: 'security-test' }] }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${server.address().port}`;
const profile = path.resolve('work/tutor-security-profile');
const app = await electron.launch({ args: ['.'], env: { ...process.env, CHESSASH_TEST_DATA: profile, CHESSASH_TEST: '1' } });
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.chessash);
  const first = { mode: 'api', endpoint: endpoint + '/one', model: 'security-test', apiKey: 'chessash-dummy-key-for-security-test' };
  await page.evaluate(config => window.chessash.tutorSaveSettings(config), first);
  const publicConfig = await page.evaluate(() => window.chessash.tutorGetSettings());
  assert.equal(publicConfig.hasKey, true);
  assert.equal(publicConfig.apiKey, undefined);
  assert.equal(publicConfig.encryptedKey, undefined);
  const disk = await readFile(path.join(profile, 'tutor-settings.json'), 'utf8');
  assert.equal(disk.includes(first.apiKey), false);
  await page.evaluate(config => window.chessash.tutorModels(config), { ...first, apiKey: '' });
  await page.evaluate(config => window.chessash.tutorModels(config), { ...first, endpoint: endpoint + '/two', apiKey: '' });
  assert.equal(credentials[0].authorization, 'Bearer ' + first.apiKey);
  assert.equal(credentials[1].authorization, '');
  await page.evaluate(config => window.chessash.tutorSaveSettings(config), { ...first, apiKey: '', clearKey: true });
  const cleared = await page.evaluate(() => window.chessash.tutorGetSettings());
  assert.equal(cleared.hasKey, false);
  await writeFile('work/qa/tutor-security-results.json', JSON.stringify({ passed: true, checks: ['API key encrypted on disk', 'key excluded from renderer settings', 'key bound to configured endpoint', 'explicit key removal'] }, null, 2));
  console.log('TUTOR CREDENTIAL SECURITY PASS');
} finally {
  await app.close();
  await new Promise(resolve => server.close(resolve));
}
