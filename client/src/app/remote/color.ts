/** Farbton 0-360, Saettigung und Helligkeit 0-1 - die Achsen des Farbfelds im Farbwaehler. */
export interface Hsv {
  readonly h: number;
  readonly s: number;
  readonly v: number;
}

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Nimmt "#abc", "abc", "#aabbcc" oder "AABBCC" an und liefert "#aabbcc", sonst null. */
export function parseHexColor(text: string): string | null {
  const match = HEX_PATTERN.exec(text.trim());
  if (match === null) {
    return null;
  }
  const digits = match[1].toLowerCase();
  return digits.length === 3
    ? `#${digits[0]}${digits[0]}${digits[1]}${digits[1]}${digits[2]}${digits[2]}`
    : `#${digits}`;
}

export function hexToHsv(hex: string): Hsv {
  const value = parseHexColor(hex) ?? '#000000';
  const r = parseInt(value.slice(1, 3), 16) / 255;
  const g = parseInt(value.slice(3, 5), 16) / 255;
  const b = parseInt(value.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);

  let h = 0;
  if (delta > 0) {
    if (max === r) {
      h = ((g - b) / delta) % 6;
    } else if (max === g) {
      h = (b - r) / delta + 2;
    } else {
      h = (r - g) / delta + 4;
    }
  }
  return { h: (h * 60 + 360) % 360, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const channel = (n: number): string => {
    const k = (n + h / 60) % 6;
    const value = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(5)}${channel(3)}${channel(1)}`;
}
