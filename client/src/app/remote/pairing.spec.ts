import { describe, expect, it } from 'vitest';
import {
  DEVICE_NAME_MAX_LENGTH,
  guessDeviceName,
  isValidPin,
  normalizeDeviceName,
  normalizePin,
  parseStoredPairingToken,
  pinValidator,
} from './pairing';

describe('pairing', () => {
  describe('normalizePin / isValidPin', () => {
    it('accepts exactly six digits', () => {
      expect(isValidPin(normalizePin('123456'))).toBe(true);
      expect(isValidPin(normalizePin('  123456  '))).toBe(true);
      expect(isValidPin(normalizePin('000000'))).toBe(true);
    });

    it('rejects the wrong length or non-digit characters', () => {
      expect(isValidPin(normalizePin('12345'))).toBe(false);
      expect(isValidPin(normalizePin('1234567'))).toBe(false);
      expect(isValidPin(normalizePin('12a456'))).toBe(false);
      expect(isValidPin(normalizePin(''))).toBe(false);
    });
  });

  describe('normalizeDeviceName', () => {
    it('trims whitespace', () => {
      expect(normalizeDeviceName('  iPhone von Max  ')).toBe('iPhone von Max');
    });

    it('truncates to the maximum length', () => {
      const tooLong = 'a'.repeat(DEVICE_NAME_MAX_LENGTH + 10);
      expect(normalizeDeviceName(tooLong)).toBe('a'.repeat(DEVICE_NAME_MAX_LENGTH));
    });
  });

  describe('guessDeviceName', () => {
    it('falls back to a generic name when navigator is unavailable', () => {
      const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        get(): never {
          throw new Error('no navigator in this environment');
        },
      });

      expect(guessDeviceName()).toBe('Mein Gerät');

      if (originalDescriptor) {
        Object.defineProperty(globalThis, 'navigator', originalDescriptor);
      }
    });

    it.each([
      ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'iPhone'],
      ['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 'iPad'],
      ['Mozilla/5.0 (Linux; Android 14; Pixel 8)', 'Android-Gerät'],
      ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', 'Mac'],
      ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Windows-PC'],
      ['Mozilla/5.0 (X11; Linux x86_64)', 'Linux-Gerät'],
      ['SomeUnknownAgent/1.0', 'Mein Gerät'],
    ])('guesses a name for %s', (userAgent, expected) => {
      const spy = vi.spyOn(globalThis.navigator, 'userAgent', 'get').mockReturnValue(userAgent);

      expect(guessDeviceName()).toBe(expected);

      spy.mockRestore();
    });
  });

  describe('parseStoredPairingToken', () => {
    it('returns null for null or an empty string', () => {
      expect(parseStoredPairingToken(null)).toBeNull();
      expect(parseStoredPairingToken('')).toBeNull();
    });

    it('returns the stored value otherwise', () => {
      expect(parseStoredPairingToken('abc123')).toBe('abc123');
    });
  });

  describe('pinValidator', () => {
    it('flags invalid values and passes valid ones', () => {
      expect(pinValidator({ value: '123456' } as never)).toBeNull();
      expect(pinValidator({ value: '123' } as never)).toEqual({ pin: true });
      expect(pinValidator({ value: 42 } as never)).toEqual({ pin: true });
    });
  });
});
