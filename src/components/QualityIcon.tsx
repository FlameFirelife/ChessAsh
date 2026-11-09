import { LABEL_INFO } from '../core/policy';
import type { Label } from '../core/types';
import { BookOpen } from 'lucide-react';

export default function QualityIcon({ label, size = 18 }: { label: Label; size?: number }) {
  const symbol = LABEL_INFO[label].symbol;
  if (label === 'book') return <BookOpen size={size} strokeWidth={2.6} aria-hidden="true" data-quality-symbol={symbol} data-quality-icon="book" />;
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" data-quality-symbol={symbol}>
    <text x="12" y="12.5" dominantBaseline="central" textAnchor="middle" fill="currentColor" fontFamily="Arial, sans-serif" fontWeight="800" fontSize={symbol.length > 1 ? 15 : 20}>{symbol}</text>
  </svg>;
}
