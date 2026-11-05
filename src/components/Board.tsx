import { useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import type { Square } from "chess.js";
import type { Label } from "../core";
import QualityIcon from "./QualityIcon";

type PieceView = { id: number; sq: string; type: string; color: string };
export default function Board({
  fen,
  flipped,
  onMove,
  arrow,
  lastMove,
  quality,
  disabled = false,
}: {
  fen: string;
  flipped: boolean;
  onMove: (from: string, to: string, promotion?: string) => void;
  arrow?: string;
  lastMove?: string;
  quality?: { square: string; label: Label; name: string; key: string };
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [promotion, setPromotion] = useState<{
    from: string;
    to: string;
  } | null>(null);
  const [drawn, setDrawn] = useState<string[]>([]);
  const [start, setStart] = useState<string | null>(null);
  const chess = useMemo(() => new Chess(fen), [fen]);
  const pieceState = useRef<{
    fen: string;
    views: PieceView[];
    captured: PieceView[];
    next: number;
  }>({ fen: "", views: [], captured: [], next: 0 });
  if (pieceState.current.fen !== fen) {
    const previous = [...pieceState.current.views],
      next: PieceView[] = [];
    const squares = chess
      .board()
      .flat()
      .filter((p) => p !== null);
    const used = new Set<number>();
    for (const p of squares) {
      const existing = previous.find(
        (v) => v.sq === p.square && v.type === p.type && v.color === p.color,
      );
      if (existing) {
        next.push(existing);
        used.add(existing.id);
      }
    }
    for (const p of squares) {
      if (next.some((v) => v.sq === p.square)) continue;
      const candidate = previous
        .filter(
          (v) => !used.has(v.id) && v.type === p.type && v.color === p.color,
        )
        .sort((a, b) => {
          const dist = (s: string) =>
            Math.abs(s.charCodeAt(0) - p.square.charCodeAt(0)) +
            Math.abs(Number(s[1]) - Number(p.square[1]));
          return dist(a.sq) - dist(b.sq);
        })[0];
      const id = candidate?.id ?? pieceState.current.next++;
      used.add(id);
      next.push({ id, sq: p.square, type: p.type, color: p.color });
    }
    const captured =
      previous.length - next.length <= 1
        ? previous.filter((v) => !used.has(v.id))
        : [];
    pieceState.current = { ...pieceState.current, fen, views: next, captured };
  }
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
    setDrawn([]);
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
        aria-label="Chessboard. Select a piece then a destination; right-drag to draw arrows."
        onContextMenu={(e) => e.preventDefault()}
      >
        {Array.from(ranks).flatMap((rank, r) =>
          Array.from(files).map((file, c) => {
            const sq = file + rank;
            const p = chess.get(sq as Square);
            const light = (file.charCodeAt(0) - 97 + Number(rank)) % 2 === 0;
            return (
              <button
                key={sq + (quality?.square === sq ? quality.key : "")}
                className={`square ${light ? "light" : "dark"} ${selected === sq ? "selected" : ""} ${lastMove && (lastMove.slice(0, 2) === sq || lastMove.slice(2, 4) === sq) ? "last" : ""} ${quality?.square === sq ? "quality-square quality-" + quality.label : ""}`}
                aria-label={`${sq}${p ? " " + (p.color === "w" ? "White" : "Black") + " " + { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" }[p.type] : ""}`}
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
                  const from = e.dataTransfer.getData("text/plain");
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
                  if (e.button === 2) setStart(sq);
                }}
                onPointerUp={(e) => {
                  if (e.button === 2 && start && start !== sq) {
                    setDrawn((d) => [...d, start + sq]);
                    setStart(null);
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
        <div className="piece-layer" aria-hidden="true">
          {pieceState.current.captured.map((p) => (
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
          {pieceState.current.views.map((p) => (
            <img
              draggable="false"
              className="moving-piece"
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
            key={quality.key}
            className={`board-quality quality-${quality.label}`}
            role="img"
            aria-label={`${quality.name} on ${quality.square}`}
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
          {[...drawn, ...(arrow ? [arrow] : [])].map((a, i) => {
            const f = xy(a.slice(0, 2)),
              t = xy(a.slice(2, 4));
            return (
              <line
                key={i}
                data-suggestion={i >= drawn.length ? a : undefined}
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
        <div className="promotion" role="dialog" aria-label="Choose promotion">
          <strong>Promote to</strong>
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
                  { q: "Queen", r: "Rook", b: "Bishop", n: "Knight" } as Record<
                    string,
                    string
                  >
                )[p]
              }
            </button>
          ))}
          <button onClick={() => setPromotion(null)}>Cancel</button>
        </div>
      )}
    </div>
  );
}
