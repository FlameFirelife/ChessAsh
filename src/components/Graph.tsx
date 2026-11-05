import { useId } from "react";
import type { MoveReview } from "../core";
export default function Graph({
  results,
  total,
  ply,
  onSelect,
}: {
  results: MoveReview[];
  total: number;
  ply: number;
  onSelect: (ply: number) => void;
}) {
  const id = "evaluation" + useId().replace(/:/g, "");
  const w = 640,
    h = 96;
  const scale = (n: number) => h / 2 - Math.tanh(n / 450) * (h / 2 - 5);
  const points = [
    `0,${scale(results[0]?.before || 0)}`,
    ...results.map(
      (r) => `${(r.ply / Math.max(total, 1)) * w},${scale(r.after)}`,
    ),
  ].join(" ");
  const end = ((results.at(-1)?.ply || 0) / Math.max(total, 1)) * w;
  const area = `M0,${h / 2} L${points.split(" ").join(" L")} L${end},${h / 2} Z`;
  return (
    <div className="eval-graph">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label="Game advantage. White above the centre line, Black below. Use the slider to select a move."
      >
        <defs>
          <linearGradient
            id={id + "-white"}
            x1="0"
            x2="0"
            y1="0"
            y2={h / 2}
            gradientUnits="userSpaceOnUse"
          >
            <stop
              offset="0"
              stopColor="var(--graph-positive)"
              stopOpacity=".7"
            />
            <stop
              offset="1"
              stopColor="var(--graph-positive)"
              stopOpacity="0"
            />
          </linearGradient>
          <linearGradient
            id={id + "-black"}
            x1="0"
            x2="0"
            y1={h / 2}
            y2={h}
            gradientUnits="userSpaceOnUse"
          >
            <stop
              offset="0"
              stopColor="var(--graph-negative)"
              stopOpacity=".08"
            />
            <stop
              offset="1"
              stopColor="var(--graph-negative)"
              stopOpacity=".65"
            />
          </linearGradient>
          <clipPath id={id + "-upper"}>
            <rect width={w} height={h / 2} />
          </clipPath>
          <clipPath id={id + "-lower"}>
            <rect y={h / 2} width={w} height={h / 2} />
          </clipPath>
        </defs>
        <path
          className="graph-positive-area"
          d={area}
          fill={`url(#${id}-white)`}
          clipPath={`url(#${id}-upper)`}
        />
        <path
          className="graph-negative-area"
          d={area}
          fill={`url(#${id}-black)`}
          clipPath={`url(#${id}-lower)`}
        />
        <line className="zero-line" x1="0" y1={h / 2} x2={w} y2={h / 2} />
        <polyline className="graph-line" points={points} />
        <line
          className="graph-cursor"
          x1="0"
          x2="0"
          y1="0"
          y2={h}
          style={{
            transform: `translateX(${(ply / Math.max(total, 1)) * w}px)`,
          }}
        />
      </svg>
      <input
        aria-label="Move on evaluation graph"
        type="range"
        min="0"
        max={total}
        value={ply}
        onChange={(e) => onSelect(Number(e.target.value))}
      />
      <div className="graph-caption">
        <span>White above / Black below</span>
        <span>
          Move {Math.ceil(ply / 2)} / {Math.ceil(total / 2)}
        </span>
      </div>
    </div>
  );
}
