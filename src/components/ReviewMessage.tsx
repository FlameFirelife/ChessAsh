import { Lightbulb, Play, ChevronRight, RotateCcw } from "lucide-react";
import type { MoveReview } from "../core";
import { LABEL_INFO } from "../core";
import QualityIcon from "./QualityIcon";

function SuperKing() {
  return (
    <img src={new URL("coach/super-king.svg", document.baseURI).href} alt="" />
  );
}

export default function ReviewMessage({
  result,
  text,
  detail,
  hint,
  retryText,
  retry,
  busy,
  hasReview,
  onTry,
  onHint,
  onLine,
  onExit,
  onStart,
}: {
  result?: MoveReview;
  text: string;
  detail?: string;
  hint?: string;
  retryText: string;
  retry: boolean;
  busy: boolean;
  hasReview: boolean;
  onTry: () => void;
  onHint: () => void;
  onLine: () => void;
  onExit: () => void;
  onStart: () => void;
}) {
  return (
    <section
      className={`board-message ${result ? "message-" + result.label : ""}`}
      aria-label="Review coach"
    >
      <div className="super-king-avatar">
        <SuperKing />
      </div>
      <div className="speech-bubble" key={result?.ply || "welcome"}>
        <div className="speech-heading">
          <strong>Coach</strong>
          {result && (
            <span className={`message-quality quality-${result.label}`}>
              <QualityIcon label={result.label} size={15} />
              {Math.ceil(result.ply / 2)}
              {result.color === "b" ? "…" : "."} {result.san}{" "}
              <span>{LABEL_INFO[result.label].name}</span>
            </span>
          )}
        </div>
        <p className="speech-text">{text}</p>
        {hint && <p className="hint">{hint}</p>}
        {retryText && (
          <p className="retry-feedback" role="status">
            {retryText}
          </p>
        )}
        {result ? (
          <div className="speech-actions">
            <button className="primary" onClick={onTry} disabled={busy}>
              <RotateCcw size={15} />
              Try again
            </button>
            <button onClick={onHint} disabled={busy}>
              <Lightbulb size={15} />
              Hint
            </button>
            <button onClick={onLine}>
              <Play size={15} />
              Show line
            </button>
            {retry && (
              <button className="text-button" onClick={onExit}>
                Done
              </button>
            )}
            {detail && (
              <details className="coach-detail">
                <summary>Why?</summary>
                <p>{detail}</p>
              </details>
            )}
          </div>
        ) : hasReview ? (
          <button className="primary" onClick={onStart}>
            Start walkthrough
            <ChevronRight size={16} />
          </button>
        ) : null}
      </div>
    </section>
  );
}
