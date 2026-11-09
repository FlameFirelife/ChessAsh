import { useEffect, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { Game } from '../core/types';
import type { QualityNames } from '../core/qualityNames';
import { CARD_DOWNLOAD_URL, cardCandidates, renderReviewCard } from '../core/reviewCard';
import type { CardKind } from '../core/reviewCard';
import { useLanguage } from '../i18n';

export default function ShareReview({ game, color, names, onClose }: { game: Game; color?: 'w' | 'b'; names: QualityNames; onClose: () => void }) {
  const { language } = useLanguage(), it = language === 'it';
  const [kind, setKind] = useState<CardKind>('best'), [ply, setPly] = useState(0), [players, setPlayers] = useState(false);
  const [image, setImage] = useState(''), [error, setError] = useState(''), [saving, setSaving] = useState(false), [saved, setSaved] = useState(false);
  const rows = cardCandidates(game, kind, color), result = rows.find(r => r.ply === ply) || rows[0];
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => { previous?.focus(); };
  }, []);
  useEffect(() => {
    let live = true; setImage(''); setError(''); setSaved(false);
    if (result) void renderReviewCard(game, result, { kind, language, names, showPlayers: players }).then(canvas => { if (live) setImage(canvas.toDataURL('image/png')); }).catch(e => { if (live) setError(String(e)); });
    return () => { live = false; };
  }, [game, result?.ply, kind, language, names, players]);
  async function share() {
    if (!image || saving) return;
    setSaving(true); setError('');
    try {
      const filename = `ChessAsh-${kind}-${result.ply}.png`;
      if (Capacitor.isNativePlatform()) {
        await registerPlugin<{ shareImage(options: { filename: string; base64: string }): Promise<void> }>('ChessAshFiles').shareImage({ filename, base64: image.split(',')[1] });
      } else {
        const bytes = Uint8Array.from(atob(image.split(',')[1]), char => char.charCodeAt(0));
        const file = new File([bytes], filename, { type: 'image/png' });
        if (!navigator.canShare?.({ files: [file] })) throw new Error(it ? 'Condivisione non disponibile qui. Salva il PNG per condividerlo.' : 'Sharing is unavailable here. Save the PNG to share it.');
        await navigator.share({ files: [file], title: 'ChessAsh', text: `https://${CARD_DOWNLOAD_URL}` });
      }
    } catch (e) { if (!(e instanceof Error && e.name === 'AbortError')) setError(String(e)); }
    finally { setSaving(false); }
  }
  async function save() {
    if (!image || saving) return; setSaving(true); setError('');
    try {
      const filename = `ChessAsh-${kind}-${result.ply}.png`;
      if (Capacitor.isNativePlatform()) {
        const outcome = await registerPlugin<{ saveImage(options: { filename: string; base64: string }): Promise<{ saved: boolean }> }>('ChessAshFiles').saveImage({ filename, base64: image.split(',')[1] });
        setSaved(outcome.saved);
      } else {
        const bytes = Uint8Array.from(atob(image.split(',')[1]), char => char.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
        const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000); setSaved(true);
      }
    } catch (e) { setError(String(e)); } finally { setSaving(false); }
  }
  return <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget && !saving) onClose(); }}>
    <section className="modal" role="dialog" aria-modal="true" aria-label={it ? 'Condividi revisione' : 'Share review'} onKeyDown={e => {
      if (e.key === 'Escape' && !saving) { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab') {
        const controls = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), select, input')];
        const first = controls[0], last = controls.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    }}>
      <div className="section-heading"><h2>{it ? 'Una partita da condividere' : 'A game worth sharing'}</h2><button autoFocus className="icon-button" aria-label={it ? 'Chiudi scheda' : 'Close share card'} disabled={saving} onClick={onClose}>×</button></div>
      <label>{it ? 'Momento' : 'Moment'}<select value={kind} onChange={e => { setKind(e.target.value as CardKind); setPly(0); }}><option value="best">{it ? 'Mossa migliore' : 'Best move'}</option><option value="blunder">{it ? 'Errore più grande' : 'Biggest mistake'}</option><option value="improvement">{it ? 'Miglioramento' : 'Improvement'}</option></select></label>
      {rows.length > 0 ? <label>{it ? 'Mossa' : 'Move'}<select value={result.ply} onChange={e => setPly(Number(e.target.value))}>{rows.map(r => <option key={r.ply} value={r.ply}>{game.positions[r.ply - 1].split(' ')[5]}{r.color === 'b' ? '…' : '.'} {r.san || game.moves[r.ply - 1]}</option>)}</select></label> : <p role="status">{it ? 'Nessuna mossa adatta in questa revisione. Prova un altro tipo di scheda.' : 'No matching moves in this review. Try another card type.'}</p>}
      <label className="check-label"><input type="checkbox" checked={players} onChange={e => setPlayers(e.target.checked)} />{it ? 'Mostra nomi dei giocatori' : 'Show player names'}</label>
      {image && <img src={image} alt={it ? 'Anteprima della scheda' : 'Review card preview'} style={{ width: '100%', borderRadius: 14 }} />}
      {error && <p role="alert">{error}</p>}
      <button className="primary" disabled={!image || saving} onClick={() => void share()}>{it ? 'Condividi' : 'Share'}</button>
      <button disabled={!image || saving} onClick={() => void save()}>{saving ? it ? 'Salvataggio…' : 'Saving…' : it ? 'Salva immagine PNG' : 'Save PNG image'}</button>
      {saved && <p role="status">{it ? 'Scheda esportata.' : 'Card exported.'}</p>}
    </section>
  </div>;
}
