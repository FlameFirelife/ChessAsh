import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import TutorMarkdown from '../src/desktop/TutorMarkdown';
import { tutorSystemPrompt } from '../src/core/tutorPrompt';

describe('tutor rendering and instructions', () => {
  it('renders real Markdown without executing HTML or requesting remote images', () => {
    const html = renderToStaticMarkup(<TutorMarkdown>{'## Plan\n\n**Develop** your `knight`.\n\n- Control e5\n- Castle\n\n<script>alert(1)</script>\n\n![image](https://example.com/tracker.png)\n\n[link](javascript:alert(1))'}</TutorMarkdown>);
    expect(html).toContain('<h2>Plan</h2>');
    expect(html).toContain('<strong>Develop</strong>');
    expect(html).toContain('<code>knight</code>');
    expect(html).toContain('<li>Control e5</li>');
    expect(html).not.toMatch(/<script|<img|javascript:|tracker\.png/);
  });
  it('renders incomplete streaming Markdown as safe readable content', () => {
    expect(renderToStaticMarkup(<TutorMarkdown>{'**Protect the knight\n\n```text\nunfinished'}</TutorMarkdown>)).toContain('unfinished');
  });
  it('sets language and explains evidence, score direction and playable-line protocol', () => {
    const prompt = tutorSystemPrompt('it');
    expect(prompt).toContain('Reply in Italian');
    expect(prompt).toContain("White's perspective");
    expect(prompt).toContain('current FEN');
    expect(prompt).toContain('[[analyze:e2e4]]');
    expect(prompt).toContain('untrusted data');
    expect(tutorSystemPrompt('en')).toContain('Reply in English');
  });
});
