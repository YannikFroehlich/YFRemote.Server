import {
  applyTheme,
  builtInTheme,
  customThemeSnapshot,
  deriveCustomThemeProperties,
  normalizeCustomTheme,
  parseStoredCustomThemes,
  parseStoredThemeMode,
  parseStoredThemeStyle,
} from './theme';
import { sampleCustomTheme } from './theme.fixtures';

function themeDocument(): Document {
  const doc = document.implementation.createHTMLDocument();
  doc.head.innerHTML = `
    <meta name="theme-color" content="#070b0e" media="(prefers-color-scheme: dark)">
    <meta name="theme-color" content="#eef3f4" media="(prefers-color-scheme: light)">`;
  return doc;
}

function metaColors(doc: Document): string[] {
  return Array.from(doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')).map(
    (meta) => meta.content,
  );
}

describe('theme', () => {
  it('falls back to defaults for missing or unknown stored values', () => {
    expect(parseStoredThemeMode(null)).toBe('system');
    expect(parseStoredThemeMode('purple')).toBe('system');
    expect(parseStoredThemeMode('light')).toBe('light');
    expect(parseStoredThemeStyle(null)).toBe('standard');
    expect(parseStoredThemeStyle('retro')).toBe('standard');
    expect(parseStoredThemeStyle('minimal')).toBe('minimal');
    expect(parseStoredCustomThemes('not json')).toEqual([]);
    expect(parseStoredCustomThemes('{"a":1}')).toEqual([]);
  });

  it('applies built-in modes and styles as attributes and browser bar colors', () => {
    const doc = themeDocument();

    applyTheme(doc, builtInTheme('light', 'futuristic'));
    expect(doc.documentElement.dataset['mode']).toBe('light');
    expect(doc.documentElement.dataset['style']).toBe('futuristic');
    expect(metaColors(doc)).toEqual(['#eef3f4', '#eef3f4']);

    applyTheme(doc, builtInTheme('system', 'standard'));
    expect(doc.documentElement.dataset['mode']).toBeUndefined();
    expect(doc.documentElement.dataset['style']).toBeUndefined();
    expect(metaColors(doc)).toEqual(['#070b0e', '#eef3f4']);
  });

  it('applies a custom theme as inline tokens and removes them again', () => {
    const doc = themeDocument();

    applyTheme(doc, customThemeSnapshot(sampleCustomTheme()));
    const root = doc.documentElement;
    expect(root.dataset['style']).toBe('minimal');
    expect(root.dataset['mode']).toBe('dark');
    expect(root.style.getPropertyValue('--accent')).toBe('#ff0000');
    expect(root.style.getPropertyValue('--border-width')).toBe('2px');
    expect(metaColors(doc)).toEqual(['#000000', '#000000']);

    applyTheme(doc, builtInTheme('dark', 'standard'));
    expect(root.style.getPropertyValue('--accent')).toBe('');
  });

  it('derives dependent tokens from the base colors and lets advanced colors win', () => {
    const props = deriveCustomThemeProperties(
      sampleCustomTheme({ advanced: { '--success': '#00ff00', '--surface-well': '#123456' } }),
    );

    expect(props['--accent-rgb']).toBe('255, 0, 0');
    expect(props['--glow-rgb']).toBe('255, 0, 0');
    expect(props['--on-accent']).toBe('#ffffff');
    expect(props['--surface-soft']).toBe('#080808');
    expect(props['--radius-md']).toBe('8px');
    expect(props['--radius-pill']).toBe('5px');
    expect(props['--font-body']).toContain('monospace');
    expect(props['--font-display']).toContain('ui-serif');
    expect(props['--success']).toBe('#00ff00');
    expect(props['--success-rgb']).toBe('0, 255, 0');
    expect(props['--surface-well']).toBe('#123456');
  });

  it('rejects stored themes with values that could inject CSS or leave the ranges', () => {
    expect(normalizeCustomTheme(sampleCustomTheme())).toEqual(sampleCustomTheme());

    const injected = sampleCustomTheme();
    injected.values.accent = 'url(https://example.com/x.png)';
    expect(normalizeCustomTheme(injected)).toBeNull();

    const tooThick = sampleCustomTheme();
    tooThick.values.borderWidth = 50;
    expect(normalizeCustomTheme(tooThick)).toBeNull();

    expect(normalizeCustomTheme({ ...sampleCustomTheme(), name: '' })).toBeNull();
    expect(normalizeCustomTheme({ ...sampleCustomTheme(), id: 'a b"' })).toBeNull();

    const advanced = normalizeCustomTheme(
      sampleCustomTheme({
        advanced: { '--accent': '#00FF00', '--unknown': '#111111', '--text': 'red' },
      }),
    );
    expect(advanced?.advanced).toEqual({ '--accent': '#00ff00' });
  });
});
