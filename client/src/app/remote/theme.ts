export type ThemeMode = 'system' | 'light' | 'dark';
export type ThemeStyle = 'standard' | 'futuristic' | 'minimal';
export type ThemeFont = 'system' | 'rounded' | 'serif' | 'mono';

export const THEME_MODE_STORAGE_KEY = 'yfremote.themeMode';
export const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];
export const THEME_STYLE_STORAGE_KEY = 'yfremote.themeStyle';
export const THEME_STYLES: readonly ThemeStyle[] = ['standard', 'futuristic', 'minimal'];
export const CUSTOM_THEMES_STORAGE_KEY = 'yfremote.customThemes';
export const ACTIVE_CUSTOM_THEME_STORAGE_KEY = 'yfremote.activeCustomTheme';
/** Fertig berechnetes Theme für das Inline-Skript in index.html (siehe AppliedTheme). */
export const APPLIED_THEME_STORAGE_KEY = 'yfremote.appliedTheme';
export const MAX_CUSTOM_THEMES = 20;
export const MAX_CUSTOM_THEME_NAME_LENGTH = 30;

const DARK_THEME_COLOR = '#070b0e';
const LIGHT_THEME_COLOR = '#eef3f4';
const HEX_COLOR = /^#[0-9a-f]{6}$/;

// label ist ein Key ins Uebersetzungs-Dictionary (translation.ts); System/Serif/Monospace sind
// in beiden Sprachen gleich und bleiben daher als Literal (translate() faellt darauf zurueck).
export const THEME_FONTS: Readonly<Record<ThemeFont, { label: string; stack: string }>> = {
  system: {
    label: 'System',
    stack:
      "Inter, 'Segoe UI Variable', 'Segoe UI', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  },
  rounded: {
    label: 'themeFont.rounded',
    stack: "ui-rounded, 'SF Pro Rounded', 'Nunito', 'Varela Round', system-ui, sans-serif",
  },
  serif: { label: 'Serif', stack: "ui-serif, Georgia, 'Times New Roman', serif" },
  mono: {
    label: 'Monospace',
    stack: "ui-monospace, 'Cascadia Mono', 'Consolas', 'Roboto Mono', monospace",
  },
};

export interface ThemeRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

export const CUSTOM_THEME_RANGES = {
  borderWidth: { min: 0, max: 3, step: 0.5 },
  radius: { min: 0, max: 2, step: 0.1 },
  shadow: { min: 0, max: 2, step: 0.1 },
  decor: { min: 0, max: 2, step: 0.1 },
  grid: { min: 0, max: 4, step: 0.5 },
  fontScale: { min: 0.85, max: 1.25, step: 0.05 },
} as const satisfies Record<string, ThemeRange>;

export type CustomThemeColorKey =
  'accent' | 'background' | 'surface' | 'raised' | 'text' | 'muted' | 'line' | 'danger';
export type CustomThemeNumberKey = keyof typeof CUSTOM_THEME_RANGES;

// label ist ein Key ins Uebersetzungs-Dictionary (translation.ts), kein Anzeigetext.
export const CUSTOM_THEME_COLORS: readonly { key: CustomThemeColorKey; label: string }[] = [
  { key: 'accent', label: 'themeColor.accent' },
  { key: 'background', label: 'themeColor.background' },
  { key: 'surface', label: 'themeColor.surface' },
  { key: 'raised', label: 'themeColor.raised' },
  { key: 'text', label: 'Text' },
  { key: 'muted', label: 'themeColor.muted' },
  { key: 'line', label: 'themeColor.line' },
  { key: 'danger', label: 'themeColor.danger' },
];

/** Alle Farb-Tokens aus styles.scss, die der Profi-Bereich einzeln überschreiben darf. label
 *  ist ein Key ins Uebersetzungs-Dictionary (translation.ts), kein Anzeigetext. */
export const ADVANCED_THEME_TOKENS: readonly { token: string; label: string }[] = [
  { token: '--app-bg', label: 'themeToken.appBg' },
  { token: '--app-bg-start', label: 'themeToken.appBgStart' },
  { token: '--app-bg-end', label: 'themeToken.appBgEnd' },
  { token: '--panel-bg-mobile', label: 'themeToken.panelBgMobile' },
  { token: '--surface-solid', label: 'themeToken.surfaceSolid' },
  { token: '--surface-raised', label: 'themeToken.surfaceRaised' },
  { token: '--surface-hover', label: 'themeToken.surfaceHover' },
  { token: '--surface-soft', label: 'themeToken.surfaceSoft' },
  { token: '--surface-sunken', label: 'themeToken.surfaceSunken' },
  { token: '--surface-dialog', label: 'Dialog' },
  { token: '--surface-focus', label: 'themeToken.surfaceFocus' },
  { token: '--surface-well', label: 'themeToken.surfaceWell' },
  { token: '--surface-bar', label: 'themeToken.surfaceBar' },
  { token: '--text', label: 'Text' },
  { token: '--text-soft', label: 'themeToken.textSoft' },
  { token: '--muted', label: 'themeToken.muted' },
  { token: '--muted-strong', label: 'themeToken.mutedStrong' },
  { token: '--text-faint', label: 'themeToken.textFaint' },
  { token: '--text-disabled', label: 'themeToken.textDisabled' },
  { token: '--accent', label: 'themeToken.accent' },
  { token: '--accent-strong', label: 'themeToken.accentStrong' },
  { token: '--accent-text', label: 'themeToken.accentText' },
  { token: '--accent-gradient-start', label: 'themeToken.accentGradientStart' },
  { token: '--accent-gradient-end', label: 'themeToken.accentGradientEnd' },
  { token: '--on-accent', label: 'themeToken.onAccent' },
  { token: '--button-disabled-bg', label: 'themeToken.buttonDisabledBg' },
  { token: '--button-disabled-text', label: 'themeToken.buttonDisabledText' },
  { token: '--switch-track', label: 'themeToken.switchTrack' },
  { token: '--switch-knob', label: 'themeToken.switchKnob' },
  { token: '--danger', label: 'themeToken.danger' },
  { token: '--danger-text', label: 'themeToken.dangerText' },
  { token: '--danger-text-hover', label: 'themeToken.dangerTextHover' },
  { token: '--danger-surface', label: 'themeToken.dangerSurface' },
  { token: '--danger-surface-hover', label: 'themeToken.dangerSurfaceHover' },
  { token: '--warning', label: 'themeToken.warning' },
  { token: '--success', label: 'themeToken.success' },
];
const ADVANCED_TOKEN_NAMES = new Set(ADVANCED_THEME_TOKENS.map((entry) => entry.token));
/** Tokens, zu denen ein *-rgb-Kanal-Token gehört, der mitziehen muss. */
const RGB_PAIRED_TOKENS = new Set(['--accent', '--danger', '--warning', '--success']);

export interface CustomThemeValues {
  accent: string;
  background: string;
  surface: string;
  raised: string;
  text: string;
  muted: string;
  line: string;
  danger: string;
  borderWidth: number;
  radius: number;
  pillCorners: boolean;
  shadow: number;
  decor: number;
  grid: number;
  font: ThemeFont;
  displayFont: ThemeFont;
  fontScale: number;
}

export interface CustomTheme {
  id: string;
  name: string;
  base: ThemeStyle;
  mode: 'light' | 'dark';
  values: CustomThemeValues;
  /** Einzeln überschriebene Farb-Tokens aus ADVANCED_THEME_TOKENS. */
  advanced: Record<string, string>;
}

/** Alles, was am <html>-Element gesetzt wird. Wird zusätzlich gespeichert, damit das
 *  Inline-Skript in index.html es vor dem Start von Angular ohne eigene Logik anwenden kann. */
export interface AppliedTheme {
  mode: 'light' | 'dark' | null;
  style: 'futuristic' | 'minimal' | null;
  props: Record<string, string>;
  themeColor: string | null;
}

export function parseStoredThemeMode(rawValue: string | null): ThemeMode {
  return THEME_MODES.find((mode) => mode === rawValue) ?? 'system';
}

export function parseStoredThemeStyle(rawValue: string | null): ThemeStyle {
  return THEME_STYLES.find((style) => style === rawValue) ?? 'standard';
}

export function builtInTheme(mode: ThemeMode, style: ThemeStyle): AppliedTheme {
  return {
    mode: mode === 'system' ? null : mode,
    style: style === 'standard' ? null : style,
    props: {},
    themeColor: null,
  };
}

export function customThemeSnapshot(theme: CustomTheme): AppliedTheme {
  return {
    mode: theme.mode,
    style: theme.base === 'standard' ? null : theme.base,
    props: deriveCustomThemeProperties(theme),
    themeColor: theme.values.background,
  };
}

export function applyTheme(doc: Document, theme: AppliedTheme): void {
  const root = doc.documentElement;
  setDataAttribute(root, 'mode', theme.mode);
  setDataAttribute(root, 'style', theme.style);
  // Inline-Styles am <html> gehören allein dem eigenen Stil, daher komplett ersetzen.
  root.removeAttribute('style');
  for (const [name, value] of Object.entries(theme.props)) {
    root.style.setProperty(name, value);
  }

  for (const meta of Array.from(
    doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'),
  )) {
    const light =
      theme.mode === 'light' ||
      (theme.mode === null && meta.getAttribute('media')?.includes('light') === true);
    meta.content = theme.themeColor ?? (light ? LIGHT_THEME_COLOR : DARK_THEME_COLOR);
  }
}

/** Leitet aus den wenigen Grundwerten alle Tokens ab, damit eine einzige Akzentfarbe auch
 *  Leuchten, Verläufe und Hover-Zustände passend mitfärbt. Profi-Werte gewinnen zuletzt. */
export function deriveCustomThemeProperties(theme: CustomTheme): Record<string, string> {
  const v = theme.values;
  const surfaceDim = mix(v.surface, v.background, 0.5);
  const accentStrong = mix(v.accent, v.background, 0.2);
  const props: Record<string, string> = {
    '--accent': v.accent,
    '--accent-strong': accentStrong,
    '--accent-rgb': channels(v.accent),
    '--accent-border-rgb': channels(v.accent),
    '--accent-text': mix(v.accent, v.text, 0.5),
    '--accent-gradient-start': v.accent,
    '--accent-gradient-end': accentStrong,
    '--on-accent': luminance(v.accent) > 0.45 ? '#0b0b0c' : '#ffffff',
    '--line-strong': `rgba(${channels(v.accent)}, 0.35)`,
    '--glow-rgb': channels(v.accent),
    '--glow-deep-rgb': channels(accentStrong),
    '--brand-glow-rgb': channels(v.accent),
    '--backdrop-glow-1-rgb': channels(v.accent),
    '--app-bg': v.background,
    '--app-bg-start': v.background,
    '--app-bg-end': v.background,
    '--panel-bg-mobile': v.background,
    '--overlay-rgb': channels(v.background),
    '--surface': `rgba(${channels(v.surface)}, 0.94)`,
    '--surface-solid': v.surface,
    '--surface-dialog': v.surface,
    '--surface-focus': v.surface,
    '--surface-soft': surfaceDim,
    '--surface-sunken': surfaceDim,
    '--surface-well': surfaceDim,
    '--surface-bar': surfaceDim,
    '--surface-inset-rgb': channels(surfaceDim),
    '--surface-disabled-rgb': channels(surfaceDim),
    '--surface-raised': v.raised,
    '--surface-hover': mix(v.raised, v.text, 0.06),
    '--button-disabled-bg': mix(v.raised, v.background, 0.4),
    '--switch-track': mix(v.raised, v.text, 0.18),
    '--switch-knob': mix(v.text, v.background, 0.3),
    '--text': v.text,
    '--text-soft': mix(v.text, v.background, 0.18),
    '--well-dot-rgb': channels(v.text),
    '--muted': v.muted,
    '--muted-strong': mix(v.muted, v.text, 0.25),
    '--text-disabled': mix(v.muted, v.background, 0.3),
    '--button-disabled-text': mix(v.muted, v.background, 0.3),
    '--text-faint': mix(v.muted, v.background, 0.45),
    '--line-rgb': channels(v.line),
    '--danger': v.danger,
    '--danger-rgb': channels(v.danger),
    '--danger-strong-rgb': channels(v.danger),
    '--danger-text': mix(v.danger, v.text, 0.5),
    '--danger-text-hover': mix(v.danger, v.text, 0.7),
    '--danger-surface': mix(v.surface, v.danger, 0.15),
    '--danger-surface-hover': mix(v.surface, v.danger, 0.25),
    '--border-width': `${v.borderWidth}px`,
    '--radius-scale': String(v.radius),
    '--radius-md': `${16 * v.radius}px`,
    '--radius-lg': `${24 * v.radius}px`,
    '--radius-pill': v.pillCorners ? '999px' : `${10 * v.radius}px`,
    '--shadow-strength': String(v.shadow),
    '--decor-strength': String(v.decor),
    '--grid-strength': String(v.grid),
    '--font-body': THEME_FONTS[v.font].stack,
    '--font-display': THEME_FONTS[v.displayFont].stack,
    '--font-scale': String(v.fontScale),
  };

  for (const [token, color] of Object.entries(theme.advanced)) {
    props[token] = color;
    if (RGB_PAIRED_TOKENS.has(token)) {
      props[`${token}-rgb`] = channels(color);
    }
  }
  return props;
}

/** Liest die Grundwerte des gerade angewendeten Stils aus den berechneten Tokens. */
export function readThemeValues(doc: Document): CustomThemeValues {
  const style = doc.defaultView?.getComputedStyle(doc.documentElement);
  const token = (name: string) => style?.getPropertyValue(name).trim() ?? '';
  const color = (name: string, fallback: string) => toHex(token(name)) ?? fallback;
  const number = (name: string, fallback: number) => {
    const parsed = parseFloat(token(name));
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const font = (name: string): ThemeFont =>
    token(name).includes('monospace')
      ? 'mono'
      : token(name).includes('ui-rounded')
        ? 'rounded'
        : token(name).includes('ui-serif')
          ? 'serif'
          : 'system';

  return {
    accent: color('--accent', '#62e3c4'),
    background: color('--app-bg', '#070b0e'),
    surface: color('--surface-solid', '#11191e'),
    raised: color('--surface-raised', '#172127'),
    text: color('--text', '#f2f7f8'),
    muted: color('--muted', '#8c9da5'),
    line: color('--line-rgb', '#e0f2f5'),
    danger: color('--danger', '#ff9b87'),
    borderWidth: number('--border-width', 1),
    radius: number('--radius-scale', 1),
    pillCorners: token('--radius-pill') === '' || token('--radius-pill') === '999px',
    shadow: number('--shadow-strength', 1),
    decor: number('--decor-strength', 1),
    grid: number('--grid-strength', 1),
    font: font('--font-body'),
    displayFont: font('--font-display'),
    fontScale: number('--font-scale', 1),
  };
}

export function readAdvancedTokenColor(doc: Document, token: string): string {
  const value = doc.defaultView?.getComputedStyle(doc.documentElement).getPropertyValue(token);
  return toHex(value?.trim() ?? '') ?? '#000000';
}

/** Prüft einen gespeicherten oder importierten Stil. Nur Hex-Farben und Zahlen im erlaubten
 *  Bereich kommen durch, damit kein fremdes CSS (etwa url(...)) in die Tokens gelangt. */
export function normalizeCustomTheme(raw: unknown): CustomTheme | null {
  if (!isRecord(raw) || !isRecord(raw['values'])) {
    return null;
  }
  const values = raw['values'];
  const name = typeof raw['name'] === 'string' ? raw['name'].trim() : '';
  const base = THEME_STYLES.find((style) => style === raw['base']);
  const mode = raw['mode'] === 'light' || raw['mode'] === 'dark' ? raw['mode'] : null;
  const id = typeof raw['id'] === 'string' && /^[\w-]{1,64}$/.test(raw['id']) ? raw['id'] : null;
  if (!name || name.length > MAX_CUSTOM_THEME_NAME_LENGTH || !base || !mode || !id) {
    return null;
  }

  const normalized: Partial<CustomThemeValues> = {};
  for (const { key } of CUSTOM_THEME_COLORS) {
    const color = normalizeHex(values[key]);
    if (color === null) {
      return null;
    }
    normalized[key] = color;
  }
  for (const key of Object.keys(CUSTOM_THEME_RANGES) as CustomThemeNumberKey[]) {
    const value = values[key];
    const range = CUSTOM_THEME_RANGES[key];
    if (typeof value !== 'number' || !(value >= range.min && value <= range.max)) {
      return null;
    }
    normalized[key] = value;
  }
  const font = parseFont(values['font']);
  const displayFont = parseFont(values['displayFont']);
  if (typeof values['pillCorners'] !== 'boolean' || font === null || displayFont === null) {
    return null;
  }

  const advanced: Record<string, string> = {};
  if (isRecord(raw['advanced'])) {
    for (const [token, value] of Object.entries(raw['advanced'])) {
      const color = normalizeHex(value);
      if (ADVANCED_TOKEN_NAMES.has(token) && color !== null) {
        advanced[token] = color;
      }
    }
  }

  return {
    id,
    name,
    base,
    mode,
    values: {
      ...(normalized as CustomThemeValues),
      pillCorners: values['pillCorners'],
      font,
      displayFont,
    },
    advanced,
  };
}

export function parseStoredCustomThemes(rawValue: string | null): CustomTheme[] {
  if (rawValue === null) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(rawValue);
    return Array.isArray(parsed)
      ? parsed
          .map(normalizeCustomTheme)
          .filter((theme): theme is CustomTheme => theme !== null)
          .slice(0, MAX_CUSTOM_THEMES)
      : [];
  } catch {
    return [];
  }
}

function setDataAttribute(element: HTMLElement, name: string, value: string | null): void {
  if (value === null) {
    delete element.dataset[name];
  } else {
    element.dataset[name] = value;
  }
}

function parseFont(value: unknown): ThemeFont | null {
  return typeof value === 'string' && value in THEME_FONTS ? (value as ThemeFont) : null;
}

function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const lower = value.trim().toLowerCase();
  return HEX_COLOR.test(lower) ? lower : null;
}

/** Akzeptiert #rgb, #rrggbb und Kanal-Tripel "r, g, b" (Format der *-rgb-Tokens). */
function toHex(value: string): string | null {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  if (short) {
    return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  }
  if (/^#[0-9a-f]{6}$/i.test(value)) {
    return value.toLowerCase();
  }
  const triple = /^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/.exec(value);
  if (triple) {
    return rgbToHex(triple.slice(1, 4).map(Number) as [number, number, number]);
  }
  return null;
}

function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)) as [
    number,
    number,
    number,
  ];
}

function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb
    .map((channel) =>
      Math.round(Math.min(255, Math.max(0, channel)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

function channels(hex: string): string {
  return hexToRgb(hex).join(', ');
}

/** Mischt `weight` Anteile von `other` in `base`. */
function mix(base: string, other: string, weight: number): string {
  const a = hexToRgb(base);
  const b = hexToRgb(other);
  return rgbToHex([0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * weight) as [number, number, number]);
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
