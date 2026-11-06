import { useEffect, useMemo, useState } from "react";
import { Chess } from "chess.js";
import type { Square } from "chess.js";
import type { Label } from "../core";
import QualityIcon from "./QualityIcon";
import { initialBoardMotion, nextBoardMotion } from "../core/boardMotion";
import "../board-motion.css";

export default function Board({
  fen,
  flipped,
  onMove,
  arrow,
  comparison,
  threat,
  highlights = [],
  lastMove,
  quality,
  disabled = false,
  language = "en",
}: {
  fen: string;
  flipped: boolean;
  onMove: (from: string, to: string, promotion?: string) => void;
  arrow?: string;
  comparison?: { fen: string; move: string };
  threat?: string;
  highlights?: string[];
  lastMove?: string;
  quality?: { square: string; label: Label; name: string; key: string };
  disabled?: boolean;
  language?: "en" | "it";
}) {
  const [selection, setSelection] = useState<{ fen: string; square: string } | null>(null);
  const [promotionChoice, setPromotionChoice] = useState<{ fen: string; from: string; to: string } | null>(null);
  const [drawing, setDrawing] = useState<{ fen: string; arrows: string[]; start: string | null }>({ fen, arrows: [], start: null });
  const selected = selection?.fen === fen ? selection.square : null;
  const promotion = promotionChoice?.fen === fen ? promotionChoice : null;
  const drawn = drawing.fen === fen ? drawing.arrows : [];
  const start = drawing.fen === fen ? drawing.start : null;
  const setSelected = (square: string | null) => setSelection(square ? { fen, square } : null);
  const setPromotion = (choice: { from: string; to: string } | null) => setPromotionChoice(choice ? { fen, ...choice } : null);
  const chess = useMemo(() => new Chess(fen), [fen]);
  const alternative = useMemo(() => {
    if (!comparison || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(comparison.move)) return null;
    try {
      const previous = new Chess(comparison.fen);
      const piece = previous.get(comparison.move.slice(0, 2) as Square);
      const move = previous.move({ from: comparison.move.slice(0, 2), to: comparison.move.slice(2, 4), promotion: comparison.move[4] });
      return piece ? { move: move.lan, piece, from: move.from } : null;
    } catch { return null; }
  }, [comparison?.fen, comparison?.move]);
  const suggestion = alternative?.move || arrow;
  const [motion, setMotion] = useState(() => initialBoardMotion(fen));
  let pieces = motion;
  if (motion.fen !== fen) {
    pieces = nextBoardMotion(motion, fen);
    setMotion(pieces);
    if (selection) setSelection(null);
    if (promotionChoice) setPromotionChoice(null);
    if (drawing.fen !== fen) setDrawing({ fen, arrows: [], start: null });
  }
  useEffect(() => {
    const timer = setTimeout(() => setMotion(current => current.fen === fen && (current.captured.length || current.moving.length) ? { ...current, captured: [], moving: [] } : current), 440);
    return () => clearTimeout(timer);
  }, [fen]);
  const names = language === "it" ? { p: "pedone", n: "cavallo", b: "alfiere", r: "torre", q: "donna", k: "re" } : { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
  const files = flipped ? "hgfedcba" : "abcdefgh";
  const ranks = flipped ? "12345678" : "87654321";
  const legal = selected
    ? chess.moves({ square: selected as Square, verbose: true })
    : [];
  function choose(sq: string) {
    if (disabled) return;
    const candidate = legal.find((m) => m.to === sq);
    if (candidate && selected) {
      if (candidate.promotion) setPromotion({ from: selected, to: sq });
      else onMove(selected, sq);
      setSelected(null);
      return;
    }
    const piece = chess.get(sq as Square);
    setSelected(piece?.color === chess.turn() ? sq : null);
    setDrawing({ fen, arrows: [], start: null });
  }
  const xy = (sq: string) => ({
    x: files.indexOf(sq[0]) * 100 + 50,
    y: ranks.indexOf(sq[1]) * 100 + 50,
  });
  return (
    <div className="board-shell">
      <div
        className="chessboard"
        role="group"
        aria-label={language === "it" ? "Scacchiera. Seleziona un pezzo e poi una destinazione; trascina con il tasto destro per disegnare frecce." : "Chessboard. Select a piece then a destination; right-drag to draw arrows."}
        onContextMenu={(e) => e.preventDefault()}
      >
        {Array.from(ranks).flatMap((rank, r) =>
          Array.from(files).map((file, c) => {
            const sq = file + rank;
            const p = chess.get(sq as Square);
            const light = (file.charCodeAt(0) - 97 + Number(rank)) % 2 === 0;
            return (
              <button
                key={sq}
                className={`square ${light ? "light" : "dark"} ${selected === sq ? "selected" : ""} ${highlights.includes(sq) ? "review-focus" : ""} ${alternative && (alternative.move.slice(0, 2) === sq || alternative.move.slice(2, 4) === sq) ? "comparison-square" : ""} ${threat?.slice(2, 4) === sq ? "threat-target" : ""} ${lastMove && (lastMove.slice(0, 2) === sq || lastMove.slice(2, 4) === sq) ? "last" : ""} ${quality?.square === sq ? "quality-square quality-" + quality.label : ""}`}
                aria-label={`${sq}${p ? " " + (language === "it" ? (p.color === "w" ? "Bianco" : "Nero") : (p.color === "w" ? "White" : "Black")) + " " + names[p.type] : ""}`}
                onClick={() => choose(sq)}
                draggable={!!p && !disabled}
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", sq);
                  const image =
                    e.currentTarget.parentElement?.querySelector<HTMLImageElement>(
                      `img[data-square="${sq}"]`,
                    );
                  if (image)
                    e.dataTransfer.setDragImage(
                      image,
                      image.clientWidth / 2,
                      image.clientHeight / 2,
                    );
                  setSelected(sq);
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (disabled) return;
                  const from = e.dataTransfer.getData("text/plain");
                  if (!/^[a-h][1-8]$/.test(from)) return;
                  if (
                    chess
                      .moves({ square: from as Square, verbose: true })
                      .some((m) => m.to === sq)
                  ) {
                    if (
                      chess.get(from as Square)?.type === "p" &&
                      (rank === "1" || rank === "8")
                    )
                      setPromotion({ from, to: sq });
                    else onMove(from, sq);
                    setSelected(null);
                  }
                }}
                onPointerDown={(e) => {
                  if (e.button === 2) setDrawing({ fen, arrows: drawn, start: sq });
                }}
                onPointerUp={(e) => {
                  if (e.button === 2 && start && start !== sq) {
                    setDrawing({ fen, arrows: [...drawn, start + sq], start: null });
                  }
                }}
              >
                {c === 0 && <span className="rank coord">{rank}</span>}
                {r === 7 && <span className="file coord">{file}</span>}
                {legal.some((m) => m.to === sq) && (
                  <span className={p ? "capture-target" : "legal-target"} />
                )}
              </button>
            );
          }),
        )}
        {alternative && (
          <div className="comparison-source-layer" role="img" aria-label={language === "it" ? `Origine dell’alternativa nella posizione precedente: ${alternative.from}` : `Alternative origin in the previous position: ${alternative.from}`}>
            <span className="comparison-source" data-comparison-square={alternative.from} style={{ left: `${(files.indexOf(alternative.from[0]) + .5) * 12.5}%`, top: `${(ranks.indexOf(alternative.from[1]) + .5) * 12.5}%` }} />
          </div>
        )}
        <div className="piece-layer" aria-hidden="true">
          {pieces.captured.map((p) => (
            <img
              draggable="false"
              className="moving-piece captured-piece"
              key={"captured" + p.id}
              src={
                new URL(
                  `pieces/${p.color}${p.type.toUpperCase()}.svg`,
                  document.baseURI,
                ).href
              }
              alt=""
              style={{
                transform: `translate(${files.indexOf(p.sq[0]) * 100}%,${ranks.indexOf(p.sq[1]) * 100}%)`,
              }}
            />
          ))}
          {pieces.views.map((p) => (
            <img
              draggable="false"
              className={`moving-piece ${pieces.moving.includes(p.id) ? "piece-in-motion" : ""} ${selected === p.sq ? "piece-selected" : ""}`}
              data-piece-id={p.id}
              data-square={p.sq}
              key={p.id}
              src={
                new URL(
                  `pieces/${p.color}${p.type.toUpperCase()}.svg`,
                  document.baseURI,
                ).href
              }
              alt=""
              style={{
                transform: `translate(${files.indexOf(p.sq[0]) * 100}%,${ranks.indexOf(p.sq[1]) * 100}%)`,
              }}
            />
          ))}
        </div>
        {quality && (
          <div
            key={fen + ":" + quality.square}
            className={`board-quality quality-${quality.label}`}
            role="img"
            aria-label={`${quality.name} ${language === "it" ? "in" : "on"} ${quality.square}`}
            style={{
              left: `${(files.indexOf(quality.square[0]) + 1) * 12.5}%`,
              top: `${ranks.indexOf(quality.square[1]) * 12.5}%`,
            }}
          >
            <QualityIcon label={quality.label} size={17} />
          </div>
        )}
        <svg className="arrows" viewBox="0 0 800 800" aria-hidden="true">
          <defs>
            <marker id="threat-head" markerWidth="4" markerHeight="4" refX="4" refY="2" orient="auto">
              <path className="threat-head" d="M0,0 L4,2 L0,4 Z" />
            </marker>
            <marker
              id="suggestion-head"
              markerWidth="4"
              markerHeight="4"
              refX="4"
              refY="2"
              orient="auto"
            >
              <path className="suggestion-head" d="M0,0 L4,2 L0,4 Z" />
            </marker>
            <marker
              id="arrowhead"
              markerWidth="4"
              markerHeight="4"
              refX="4"
              refY="2"
              orient="auto"
            >
              <path d="M0,0 L4,2 L0,4 Z" />
            </marker>
          </defs>
          {threat && <line data-threat={threat} x1={xy(threat.slice(0, 2)).x} y1={xy(threat.slice(0, 2)).y} x2={xy(threat.slice(2, 4)).x} y2={xy(threat.slice(2, 4)).y} markerEnd="url(#threat-head)" />}
          {[...drawn, ...(suggestion ? [suggestion] : [])].map((a, i) => {
            const f = xy(a.slice(0, 2)),
              t = xy(a.slice(2, 4));
            return (
              <line
                key={i >= drawn.length ? "suggestion" : "drawn-" + a}
                data-suggestion={i >= drawn.length ? a : undefined}
                data-comparison={i >= drawn.length && alternative ? a : undefined}
                x1={f.x}
                y1={f.y}
                x2={t.x}
                y2={t.y}
                markerEnd="url(#arrowhead)"
              />
            );
          })}
        </svg>
      </div>
      {promotion && (
        <div className="promotion" role="dialog" aria-label={language === "it" ? "Scegli la promozione" : "Choose promotion"}>
          <strong>{language === "it" ? "Promuovi a" : "Promote to"}</strong>
          {["q", "r", "b", "n"].map((p) => (
            <button
              key={p}
              onClick={() => {
                onMove(promotion.from, promotion.to, p);
                setPromotion(null);
              }}
            >
              {
                (
                  (language === "it" ? { q: "Donna", r: "Torre", b: "Alfiere", n: "Cavallo" } : { q: "Queen", r: "Rook", b: "Bishop", n: "Knight" }) as Record<
                    string,
                    string
                  >
                )[p]
              }
            </button>
          ))}
          <button onClick={() => setPromotion(null)}>{language === "it" ? "Annulla" : "Cancel"}</button>
        </div>
      )}
    </div>
  );
}
