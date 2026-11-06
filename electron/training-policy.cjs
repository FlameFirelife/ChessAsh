const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { promisify } = require('node:util');
const exec = promisify(require('node:child_process').execFile);
function validateFacts(facts) {
  if (!Array.isArray(facts) || facts.length > 20000) throw new Error('Invalid training facts.');
  return facts.map(fact => {
    if (!fact || typeof fact !== 'object') throw new Error('Invalid training fact.');
    const clean = {};
    for (const key of ['loss', 'attempts', 'solved', 'streak']) {
      if (!Number.isFinite(fact[key]) || fact[key] < 0 || fact[key] > 1000000 || (key !== 'loss' && !Number.isSafeInteger(fact[key]))) throw new Error('Invalid training history.');
      clean[key] = fact[key];
    }
    if (clean.solved > clean.attempts || clean.streak > clean.solved) throw new Error('Invalid training history.');
    for (const key of ['bestCapture', 'bestCheck', 'replyDanger', 'passed']) {
      if (typeof fact[key] !== 'boolean') throw new Error('Invalid training evidence.');
      clean[key] = fact[key];
    }
    for (const key of ['undefended','fork','backrank']) {
      if (fact[key] !== undefined && typeof fact[key] !== 'boolean') throw new Error('Invalid training evidence.');
      clean[key] = fact[key] === true;
    }
    return clean;
  });
}
async function trainingDecisions(input, resourcesPath) {
  const facts = validateFacts(input);
  let executable;
  for (const candidate of [path.join(resourcesPath, 'foxash/foxash.exe'), path.join(resourcesPath, 'resources/foxash/foxash.exe')]) {
    try { await fs.access(candidate); executable = candidate; break; } catch {}
  }
  if (!executable) throw new Error('The bundled Foxash runtime is missing. Reinstall ChessAsh.');
  if (!facts.length) return [];
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'chessash-training-'));
  try {
    await fs.writeFile(path.join(folder, 'training-facts.json'), JSON.stringify({count:facts.length,facts}));
    await exec(executable, ['run', path.join(resourcesPath, 'rules/training.foxash')], {cwd:folder,timeout:10000,windowsHide:true,maxBuffer:1024*1024});
    const rows = JSON.parse(await fs.readFile(path.join(folder, 'training-policy.json'), 'utf8'));
    if (!Array.isArray(rows) || rows.length !== facts.length || rows.some(row => !Array.isArray(row) || row.length !== 3 || !['capture','check','reply','improve','undefended','fork','backrank'].includes(row[0]) || !Number.isFinite(row[1]) || row[1] < 0 || row[1] > 5000000 || !Number.isSafeInteger(row[2]) || row[2] < 1 || row[2] > 31536000)) throw new Error('Foxash returned invalid training decisions.');
    return rows.map(([focus,priority,intervalSeconds]) => ({focus,priority,intervalSeconds}));
  } finally { await fs.rm(folder, {recursive:true,force:true}); }
}
module.exports = {trainingDecisions,validateFacts};
