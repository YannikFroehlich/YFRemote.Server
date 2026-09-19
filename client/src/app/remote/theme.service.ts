import { DOCUMENT } from '@angular/common';
import { computed, inject, Injectable, signal } from '@angular/core';
import { REMOTE_STORAGE } from './remote.service';
import {
  ACTIVE_CUSTOM_THEME_STORAGE_KEY,
  AppliedTheme,
  APPLIED_THEME_STORAGE_KEY,
  applyTheme,
  builtInTheme,
  CUSTOM_THEMES_STORAGE_KEY,
  CustomTheme,
  customThemeSnapshot,
  MAX_CUSTOM_THEMES,
  normalizeCustomTheme,
  parseStoredCustomThemes,
  parseStoredThemeMode,
  parseStoredThemeStyle,
  readThemeValues,
  THEME_MODE_STORAGE_KEY,
  THEME_STYLE_STORAGE_KEY,
  ThemeMode,
  ThemeStyle,
  CustomThemeValues,
} from './theme';

/** Besitzt Hell/Dunkel, den Stil und die eigenen Stile und wendet das Ergebnis am <html> an. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly storage = inject(REMOTE_STORAGE);
  private readonly document = inject(DOCUMENT);

  private readonly modeSignal = signal(
    parseStoredThemeMode(this.readStorage(THEME_MODE_STORAGE_KEY)),
  );
  private readonly styleSignal = signal(
    parseStoredThemeStyle(this.readStorage(THEME_STYLE_STORAGE_KEY)),
  );
  private readonly customThemesSignal = signal(
    parseStoredCustomThemes(this.readStorage(CUSTOM_THEMES_STORAGE_KEY)),
  );
  private readonly activeCustomIdSignal = signal(this.readStorage(ACTIVE_CUSTOM_THEME_STORAGE_KEY));

  readonly mode = this.modeSignal.asReadonly();
  readonly style = this.styleSignal.asReadonly();
  readonly customThemes = this.customThemesSignal.asReadonly();
  /** Der aktive eigene Stil; null, wenn ein eingebauter Stil gilt. */
  readonly activeCustomTheme = computed(
    () => this.customThemes().find((theme) => theme.id === this.activeCustomIdSignal()) ?? null,
  );

  constructor() {
    this.applyCurrent();
  }

  saveMode(mode: ThemeMode): void {
    this.modeSignal.set(mode);
    this.storage?.setItem(THEME_MODE_STORAGE_KEY, mode);
    this.applyCurrent();
  }

  saveStyle(style: ThemeStyle): void {
    this.styleSignal.set(style);
    this.storage?.setItem(THEME_STYLE_STORAGE_KEY, style);
    this.applyCurrent();
  }

  /** Aktiviert einen eigenen Stil oder, mit null, wieder den eingebauten. */
  activateCustomTheme(id: string | null): void {
    this.activeCustomIdSignal.set(id);
    if (id === null) {
      this.storage?.removeItem(ACTIVE_CUSTOM_THEME_STORAGE_KEY);
    } else {
      this.storage?.setItem(ACTIVE_CUSTOM_THEME_STORAGE_KEY, id);
    }
    this.applyCurrent();
  }

  /** Legt einen Stil an oder ersetzt den mit gleicher id. False, wenn das Limit erreicht ist. */
  saveCustomTheme(theme: CustomTheme): boolean {
    const themes = this.customThemes();
    const index = themes.findIndex((existing) => existing.id === theme.id);
    if (index === -1 && themes.length >= MAX_CUSTOM_THEMES) {
      return false;
    }
    this.persistCustomThemes(
      index === -1
        ? [...themes, theme]
        : themes.map((existing, i) => (i === index ? theme : existing)),
    );
    return true;
  }

  deleteCustomTheme(id: string): void {
    this.persistCustomThemes(this.customThemes().filter((theme) => theme.id !== id));
    if (this.activeCustomIdSignal() === id) {
      this.activateCustomTheme(null);
    }
  }

  /** Zeigt einen Stil sofort an, ohne ihn zu speichern; null stellt den gespeicherten her. */
  preview(theme: CustomTheme | null): void {
    applyTheme(this.document, theme === null ? this.currentTheme() : customThemeSnapshot(theme));
  }

  /** Wendet einen eingebauten Stil ohne eigene Werte an und liest dessen Grundwerte aus. */
  readBaseValues(base: ThemeStyle, mode: 'light' | 'dark'): CustomThemeValues {
    applyTheme(this.document, builtInTheme(mode, base));
    return readThemeValues(this.document);
  }

  exportCustomThemes(): string {
    return JSON.stringify(this.customThemes(), null, 2);
  }

  /** Hängt gültige Stile aus einer Exportdatei an (mit neuen ids). Liefert die Anzahl oder
   *  null, wenn die Datei kein gültiges Stil-Array enthält. */
  importCustomThemes(json: string): number | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return null;
    }
    if (!Array.isArray(parsed)) {
      return null;
    }
    const imported = parsed
      .map(normalizeCustomTheme)
      .filter((theme): theme is CustomTheme => theme !== null)
      .map((theme) => ({ ...theme, id: createThemeId() }));
    const room = MAX_CUSTOM_THEMES - this.customThemes().length;
    const added = imported.slice(0, Math.max(0, room));
    this.persistCustomThemes([...this.customThemes(), ...added]);
    return added.length;
  }

  private persistCustomThemes(themes: CustomTheme[]): void {
    this.customThemesSignal.set(themes);
    this.storage?.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(themes));
    this.applyCurrent();
  }

  private currentTheme(): AppliedTheme {
    const custom = this.activeCustomTheme();
    return custom === null ? builtInTheme(this.mode(), this.style()) : customThemeSnapshot(custom);
  }

  private applyCurrent(): void {
    const theme = this.currentTheme();
    applyTheme(this.document, theme);
    this.storage?.setItem(APPLIED_THEME_STORAGE_KEY, JSON.stringify(theme));
  }

  private readStorage(key: string): string | null {
    return this.storage?.getItem(key) ?? null;
  }
}

export function createThemeId(): string {
  return `theme-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
