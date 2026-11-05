const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const labels = ['book', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder', 'miss', 'great', 'sacrifice'];
const defaults = Object.freeze({ name: 'ChessAsh standard', version: 1, excellent: 15, inaccuracy: 45, mistake: 100, blunder: 250 });

function validatePack(pack = defaults) {
  if (!pack || typeof pack !== 'object') throw new Error('Invalid coaching pack.');
  const result = { name: String(pack.name || 'Custom pack').slice(0, 80), version: 1 };
  for (const key of ['excellent', 'inaccuracy', 'mistake', 'blunder']) {
    if (!Number.isFinite(pack[key]) || pack[key] < 0 || pack[key] > 2000) throw new Error('Coaching thresholds must be numbers from 0 to 2000 centipawns.');
    result[key] = pack[key];
  }
  if (!(result.excellent < result.inaccuracy && result.inaccuracy < result.mistake && result.mistake < result.blunder)) throw new Error('Thresholds must increase: excellent < inaccuracy < mistake < blunder.');
  return result;
}

async function reviewFacts(facts, resourcesPath, pack = defaults) {
  if (!Array.isArray(facts) || facts.length > 2000) throw new Error('Invalid review facts.');
  const moves = facts.map(value => {
    if (!value || !Number.isFinite(value.loss)) throw new Error('Invalid move loss.');
    const fact = { loss: Math.max(0, Math.min(100000, value.loss)) };
    for (const key of ['playedBest', 'book', 'missedChance', 'critical', 'sacrifice', 'verified']) fact[key] = value[key] === true;
    return fact;
  });
  const candidates = [path.join(resourcesPath, 'foxash', 'foxash.exe'), path.join(resourcesPath, 'resources', 'foxash', 'foxash.exe'), path.join(resourcesPath, 'bin', 'foxash.exe')];
  let executable;
  for (const candidate of candidates) { try { await fs.access(candidate); executable = candidate; break; } catch {} }
  if (!executable) throw new Error('The bundled Foxash runtime is missing. Reinstall ChessAsh.');
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'chessash-review-'));
  try {
    const script = path.join(resourcesPath, 'rules', 'review.foxash');
    await fs.writeFile(path.join(folder, 'facts.json'), JSON.stringify({ count: moves.length, moves, rules: validatePack(pack) }));
    await exec(executable, ['run', script], { cwd: folder, timeout: 10000, windowsHide: true, maxBuffer: 1024 * 1024 });
    const [rows, counts] = JSON.parse(await fs.readFile(path.join(folder, 'review.json'), 'utf8'));
    if (!Array.isArray(rows) || rows.length !== facts.length || rows.some(row => !Array.isArray(row) || !labels.includes(row[0]) || typeof row[1] !== 'boolean' || typeof row[2] !== 'string' || typeof row[3] !== 'string')) throw new Error('Foxash returned invalid policy output.');
    return rows.map(([label, key, template, hint], index) => ({ label, key, template, hint, counts: index === 0 ? Object.fromEntries(labels.map((label, i) => [label, counts[i]])) : undefined, policy: 'foxash-v1' }));
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
}

module.exports = { reviewFacts, validatePack, defaults };
