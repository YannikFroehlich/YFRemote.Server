import { describe, expect, it } from 'vitest';
import { parseStoredLang, translate } from './translation';

describe('parseStoredLang', () => {
  it('accepts "en" and defaults everything else to "de"', () => {
    expect(parseStoredLang('en')).toBe('en');
    expect(parseStoredLang('de')).toBe('de');
    expect(parseStoredLang(null)).toBe('de');
    expect(parseStoredLang('fr')).toBe('de');
  });
});

describe('translate', () => {
  it('looks up a known key in the requested language', () => {
    expect(translate('de', 'common.save')).toBe('Speichern');
    expect(translate('en', 'common.save')).toBe('Save');
  });

  it('falls back to the key itself when no entry exists', () => {
    expect(translate('en', 'OK')).toBe('OK');
    expect(translate('de', 'F1')).toBe('F1');
  });

  it('substitutes {{placeholder}} tokens from params', () => {
    expect(translate('en', 'settings.rangeError', { min: '0.1', max: '3.0' })).toBe(
      'Value must be between 0.1 and 3.0.',
    );
  });

  it('leaves unknown placeholders empty instead of throwing', () => {
    expect(translate('en', 'common.save', { unused: 'x' })).toBe('Save');
  });
});
