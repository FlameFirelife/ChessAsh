import { Play, ChevronRight, RotateCcw } from "lucide-react";
import type { MoveReview } from "../core";
import { LABEL_INFO } from "../core";
import QualityIcon from "./QualityIcon";

const italianLabels: Record<MoveReview['label'], string> = {
  book: "Apertura", best: "Migliore", excellent: "Eccellente", good: "Buona", inaccuracy: "Imprecisione",
  mistake: "Errore", blunder: "Grave errore", miss: "Occasione mancata", great: "Mossa decisiva", sacrifice: "Sacrificio corretto",
};

function SuperKing() {
  return <img src={new URL("coach/super-king.svg", document.baseURI).href} alt="" />;
}

export default function ReviewMessage({
  result,
  text,
  detail,
  expandedDetail,
  language = "en",
  moveNumber,
  retryText,
  retry,
  busy,
  hasReview,
  onTry,
  onLine,
  onExit,
  onStart,
  onSquare,
}: {
  result?: MoveReview;
  text: string;
  detail?: string;
  expandedDetail?: string;
  language?: "en" | "it";
  moveNumber?: number;
  retryText: string;
  retry: boolean;
  busy: boolean;
  hasReview: boolean;
  onTry: () => void;
  onLine: () => void;
  onExit: () => void;
  onStart: () => void;
  onSquare: (square: string | null) => void;
}) {
  const it = language === "it";
  function linkedText(value: string) {
    return value.split(/(\b[a-h][1-8]\b)/g).map((part, index) => /^[a-h][1-8]$/.test(part)
      ? <button className="square-reference" key={index} onMouseEnter={() => onSquare(part)} onMouseLeave={() => onSquare(null)} onFocus={() => onSquare(part)} onBlur={() => onSquare(null)} onClick={() => onSquare(part)} aria-label={it ? `Evidenzia ${part} sulla scacchiera` : `Highlight ${part} on the board`}>{part}</button>
      : part);
  }
  return (
    <section className={`board-message ${result ? "message-" + result.label : ""}`} aria-label={it ? "Commento della revisione" : "Review coach"}>
      <div className="super-king-avatar"><SuperKing /></div>
      <div className="speech-bubble">
        <div className="speech-heading">
          <strong>{it ? "Allenatore" : "Coach"}</strong>
          {result && (
            <span key={`${result.ply}:${result.move}:${result.label}`} className={`message-quality quality-${result.label}`}>
              <QualityIcon label={result.label} size={15} />
              {moveNumber || Math.ceil(result.ply / 2)}{result.color === "b" ? "…" : "."} {result.san}{" "}
              <span>{it ? italianLabels[result.label] : LABEL_INFO[result.label].name}</span>
            </span>
          )}
        </div>
        <p className="speech-text">{linkedText(text)}</p>
        {detail && !retry && <p className="best-move-description">{linkedText(detail)}</p>}
          <details className="coach-expansion" hidden={!expandedDetail || retry}>
            <summary>{it ? "Spiegazione completa" : "Full explanation"}</summary>
            <p>{linkedText(expandedDetail || '')}</p>
          </details>
        {retryText && <p className="retry-feedback" role="status">{retryText}</p>}
        {result ? (
          <div className="speech-actions">
            <button className="primary" onClick={onTry} disabled={busy}><RotateCcw size={15} />{it ? "Riprova" : "Try again"}</button>
            <button onClick={onLine}><Play size={15} />{it ? "Mostra continuazione" : "Show line"}</button>
            {retry && <button className="text-button" onClick={onExit}>{it ? "Fine" : "Done"}</button>}
          </div>
        ) : hasReview ? (
          <button className="primary" onClick={onStart}>{it ? "Inizia la revisione guidata" : "Start walkthrough"}<ChevronRight size={16} /></button>
        ) : null}
      </div>
    </section>
  );
}
