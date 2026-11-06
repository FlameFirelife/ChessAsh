import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadLanguage, translate } from '../src/i18n';

afterEach(() => vi.unstubAllGlobals());
describe('interface language', () => {
  it('translates the main review paths and preserves unknown game or user text', () => {
    expect(translate('it', 'Review')).toBe('Revisione');
    expect(translate('it', 'Explore')).toBe('Esplora');
    expect(translate('it', 'Review perspective')).toBe('Punto di vista della revisione');
    expect(translate('it', '1. e4 e5 2. Nf3')).toBe('1. e4 e5 2. Nf3');
    expect(translate('it', 'FlameDev_123')).toBe('FlameDev_123');
    expect(translate('en', 'Review')).toBe('Review');
  });
  it('uses natural Italian plurals for archive and import progress', () => {
    expect(translate('it', 'Latest 1 month')).toBe('Ultimo 1 mese');
    expect(translate('it', 'Latest 3 months')).toBe('Ultimi 3 mesi');
    expect(translate('it', 'Imported 1 game.')).toBe('Importata 1 partita.');
    expect(translate('it', 'Imported 2 games.')).toBe('Importate 2 partite.');
    expect(translate('it', 'Importing archive 2 of 3…')).toBe('Importazione dell’archivio 2 di 3…');
  });
  it('translates known native errors without changing credentials or game data', () => {
    expect(translate('it', "Error invoking remote method 'tutor:chat': Error: Select a model before asking the tutor.")).toBe('Seleziona un modello prima di fare una domanda.');
    expect(translate('it', 'Chess.com returned 429. Try again later or import a PGN.')).toContain('429');
    expect(translate('it', 'Player {name}', { name: 'FlameDev' })).toBe('Player FlameDev');
  });
  it('restores an explicit language and keeps existing installs in English until changed', () => {
    vi.stubGlobal('navigator', { language: 'it-IT' });
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'chessash:language' ? 'it' : null });
    expect(loadLanguage()).toBe('it');
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'chessash:prefs' ? '{}' : null });
    expect(loadLanguage()).toBe('en');
    vi.stubGlobal('localStorage', { getItem: () => null });
    expect(loadLanguage()).toBe('it');
  });
});
