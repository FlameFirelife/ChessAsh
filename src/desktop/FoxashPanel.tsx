import { useEffect, useState } from 'react';
import './desktop.css';
type Pack = { name: string; excellent: number; inaccuracy: number; mistake: number; blunder: number; version?: number };
type PolicyBridge = { policyGetPack(): Promise<Pack>; policySavePack(pack: Pack): Promise<void> };
const standard: Pack = { name: 'ChessAsh standard', version: 1, excellent: 15, inaccuracy: 45, mistake: 100, blunder: 250 };

export default function FoxashPanel({ onReclassify }: { onReclassify: () => void | Promise<void> }) {
  const bridge = (window as unknown as { chessash?: PolicyBridge }).chessash;
  const [pack, setPack] = useState<Pack>(standard);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { bridge?.policyGetPack?.().then(setPack).catch(() => {}); }, []);
  if (!bridge?.policyGetPack) return null;

  async function apply(value = pack) {
    setError(''); setNotice(''); setBusy(true);
    try { await bridge!.policySavePack(value); setPack(value); await onReclassify(); setNotice('Foxash rules applied to the current review.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not apply this pack.'); }
    finally { setBusy(false); }
  }
  function exportPack() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'chessash-coaching-pack.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <details className="foxash-panel">
    <summary>Foxash coaching rules</summary>
    <p className="muted">Foxash classifies moves and selects review moments and hints. Adjust loss thresholds in centipawns; 100 equals one pawn. Imported packs contain data only.</p>
    <label>Pack name<input value={pack.name} maxLength={80} onChange={e => setPack(x => ({ ...x, name: e.target.value }))} /></label>
    <div className="threshold-grid">{(['excellent', 'inaccuracy', 'mistake', 'blunder'] as const).map(key => <label key={key}>{key === 'excellent' ? 'Excellent maximum' : `${key[0].toUpperCase()}${key.slice(1)} minimum`}<input type="number" min={0} max={2000} value={pack[key]} onChange={e => setPack(x => ({ ...x, [key]: Number(e.target.value) }))} /></label>)}</div>
    <div className="button-row"><button onClick={() => apply()} disabled={busy}>{busy ? 'Applying…' : 'Apply rules'}</button><button onClick={() => apply(standard)} disabled={busy}>Restore defaults</button><button onClick={exportPack}>Export pack</button><label className="file-button">Import pack<input type="file" accept="application/json,.json" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; try { if (file.size > 4096) throw new Error('Pack is too large.'); const value = JSON.parse(await file.text()); await apply(value); } catch (error) { setError(error instanceof Error ? error.message : 'Invalid JSON pack.'); } e.target.value = ''; }} /></label></div>
    {error && <p role="alert" className="error">{error}</p>}{notice && <p role="status">{notice}</p>}
  </details>;
}
