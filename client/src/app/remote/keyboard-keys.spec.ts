import { describe, expect, it } from 'vitest';
import {
  isSupportedKey,
  keysToAction,
  keySelectionValidator,
  MAX_HOTKEY_KEYS,
  normalizeKeySelection,
  SUPPORTED_KEYS,
} from './keyboard-keys';

describe('keyboard-keys', () => {
  it('recognizes supported keys case-insensitively', () => {
    expect(isSupportedKey('CTRL')).toBe(true);
    expect(isSupportedKey('ctrl')).toBe(true);
    expect(isSupportedKey('f5')).toBe(true);
    expect(isSupportedKey('a')).toBe(true);
  });

  it('rejects keys outside the server allowlist', () => {
    expect(isSupportedKey('HOME')).toBe(false);
    expect(isSupportedKey('PRINTSCREEN')).toBe(false);
    expect(isSupportedKey('')).toBe(false);
    expect(isSupportedKey('F13')).toBe(false);
  });

  it('has exactly the 62 keys supported by the server allowlist', () => {
    expect(SUPPORTED_KEYS.length).toBe(62);
  });

  it('normalizes a single key into a key action', () => {
    expect(keysToAction(['enter'])).toEqual({ type: 'key', keys: ['ENTER'] });
  });

  it('normalizes multiple distinct keys into a hotkey action', () => {
    expect(keysToAction(['ctrl', 'w'])).toEqual({ type: 'hotkey', keys: ['CTRL', 'W'] });
  });

  it('rejects an empty selection', () => {
    expect(keysToAction([])).toBeNull();
  });

  it('rejects duplicate keys, case-insensitively', () => {
    expect(keysToAction(['CTRL', 'ctrl'])).toBeNull();
  });

  it('rejects unsupported keys', () => {
    expect(keysToAction(['CTRL', 'HOME'])).toBeNull();
  });

  it(`rejects more than ${MAX_HOTKEY_KEYS} keys`, () => {
    expect(keysToAction(['CTRL', 'SHIFT', 'ALT', 'WIN', 'A'])).toBeNull();
  });

  it('drops blank entries before validating', () => {
    expect(normalizeKeySelection(['  ', 'ENTER'])).toEqual(['ENTER']);
  });

  it('validates a form control value via keySelectionValidator', () => {
    expect(keySelectionValidator({ value: ['ENTER'] } as never)).toBeNull();
    expect(keySelectionValidator({ value: [] } as never)).toEqual({ keys: true });
    expect(keySelectionValidator({ value: ['CTRL', 'CTRL'] } as never)).toEqual({ keys: true });
  });
});
