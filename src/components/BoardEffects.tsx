import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import type { Chess } from 'chess.js';
import type { Label } from '../core';
import QualityIcon from './QualityIcon';
import '../board-effects.css';

type Quality = { square: string; label: Label; name: string; key: string };

export default function BoardEffects({ chess, fen, flipped, quality, language, movingSquares }: {
  chess: Chess; fen: string; flipped: boolean; quality?: Quality; language: 'en' | 'it'; movingSquares: string[];
}) {
  const situation = useMemo(() => {
    const check = chess.isCheck();
    const terminal = check ? chess.isCheckmate() : chess.isStalemate();
    const king = chess.board().flat().find(p => p?.type === 'k' && p.color === chess.turn());
    return { kind: terminal ? check ? 'checkmate' : 'stalemate' : check ? 'check' : '', king: king?.square };
  }, [chess]);
  const place = (square: string): CSSProperties => ({
    left: `${((flipped ? 'hgfedcba' : 'abcdefgh').indexOf(square[0]) + .5) * 12.5}%`,
    top: `${((flipped ? '12345678' : '87654321').indexOf(square[1]) + .5) * 12.5}%`,
  });
  const title = situation.kind === 'checkmate' ? language === 'it' ? 'Scacco matto' : 'Checkmate'
    : situation.kind === 'stalemate' ? language === 'it' ? 'Stallo' : 'Stalemate'
      : language === 'it' ? 'Scacco' : 'Check';
  const brilliant = quality?.label === 'sacrifice';
  return <>
    <div className="board-arrivals" key={`arrival:${fen}`} aria-hidden="true">
      {movingSquares.map(square => <span key={square} className="move-arrival" style={place(square)} />)}
    </div>
    {quality && <div key={`quality:${quality.key}:${quality.label}`} className={`quality-effects quality-${quality.label}`} aria-hidden="true">
      <span className={`quality-landing ${brilliant ? 'sacrifice-landing' : ''}`} style={place(quality.square)}><i /><i /></span>
      {brilliant && <div className="sacrifice-sequence" data-animation="sound-sacrifice">
        <div className="sacrifice-vignette" />
        <div className="sacrifice-orbit"><i /><i /></div>
        <div className="sacrifice-sparks">{Array.from({ length: 12 }, (_, index) => <i key={index} style={{ '--angle': `${index * 30}deg`, '--delay': `${index % 3 * 25}ms` } as CSSProperties} />)}</div>
        <div className="sacrifice-title">
          <span className="sacrifice-emblem"><QualityIcon label="sacrifice" size={38} /><b>!!</b></span>
          <strong>{quality.name}</strong>
          <span className="sacrifice-rule" />
        </div>
      </div>}
    </div>}
    {situation.kind && <div className={`position-effects position-${situation.kind}`} key={`position:${fen}`}>
      <div aria-hidden="true" className="king-focus" style={situation.king ? place(situation.king) : undefined}><i /><i /></div>
      <div className="position-announcement" role="status" aria-label={title}>
        <span className="position-symbol" aria-hidden="true">{situation.kind === 'checkmate' ? '#' : situation.kind === 'stalemate' ? '½' : '+'}</span>
        <span>{title}</span>
      </div>
    </div>}
  </>;
}
