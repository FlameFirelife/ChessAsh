import { useEffect, useRef, useState } from "react";

export default function AccuracyScore({ value, player, provisional, reduced }: {
  value: number; player: string; provisional: boolean; reduced: boolean;
}) {
  const target = Math.max(0, Math.min(100, value));
  const [display, setDisplay] = useState(0);
  const latest = useRef(0);
  useEffect(() => {
    if (reduced || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      latest.current = target;
      setDisplay(target);
      return;
    }
    const from = latest.current;
    let start = 0, frame = 0;
    const tick = (time: number) => {
      if (!start) start = time;
      const progress = Math.min(1, (time - start) / 650);
      latest.current = from + (target - from) * (1 - (1 - progress) ** 3);
      setDisplay(latest.current);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, reduced]);
  const circumference = 2 * Math.PI * 40;
  return <div className={`accuracy-score ${target >= 80 ? "accuracy-high" : target >= 50 ? "accuracy-mid" : "accuracy-low"}`}>
    <div className="accuracy-ring" role="img" aria-label={`${player}: ${target}% ChessAsh accuracy${provisional ? ", provisional" : ""}`} data-score={target}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="ring-track" cx="50" cy="50" r="40" />
        <circle className="ring-progress" cx="50" cy="50" r="40" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - display / 100)} />
      </svg>
      <strong aria-hidden="true">{Math.round(display)}<small>%</small></strong>
    </div>
    <span className="accuracy-player" title={player}>{player}</span>
    <span className="accuracy-caption">{provisional ? "Review in progress" : "Accuracy"}</span>
  </div>;
}
