import { DOCUMENT } from '@angular/common';
import { Component, effect, inject, input, OnInit, output, signal } from '@angular/core';
import {
  ADVANCED_THEME_TOKENS,
  CUSTOM_THEME_COLORS,
  CUSTOM_THEME_RANGES,
  CustomTheme,
  CustomThemeColorKey,
  CustomThemeNumberKey,
  MAX_CUSTOM_THEME_NAME_LENGTH,
  MAX_CUSTOM_THEMES,
  readAdvancedTokenColor,
  THEME_FONTS,
  ThemeFont,
  ThemeStyle,
} from './theme';
import { createThemeId, ThemeService } from './theme.service';
import { TranslationService } from './translation.service';

/** label ist ein Key ins Uebersetzungs-Dictionary (translation.ts), kein Anzeigetext. */
const SHAPE_CONTROLS: readonly { key: CustomThemeNumberKey; label: string }[] = [
  { key: 'borderWidth', label: 'themeShape.borderWidth' },
  { key: 'radius', label: 'themeShape.radius' },
  { key: 'shadow', label: 'themeShape.shadow' },
  { key: 'decor', label: 'themeShape.decor' },
  { key: 'grid', label: 'themeShape.grid' },
  { key: 'fontScale', label: 'themeShape.fontScale' },
];

@Component({
  selector: 'app-theme-editor-dialog',
  templateUrl: './theme-editor-dialog.component.html',
})
export class ThemeEditorDialogComponent implements OnInit {
  private readonly theme = inject(ThemeService);
  private readonly document = inject(DOCUMENT);
  protected readonly i18n = inject(TranslationService);

  /** id des zu bearbeitenden Stils; null legt einen neuen an. */
  readonly themeId = input<string | null>(null);
  readonly closed = output<void>();
  readonly saved = output<string>();

  protected readonly colors = CUSTOM_THEME_COLORS;
  protected readonly shapeControls = SHAPE_CONTROLS;
  protected readonly ranges = CUSTOM_THEME_RANGES;
  protected readonly advancedTokens = ADVANCED_THEME_TOKENS;
  protected readonly fonts = Object.entries(THEME_FONTS).map(([value, font]) => ({
    value: value as ThemeFont,
    label: font.label,
  }));
  protected readonly maxNameLength = MAX_CUSTOM_THEME_NAME_LENGTH;

  protected readonly draft = signal<CustomTheme | null>(null);
  protected readonly isEditing = signal(false);
  protected readonly nameError = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly deletePending = signal(false);
  /** Aktuell angezeigte Werte aller Profi-Tokens (überschrieben oder abgeleitet). */
  protected readonly advancedColors = signal<Record<string, string>>({});

  constructor() {
    // Jede Änderung sofort anzeigen; Abbrechen stellt den gespeicherten Stil wieder her.
    effect(() => {
      const draft = this.draft();
      if (draft === null) {
        return;
      }
      this.theme.preview(draft);
      this.advancedColors.set(
        Object.fromEntries(
          this.advancedTokens.map(({ token }) => [
            token,
            readAdvancedTokenColor(this.document, token),
          ]),
        ),
      );
    });
  }

  ngOnInit(): void {
    const existing = this.theme.customThemes().find((theme) => theme.id === this.themeId());
    if (existing !== undefined) {
      this.isEditing.set(true);
      this.draft.set(structuredClone(existing));
      return;
    }

    const storedMode = this.theme.mode();
    const prefersLight =
      this.document.defaultView?.matchMedia?.('(prefers-color-scheme: light)').matches === true;
    const mode =
      storedMode === 'light' || (storedMode === 'system' && prefersLight) ? 'light' : 'dark';
    const base = this.theme.style();
    this.draft.set({
      id: createThemeId(),
      name: this.i18n.t('themeEditor.defaultName', { n: this.theme.customThemes().length + 1 }),
      base,
      mode,
      values: this.theme.readBaseValues(base, mode),
      advanced: {},
    });
  }

  protected setName(event: Event): void {
    const name = (event.target as HTMLInputElement).value;
    this.nameError.set(false);
    this.update((draft) => ({ ...draft, name }));
  }

  /** Neuer Grundstil oder Hell/Dunkel: Grundwerte davon übernehmen, Profi-Werte verwerfen. */
  protected setBase(base: ThemeStyle, mode: 'light' | 'dark'): void {
    this.update((draft) => ({
      ...draft,
      base,
      mode,
      values: this.theme.readBaseValues(base, mode),
      advanced: {},
    }));
  }

  protected selectBase(event: Event): void {
    const draft = this.draft();
    if (draft !== null) {
      this.setBase((event.target as HTMLSelectElement).value as ThemeStyle, draft.mode);
    }
  }

  protected selectMode(event: Event): void {
    const draft = this.draft();
    const mode = (event.target as HTMLSelectElement).value === 'light' ? 'light' : 'dark';
    if (draft !== null) {
      this.setBase(draft.base, mode);
    }
  }

  protected setColor(key: CustomThemeColorKey, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.update((draft) => ({ ...draft, values: { ...draft.values, [key]: value } }));
  }

  protected setNumber(key: CustomThemeNumberKey, event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.update((draft) => ({ ...draft, values: { ...draft.values, [key]: value } }));
  }

  protected setFont(key: 'font' | 'displayFont', event: Event): void {
    const value = (event.target as HTMLSelectElement).value as ThemeFont;
    this.update((draft) => ({ ...draft, values: { ...draft.values, [key]: value } }));
  }

  protected togglePillCorners(): void {
    this.update((draft) => ({
      ...draft,
      values: { ...draft.values, pillCorners: !draft.values.pillCorners },
    }));
  }

  protected setAdvanced(token: string, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.update((draft) => ({ ...draft, advanced: { ...draft.advanced, [token]: value } }));
  }

  protected resetAdvanced(): void {
    this.update((draft) => ({ ...draft, advanced: {} }));
  }

  protected isAdvancedOverridden(token: string): boolean {
    return this.draft()?.advanced[token] !== undefined;
  }

  protected advancedCount(): number {
    return Object.keys(this.draft()?.advanced ?? {}).length;
  }

  protected rangeLabel(key: CustomThemeNumberKey): string {
    const value = this.draft()?.values[key] ?? 0;
    return key === 'borderWidth' ? `${value} px` : `${Math.round(value * 100)} %`;
  }

  protected save(event: Event): void {
    event.preventDefault();
    const draft = this.draft();
    if (draft === null) {
      return;
    }
    const name = draft.name.trim();
    if (!name || name.length > MAX_CUSTOM_THEME_NAME_LENGTH) {
      this.nameError.set(true);
      return;
    }
    if (!this.theme.saveCustomTheme({ ...draft, name })) {
      this.saveError.set(this.i18n.t('themeEditor.saveError', { max: MAX_CUSTOM_THEMES }));
      return;
    }
    this.theme.preview(null);
    this.saved.emit(draft.id);
    this.closed.emit();
  }

  protected close(): void {
    this.theme.preview(null);
    this.closed.emit();
  }

  protected confirmDelete(): void {
    const draft = this.draft();
    if (draft !== null) {
      this.theme.deleteCustomTheme(draft.id);
    }
    this.theme.preview(null);
    this.closed.emit();
  }

  private update(change: (draft: CustomTheme) => CustomTheme): void {
    const draft = this.draft();
    if (draft !== null) {
      this.draft.set(change(draft));
    }
  }
}
