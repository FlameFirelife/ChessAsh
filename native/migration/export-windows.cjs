const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

async function jsonIfPresent(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}

async function run() {
  const [profileArgument, outputArgument, temp] = process.argv.slice(app.isPackaged ? 1 : 2);
  if (!profileArgument || !outputArgument || !temp) {
    throw new Error('Run Export-Windows.ps1 with the V1.5 profile and a new backup path.');
  }
  const profile = await fs.realpath(profileArgument);
  const output = path.resolve(outputArgument);
  if (!(await fs.stat(profile)).isDirectory()) throw new Error('The V1.5 profile path must be a directory.');
  let window;
  let snapshot;
  try {
    let found = false;
    for (const name of ['IndexedDB', 'Local Storage']) {
      try { await fs.cp(path.join(profile, name), path.join(temp, name), {
        recursive: true, filter: source => path.basename(source) !== 'LOCK',
      }); found = true; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (!found) throw new Error('This profile does not contain V1.5 library or settings storage.');
    app.setPath('userData', temp);
    await app.whenReady();
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_request, reply) => reply({ cancel: true }));
    window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    await window.loadFile(path.join(__dirname, 'legacy-origin.html'));
    const reader = await fs.readFile(path.join(__dirname, 'web', 'legacy-snapshot.js'), 'utf8');
    snapshot = await window.webContents.executeJavaScript(`(async () => {
      ${reader}
      return chessAshLegacySnapshot();
    })()`);
    const tutor = await jsonIfPresent(path.join(profile, 'tutor-settings.json'));
    if (tutor) snapshot.tutorSettings = { mode: tutor.mode, endpoint: tutor.endpoint, model: tutor.model };
    const coachingPack = await jsonIfPresent(path.join(profile, 'coaching-pack.json'));
    if (coachingPack) snapshot.coachingPack = coachingPack;
  } finally {
    window?.destroy();
  }
  const bytes = Buffer.from(JSON.stringify(snapshot));
  if (bytes.length > 128 * 1024 * 1024) throw new Error('The V1.5 backup exceeds 128 MB.');
  const file = await fs.open(output, 'wx', 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } catch (error) {
    await file.close();
    await fs.unlink(output);
    throw error;
  }
  await file.close();
  console.log(`Exported ${snapshot.games.length} games and ${Object.keys(snapshot.localStorage).length} settings.`);
}

app.on('window-all-closed', () => {});
run().then(() => app.exit(0), error => {
  console.error(error.message);
  app.exit(1);
});
