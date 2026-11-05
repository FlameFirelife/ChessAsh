import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { classify } from '../src/core/policy';
import type { ReviewFacts } from '../src/core/types';

const require = createRequire(import.meta.url);
const policy = require('../electron/policy.cjs');
const root = process.cwd();
const facts = (overrides: Partial<ReviewFacts> = {}): ReviewFacts => ({ loss: 0, playedBest: false, book: false, missedChance: false, critical: false, sacrifice: false, verified: false, ...overrides });

describe('Foxash review policy', () => {
  it('matches the shared default at boundaries and special categories using the real runtime', async () => {
    const fixtures: ReviewFacts[] = [];
    for (const loss of [0, 14, 15, 16, 44, 45, 99, 100, 249, 250, 1000]) {
      for (const playedBest of [true, false]) {
        fixtures.push(facts({ loss, playedBest }));
        fixtures.push(facts({ loss, playedBest, missedChance: true }));
      }
    }
    fixtures.push(facts({ book: true, loss: 300 }));
    fixtures.push(facts({ playedBest: true, sacrifice: true, verified: true }));
    fixtures.push(facts({ playedBest: true, sacrifice: true, verified: false }));
    fixtures.push(facts({ playedBest: true, critical: true, verified: true }));
    const output = await policy.reviewFacts(fixtures, root);
    expect(output.map((x: { label: string }) => x.label)).toEqual(fixtures.map(classify));
    expect(Object.values(output[0].counts).reduce((a: number, b) => a + Number(b), 0)).toBe(fixtures.length);
    expect(output.find((x: { label: string }) => x.label === 'blunder')).toMatchObject({ key: true, template: 'compare-continuation' });
  });

  it('changes the actual Foxash result when a valid coaching pack changes', async () => {
    const input = [facts({ loss: 150 })];
    const standard = await policy.reviewFacts(input, root);
    const custom = await policy.reviewFacts(input, root, { name: 'Strict', excellent: 10, inaccuracy: 30, mistake: 70, blunder: 140 });
    expect(standard[0].label).toBe('mistake');
    expect(custom[0].label).toBe('blunder');
  });

  it('rejects invalid packs rather than executing imported scripts', () => {
    expect(() => policy.validatePack({ excellent: 20, inaccuracy: 10, mistake: 100, blunder: 250 })).toThrow();
    expect(() => policy.validatePack({ excellent: 15, inaccuracy: 45, mistake: 100, blunder: 'execute' })).toThrow();
  });
});
