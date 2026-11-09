import { Chess } from 'chess.js';
import type { Game, MoveReview } from './types';
import { qualityName } from './qualityNames';
import type { QualityNames } from './qualityNames';
import { reviewCoaching } from './coaching';
import { translate } from '../i18n';

export type CardKind = 'best' | 'blunder' | 'improvement';
export const CARD_DOWNLOAD_URL = 'github.com/FlameFirelife/ChessAsh';
export function cardCandidates(game: Game, kind: CardKind, color?: 'w' | 'b'): MoveReview[] {
  const rows = (game.review?.results || []).filter(r => (!color || r.color === color) && !r.consequenceOf);
  if (kind === 'best') return rows.filter(r => ['sacrifice', 'great', 'best', 'excellent', 'good'].includes(r.label)).sort((a, b) => (['sacrifice', 'great', 'best', 'excellent', 'good'].indexOf(a.label) - ['sacrifice', 'great', 'best', 'excellent', 'good'].indexOf(b.label)) || a.loss - b.loss || a.ply - b.ply);
  return rows.filter(r => {
    if (r.loss <= 0) return false;
    if (kind !== 'improvement') return true;
    try { const board = new Chess(game.positions[r.ply - 1]); return r.best !== r.move && !!board.move(r.best); } catch { return false; }
  }).sort((a, b) => b.loss - a.loss || a.ply - b.ply);
}

export async function renderReviewCard(game: Game, result: MoveReview, options: { kind: CardKind; language: 'en' | 'it'; names: QualityNames; showPlayers: boolean }): Promise<HTMLCanvasElement> {
  const { kind, language } = options, it = language === 'it';
  const before = new Chess(game.positions[result.ply - 1]);
  const chosen = kind === 'improvement' ? result.best : result.move;
  const move = before.move(chosen), board = before;
  const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1350;
  const c = canvas.getContext('2d'); if (!c) throw new Error('Image export is unavailable.');
  await document.fonts.ready;
  const box = (x: number, y: number, w: number, h: number, color: string, radius = 0) => { c.fillStyle = color; c.beginPath(); c.roundRect(x, y, w, h, radius); c.fill(); };
  const text = (value: string, x: number, y: number, size: number, color = '#f4f7ed', weight = 500, max = 952) => {
    c.font = `${weight} ${size}px "Host Grotesk", sans-serif`; c.fillStyle = color;
    let fitted = value; while (c.measureText(fitted).width > max && fitted.length) fitted = fitted.slice(0, -1);
    c.fillText(fitted === value ? value : fitted.trimEnd() + '…', x, y);
  };
  box(0, 0, 1080, 1350, '#2b2e28'); box(30, 30, 1020, 1290, '#3a4035', 34);
  text('ChessAsh', 64, 88, 22, '#bfcbb4', 700);
  text(kind === 'best' ? it ? 'Mossa migliore' : 'Best move' : kind === 'blunder' ? it ? 'Errore più grande' : 'Biggest mistake' : it ? 'Mossa migliore da provare' : 'Better move', 64, 157, 46, '#f4f7ed', 700);
  const number = game.positions[result.ply - 1].split(' ')[5];
  const label = kind === 'improvement' ? it ? 'Alternativa analizzata' : 'Analysed alternative' : translate(language, qualityName(result.label, options.names));
  text(`${number}${result.color === 'b' ? '…' : '.'} ${move.san}`, 64, 224, 44, '#b3db7b', 700, 470);
  text(label, 540, 222, 27, '#dce4d2', 600, 470);
  text(options.showPlayers ? `${game.headers.White || 'White'} vs ${game.headers.Black || 'Black'}` : it ? 'Una posizione dalla mia partita' : 'A position from my game', 64, 268, 24, '#bfcbb4');
  const left = 104, top = 300, cell = 109, flipped = result.color === 'b';
  const files = flipped ? 'hgfedcba' : 'abcdefgh', ranks = flipped ? '12345678' : '87654321';
  const images = new Map<string, HTMLImageElement>();
  await Promise.all([...new Set(board.board().flat().filter(Boolean).map(p => `${p!.color}${p!.type.toUpperCase()}`))].map(async key => {
    const image = new Image(); image.src = new URL(`pieces/${key}.svg`, document.baseURI).href; await image.decode(); images.set(key, image);
  }));
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    const square = files[col] + ranks[row], x = left + col * cell, y = top + row * cell;
    box(x, y, cell, cell, (row + col) % 2 ? '#86a36b' : '#e8edd5');
    if (square === move.from || square === move.to) { c.fillStyle = '#d4df6e66'; c.fillRect(x, y, cell, cell); }
    const piece = board.get(square as Parameters<Chess['get']>[0]);
    if (piece) c.drawImage(images.get(`${piece.color}${piece.type.toUpperCase()}`)!, x + 6, y + 6, cell - 12, cell - 12);
  }
  for (let i = 0; i < 8; i++) { text(files[i], left + i * cell + 48, top + cell * 8 + 27, 19, '#bfcbb4'); text(ranks[i], 76, top + i * cell + 64, 19, '#bfcbb4'); }
  const copy = kind === 'improvement' ? `${it ? 'Giocata' : 'Played'}: ${result.san || game.moves[result.ply - 1]}. ${reviewCoaching(game, result, { language, playerColor: result.color }).alternativeReason || (it ? 'Confronta questa continuazione con la mossa originale.' : 'Compare this continuation with the original move.')}` : reviewCoaching(game, result, { language, playerColor: result.color }).text;
  c.font = '500 25px "Host Grotesk", sans-serif';
  const words = copy.split(/\s+/); let line = '', y = 1234;
  for (const word of words) {
    if (c.measureText(line + ' ' + word).width > 942 && line) { text(line, 64, y, 25); y += 33; line = ''; if (y > 1267) { line = '…'; break; } }
    line += (line ? ' ' : '') + word;
  }
  if (line) text(line, 64, y, 25);
  text('Reviewed with ChessAsh', 64, 1300, 18, '#bfcbb4');
  text(CARD_DOWNLOAD_URL, 362, 1300, 16, '#bfcbb4', 500, 650);
  return canvas;
}
