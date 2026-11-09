import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import QualityIcon from '../src/components/QualityIcon';
import { LABELS, LABEL_INFO } from '../src/core/policy';
import { qualityName } from '../src/core/qualityNames';
describe('quality presentation', () => {
  it('uses the same notation for every board and review quality icon', () => {
    for (const label of LABELS) {
      expect(renderToStaticMarkup(createElement(QualityIcon, { label }))).toContain(`data-quality-symbol="${LABEL_INFO[label].symbol}"`);
    }
    const book = renderToStaticMarkup(createElement(QualityIcon, { label: 'book' }));
    expect(book).toContain('lucide-book-open');
    expect(book).not.toContain('<text');
  });
  it('changes display names while preserving the same underlying labels', () => {
    expect(qualityName('sacrifice')).toBe('Sound sacrifice');
    expect(qualityName('sacrifice', 'chesscom')).toBe('Brilliant');
    expect(qualityName('great', 'chesscom')).toBe('Great');
    expect(qualityName('book', 'chesscom')).toBe('Book');
    expect(qualityName('miss', 'chesscom')).toBe('Miss');
    expect(qualityName('mistake', 'chesscom')).toBe('Mistake');
  });
});
