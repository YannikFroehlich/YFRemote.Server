import { describe, expect, it } from 'vitest';
import { hexToHsv, hsvToHex, parseHexColor } from './color';

describe('color', () => {
  it('parses short, long and unprefixed hex values', () => {
    expect(parseHexColor('#ABC')).toBe('#aabbcc');
    expect(parseHexColor(' 38bdf8 ')).toBe('#38bdf8');
    expect(parseHexColor('#12345')).toBeNull();
    expect(parseHexColor('red')).toBeNull();
  });

  it('round-trips hex through hsv', () => {
    for (const hex of [
      '#000000',
      '#ffffff',
      '#ff0000',
      '#00ff00',
      '#0000ff',
      '#38bdf8',
      '#7f3a12',
    ]) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
  });

  it('maps the hsv corners like the picker area', () => {
    expect(hexToHsv('#ff0000')).toEqual({ h: 0, s: 1, v: 1 });
    expect(hsvToHex({ h: 120, s: 1, v: 1 })).toBe('#00ff00');
    expect(hsvToHex({ h: 240, s: 0, v: 1 })).toBe('#ffffff');
    expect(hsvToHex({ h: 300, s: 1, v: 0 })).toBe('#000000');
  });
});
