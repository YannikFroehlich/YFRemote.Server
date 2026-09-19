import { applyThemeMode, parseStoredThemeMode } from './theme';

describe('theme', () => {
  it('falls back to system for missing or unknown stored values', () => {
    expect(parseStoredThemeMode(null)).toBe('system');
    expect(parseStoredThemeMode('purple')).toBe('system');
    expect(parseStoredThemeMode('light')).toBe('light');
    expect(parseStoredThemeMode('dark')).toBe('dark');
  });

  it('sets the mode attribute and the browser bar colors', () => {
    const doc = document.implementation.createHTMLDocument();
    doc.head.innerHTML = `
      <meta name="theme-color" content="#070b0e" media="(prefers-color-scheme: dark)">
      <meta name="theme-color" content="#eef3f4" media="(prefers-color-scheme: light)">`;
    const colors = () =>
      Array.from(doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')).map(
        (meta) => meta.content,
      );

    applyThemeMode(doc, 'light');
    expect(doc.documentElement.dataset['mode']).toBe('light');
    expect(colors()).toEqual(['#eef3f4', '#eef3f4']);

    applyThemeMode(doc, 'dark');
    expect(doc.documentElement.dataset['mode']).toBe('dark');
    expect(colors()).toEqual(['#070b0e', '#070b0e']);

    applyThemeMode(doc, 'system');
    expect(doc.documentElement.dataset['mode']).toBeUndefined();
    expect(colors()).toEqual(['#070b0e', '#eef3f4']);
  });
});
