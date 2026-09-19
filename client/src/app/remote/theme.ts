export type ThemeMode = 'system' | 'light' | 'dark';

export const THEME_MODE_STORAGE_KEY = 'yfremote.themeMode';
export const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];
const DARK_THEME_COLOR = '#070b0e';
const LIGHT_THEME_COLOR = '#eef3f4';

export function parseStoredThemeMode(rawValue: string | null): ThemeMode {
  return THEME_MODES.find((mode) => mode === rawValue) ?? 'system';
}

/** Setzt den Modus am <html>-Element und die Browserleisten-Farbe. Das Inline-Skript in
 *  index.html macht dasselbe schon vor dem Start von Angular, damit beim Laden nichts aufblitzt. */
export function applyThemeMode(doc: Document, mode: ThemeMode): void {
  const root = doc.documentElement;
  if (mode === 'system') {
    delete root.dataset['mode'];
  } else {
    root.dataset['mode'] = mode;
  }

  for (const meta of Array.from(
    doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'),
  )) {
    const light =
      mode === 'light' ||
      (mode === 'system' && meta.getAttribute('media')?.includes('light') === true);
    meta.content = light ? LIGHT_THEME_COLOR : DARK_THEME_COLOR;
  }
}
