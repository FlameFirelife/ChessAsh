import {
  BookOpen,
  Check,
  Star,
  Sparkles,
  AlertTriangle,
  X,
  Search,
  ArrowUpRight,
} from "lucide-react";
import type { Label } from "../core";
export default function QualityIcon({
  label,
  size = 18,
}: {
  label: Label;
  size?: number;
}) {
  const Icon =
    label === "book"
      ? BookOpen
      : label === "sacrifice"
        ? Sparkles
        : label === "great"
          ? Star
          : label === "best"
            ? Star
            : label === "excellent" || label === "good"
              ? Check
              : label === "blunder"
                ? X
                : label === "miss"
                  ? Search
                  : label === "inaccuracy"
                    ? ArrowUpRight
                    : AlertTriangle;
  return <Icon size={size} strokeWidth={2.6} aria-hidden="true" />;
}
