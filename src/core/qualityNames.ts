import { LABEL_INFO } from './policy';
import type { Label } from './types';

export type QualityNames = 'chessash' | 'chesscom';
const chessCom: Partial<Record<Label, string>> = { sacrifice: 'Brilliant', great: 'Great', book: 'Book', miss: 'Miss' };
export function qualityName(label: Label, style: QualityNames = 'chessash'): string {
  return style === 'chesscom' ? chessCom[label] || LABEL_INFO[label].name : LABEL_INFO[label].name;
}
