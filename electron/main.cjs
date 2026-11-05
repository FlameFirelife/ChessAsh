const { app, BrowserWindow, ipcMain, safeStorage, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

let mainWindow;
const apiCache = new Map();
const apiPending = new Map();
if (process.env.CHESSASH_TEST === '1' && process.env.CHESSASH_TEST_DATA) app.setPath('userData', path.resolve(process.env.CHESSASH_TEST_DATA));
const resourcesRoot = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
const isAppSender = event => event.sender === mainWindow?.webContents;
const handle = (name, fn) => ipcMain.handle(name, async (event, ...args) => {
  if (!isAppSender(event)) throw new Error('Untrusted caller');
  return fn(...args);
});
const settingsPath = () => path.join(app.getPath('userData'), 'tutor-settings.json');
const packPath = () => path.join(app.getPath('userData'), 'coaching-pack.json');
async function readPack() {
  const policy = require('./policy.cjs');
  try { return policy.validatePack(JSON.parse(await fs.readFile(packPath(), 'utf8'))); }
  catch (error) { if (error.code === 'ENOENT') return policy.defaults; throw error; }
}
async function readSettings() {
  try { return JSON.parse(await fs.readFile(settingsPath(), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return { mode: 'off', endpoint: 'http://localhost:11434', model: '' }; throw error; }
}
async function actualConfig(config) {
  const saved = await readSettings();
  const resolved = { ...saved, ...config };
  if (!resolved.apiKey && saved.encryptedKey && resolved.mode === 'api' && resolved.endpoint?.replace(/\/$/, '') === saved.endpoint?.replace(/\/$/, '')) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows credential encryption is unavailable.');
    resolved.apiKey = safeStorage.decryptString(Buffer.from(saved.encryptedKey, 'base64'));
  }
  delete resolved.encryptedKey;
  return resolved;
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  handle('api:fetch', async url => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'api.chess.com' || !parsed.pathname.startsWith('/pub/') || parsed.username || parsed.password) throw new Error('Only the documented Chess.com public API is allowed.');
    const cacheKey = parsed.href;
    const cached = apiCache.get(cacheKey);
    if (cached?.expires > Date.now()) return cached.value;
    if (apiPending.has(cacheKey)) return apiPending.get(cacheKey);
    const request = (async () => {
      const headers = { 'User-Agent': 'ChessAsh/1.0 (independent local chess analysis)' };
      if (cached?.etag) headers['If-None-Match'] = cached.etag;
      if (cached?.modified) headers['If-Modified-Since'] = cached.modified;
      const response = await fetch(parsed, { headers, redirect: 'error', signal: AbortSignal.timeout(30000) });
      if (!response.ok && response.status !== 304) throw new Error(`Chess.com returned ${response.status}. Try again later or import a PGN.`);
      const value = response.status === 304 && cached ? cached.value : await response.json();
      const seconds = Number(response.headers.get('Cache-Control')?.match(/max-age=(\d+)/)?.[1] || 60);
      apiCache.set(cacheKey, { value, expires: Date.now() + Math.max(1, seconds) * 1000, etag: response.headers.get('ETag') || cached?.etag, modified: response.headers.get('Last-Modified') || cached?.modified });
      return value;
    })();
    apiPending.set(cacheKey, request);
    try { return await request; } finally { apiPending.delete(cacheKey); }
  });
  handle('policy:review', async (facts, pack) => {
    if (!Array.isArray(facts) || facts.length > 4000) throw new Error('Invalid review data');
    return require('./policy.cjs').reviewFacts(facts, resourcesRoot, pack || await readPack());
  });
  handle('policy:pack:get', readPack);
  handle('policy:pack:save', async pack => {
    const validated = require('./policy.cjs').validatePack(pack);
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    await fs.writeFile(packPath(), JSON.stringify(validated));
    return validated;
  });
  handle('tutor:settings:get', async () => {
    const config = await readSettings();
    const hasKey = Boolean(config.encryptedKey);
    delete config.encryptedKey;
    delete config.apiKey;
    return { ...config, hasKey };
  });
  handle('tutor:settings:save', async config => {
    if (!config || !['off', 'ollama', 'api'].includes(config.mode)) throw new Error('Invalid tutor configuration');
    const saved = await readSettings();
    const next = { mode: config.mode, endpoint: String(config.endpoint || '').slice(0, 2048), model: String(config.model || '').slice(0, 250), encryptedKey: saved.encryptedKey };
    if (next.endpoint.replace(/\/$/, '') !== saved.endpoint?.replace(/\/$/, '')) delete next.encryptedKey;
    if (config.clearKey) delete next.encryptedKey;
    if (config.apiKey) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Cannot securely store an API key on this Windows account.');
      next.encryptedKey = safeStorage.encryptString(String(config.apiKey)).toString('base64');
    }
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    await fs.writeFile(settingsPath(), JSON.stringify(next), { mode: 0o600 });
    return { ...next, encryptedKey: undefined, hasKey: Boolean(next.encryptedKey) };
  });
  handle('tutor:models', async config => require('./tutor.cjs').listModels(await actualConfig(config)));
  handle('tutor:chat', async request => {
    if (!request || typeof request.requestId !== 'string') throw new Error('Invalid tutor request');
    return require('./tutor.cjs').chat({ ...request, config: await actualConfig(request.config) }, chunk => {
      if (!mainWindow?.isDestroyed()) mainWindow.webContents.send('tutor:chunk', chunk);
    });
  });
  handle('tutor:cancel', id => require('./tutor.cjs').cancel(id));
  mainWindow = new BrowserWindow({
    width: 1440, height: 960, minWidth: 840, minHeight: 640, title: 'ChessAsh', backgroundColor: '#211f1d', icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    show: process.env.CHESSASH_TEST !== '1',
    autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('file:') && !url.startsWith('http://127.0.0.1:5173/')) event.preventDefault(); });
  const devUrl = process.env.CHESSASH_DEV_URL;
  if (devUrl && /^http:\/\/127\.0\.0\.1:\d+\/$/.test(devUrl)) mainWindow.loadURL(devUrl);
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
});
app.on('window-all-closed', () => app.quit());
