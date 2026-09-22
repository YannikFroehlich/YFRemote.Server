import { Component, inject, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonLayoutService } from './button-layout.service';
import { REMOTE_ICON_PATHS } from './remote-icons';
import { ServerConfig } from './remote.models';
import { RemoteService } from './remote.service';
import {
  hostValidator,
  isValidHost,
  MOUSE_SENSITIVITY_MAX,
  MOUSE_SENSITIVITY_MIN,
  MOUSE_SENSITIVITY_STEP,
  mouseSensitivityValidator,
  normalizeHost,
  normalizeMouseSensitivity,
  normalizeScrollSpeed,
  parsePortValue,
  portValidator,
  SCROLL_SPEED_MAX,
  SCROLL_SPEED_MIN,
  SCROLL_SPEED_STEP,
  scrollSpeedValidator,
} from './server-config';
import { CustomTheme, ThemeMode, ThemeStyle } from './theme';
import { ThemeEditorDialogComponent } from './theme-editor-dialog.component';
import { ThemeService } from './theme.service';
import { Lang } from './translation';
import { TranslationService } from './translation.service';

const CUSTOM_STYLE_PREFIX = 'custom:';

@Component({
  selector: 'app-settings-dialog',
  imports: [ReactiveFormsModule, ThemeEditorDialogComponent],
  templateUrl: './settings-dialog.component.html',
})
export class SettingsDialogComponent {
  private readonly remote = inject(RemoteService);
  protected readonly layout = inject(ButtonLayoutService);
  protected readonly theme = inject(ThemeService);
  protected readonly i18n = inject(TranslationService);
  protected readonly iconPaths = REMOTE_ICON_PATHS;

  readonly closed = output<void>();

  protected readonly status = this.remote.status;
  protected readonly lastError = this.remote.lastError;
  protected readonly serverProfiles = this.remote.serverProfiles;
  protected readonly mouseSensitivityMin = MOUSE_SENSITIVITY_MIN;
  protected readonly mouseSensitivityMax = MOUSE_SENSITIVITY_MAX;
  protected readonly mouseSensitivityStep = MOUSE_SENSITIVITY_STEP;
  protected readonly scrollSpeedMin = SCROLL_SPEED_MIN;
  protected readonly scrollSpeedMax = SCROLL_SPEED_MAX;
  protected readonly scrollSpeedStep = SCROLL_SPEED_STEP;
  protected readonly profileName = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(40)],
  });
  protected readonly profileDeletePending = signal(false);
  protected readonly unpairPending = signal(false);
  protected readonly unpairing = signal(false);
  protected readonly operationMessage = signal<string | null>(null);
  protected readonly operationSucceeded = signal(false);
  protected readonly form = new FormGroup({
    host: new FormControl(this.remote.config().host, {
      nonNullable: true,
      validators: [Validators.required, hostValidator],
    }),
    port: new FormControl(this.remote.config().port, {
      nonNullable: true,
      validators: [Validators.required, portValidator],
    }),
    mouseSensitivity: new FormControl(this.remote.mouseSensitivity(), {
      nonNullable: true,
      validators: [Validators.required, mouseSensitivityValidator],
    }),
    scrollSpeed: new FormControl(this.remote.scrollSpeed(), {
      nonNullable: true,
      validators: [Validators.required, scrollSpeedValidator],
    }),
    invertScroll: new FormControl(this.remote.invertScroll(), { nonNullable: true }),
    pointerAcceleration: new FormControl(this.remote.pointerAcceleration(), { nonNullable: true }),
    haptics: new FormControl(this.remote.haptics(), { nonNullable: true }),
    language: new FormControl<Lang>(this.i18n.language(), { nonNullable: true }),
    themeMode: new FormControl<ThemeMode>(this.theme.mode(), { nonNullable: true }),
    /** Eingebauter Stil oder `custom:<id>` für einen eigenen. */
    themeStyle: new FormControl<string>(this.initialStyleSelection(), { nonNullable: true }),
  });
  private readonly selectedStyle = toSignal(this.form.controls.themeStyle.valueChanges, {
    initialValue: this.form.controls.themeStyle.value,
  });
  /** undefined: Editor zu; null: neuer Stil; sonst id des bearbeiteten Stils. */
  protected readonly editingThemeId = signal<string | null | undefined>(undefined);
  protected readonly customStylePrefix = CUSTOM_STYLE_PREFIX;

  protected close(): void {
    this.closed.emit();
  }

  protected save(): void {
    this.form.markAllAsTouched();

    const host = normalizeHost(this.form.controls.host.value);
    const port = parsePortValue(this.form.controls.port.value);
    const mouseSensitivity = normalizeMouseSensitivity(
      Number(this.form.controls.mouseSensitivity.value),
    );
    const scrollSpeed = normalizeScrollSpeed(Number(this.form.controls.scrollSpeed.value));

    if (
      this.form.invalid ||
      !isValidHost(host) ||
      port === null ||
      mouseSensitivity === null ||
      scrollSpeed === null
    ) {
      return;
    }

    this.remote.savePointerAcceleration(this.form.controls.pointerAcceleration.value);
    this.remote.saveHaptics(this.form.controls.haptics.value);
    this.i18n.setLanguage(this.form.controls.language.value);
    this.saveTheme();

    // saveConfig zuletzt: bei geändertem Host/Port navigiert es die Seite weg.
    const configSaved =
      this.remote.saveMouseSensitivity(mouseSensitivity) &&
      this.remote.saveScrollSettings(scrollSpeed, this.form.controls.invertScroll.value) &&
      this.remote.saveConfig({ host, port });

    if (configSaved) {
      this.closed.emit();
    }
  }

  /** name/hint sind Keys ins Uebersetzungs-Dictionary, keine Anzeigetexte. */
  protected readonly themeStyles: readonly { value: ThemeStyle; name: string; hint: string }[] = [
    { value: 'standard', name: 'Standard', hint: 'settings.style.standard.hint' },
    {
      value: 'futuristic',
      name: 'settings.style.futuristic.name',
      hint: 'settings.style.futuristic.hint',
    },
    {
      value: 'minimal',
      name: 'settings.style.minimal.name',
      hint: 'settings.style.minimal.hint',
    },
  ];

  protected customStyleSelected(): boolean {
    return this.selectedStyle().startsWith(CUSTOM_STYLE_PREFIX);
  }

  protected openThemeEditor(id: string | null): void {
    this.editingThemeId.set(id);
  }

  protected onThemeSaved(id: string): void {
    this.form.controls.themeStyle.setValue(CUSTOM_STYLE_PREFIX + id);
  }

  protected onThemeEditorClosed(): void {
    this.editingThemeId.set(undefined);
    // Ein gelöschter Stil darf nicht ausgewählt bleiben.
    const selected = this.form.controls.themeStyle.value;
    const exists = this.theme
      .customThemes()
      .some((theme) => CUSTOM_STYLE_PREFIX + theme.id === selected);
    if (selected.startsWith(CUSTOM_STYLE_PREFIX) && !exists) {
      this.form.controls.themeStyle.setValue(this.theme.style());
    }
  }

  protected customThemePreview(theme: CustomTheme): string {
    const v = theme.values;
    return `linear-gradient(135deg, ${v.accent} 0 30%, ${v.raised} 30% 65%, ${v.background} 65%)`;
  }

  protected exportCustomThemes(): void {
    this.download(this.theme.exportCustomThemes(), 'yfremote-stile.json');
    this.showOperationMessage(this.i18n.t('settings.msg.stylesExported'), true);
  }

  protected async importCustomThemes(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file === undefined) {
      return;
    }
    if (file.size > 1_000_000) {
      this.showOperationMessage(this.i18n.t('settings.msg.importTooLarge'));
      return;
    }
    try {
      const added = this.theme.importCustomThemes(await file.text());
      if (added === null) {
        this.showOperationMessage(this.i18n.t('settings.msg.noValidStyles'));
      } else {
        this.showOperationMessage(
          this.i18n.t('settings.msg.stylesImported', { count: added }),
          added > 0,
        );
      }
    } catch {
      this.showOperationMessage(this.i18n.t('settings.msg.importUnreadable'));
    }
  }

  private initialStyleSelection(): string {
    const custom = this.theme.activeCustomTheme();
    return custom === null ? this.theme.style() : CUSTOM_STYLE_PREFIX + custom.id;
  }

  private saveTheme(): void {
    const selected = this.form.controls.themeStyle.value;
    this.theme.saveMode(this.form.controls.themeMode.value);
    if (selected.startsWith(CUSTOM_STYLE_PREFIX)) {
      this.theme.activateCustomTheme(selected.slice(CUSTOM_STYLE_PREFIX.length));
    } else {
      this.theme.saveStyle(selected as ThemeStyle);
      this.theme.activateCustomTheme(null);
    }
  }

  private download(content: string, fileName: string): void {
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    try {
      anchor.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  protected toggleSetting(name: 'pointerAcceleration' | 'invertScroll' | 'haptics'): void {
    const control = this.form.controls[name];
    control.setValue(!control.value);
    control.markAsDirty();
  }

  protected sensitivityLabel(): string {
    return Number(this.form.controls.mouseSensitivity.value).toFixed(2);
  }

  protected scrollSpeedLabel(): string {
    return Number(this.form.controls.scrollSpeed.value).toFixed(2);
  }

  protected hasFieldError(
    fieldName: 'host' | 'port' | 'mouseSensitivity' | 'scrollSpeed',
  ): boolean {
    const control = this.form.controls[fieldName];
    return control.invalid && (control.dirty || control.touched);
  }

  protected selectServerProfile(profile: ServerConfig): void {
    this.form.controls.host.setValue(profile.host);
    this.form.controls.port.setValue(profile.port);
    this.form.controls.host.markAsDirty();
    this.form.controls.port.markAsDirty();
  }

  protected removeServerProfile(profile: ServerConfig): void {
    this.remote.removeServerProfile(profile);
  }

  protected selectProfile(event: Event): void {
    const id = (event.target as HTMLSelectElement).value;
    this.profileDeletePending.set(false);

    if (this.layout.switchProfile(id)) {
      this.showOperationMessage(this.i18n.t('settings.msg.profileLoaded'), true);
    } else {
      this.showOperationMessage(
        this.layout.profileError() ?? this.i18n.t('settings.msg.profileLoadFailed'),
      );
    }
  }

  protected createProfile(): void {
    this.profileName.markAsTouched();
    if (this.profileName.invalid) {
      return;
    }

    if (this.layout.createProfile(this.profileName.value)) {
      this.profileName.setValue('');
      this.profileName.markAsUntouched();
      this.showOperationMessage(this.i18n.t('settings.msg.profileCreated'), true);
    } else {
      this.showOperationMessage(
        this.layout.profileError() ?? this.i18n.t('settings.msg.profileCreateFailed'),
      );
    }
  }

  protected requestProfileDeletion(): void {
    this.profileDeletePending.set(true);
  }

  protected cancelProfileDeletion(): void {
    this.profileDeletePending.set(false);
  }

  protected confirmProfileDeletion(): void {
    const deleted = this.layout.deleteProfile(this.layout.activeProfileId());
    this.profileDeletePending.set(false);
    this.showOperationMessage(
      deleted
        ? this.i18n.t('settings.msg.profileDeleted')
        : (this.layout.profileError() ?? this.i18n.t('settings.msg.profileDeleteFailed')),
      deleted,
    );
  }

  protected exportProfiles(): void {
    const blob = new Blob([this.layout.exportProfiles()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'yfremote-layout-profile.json';

    try {
      anchor.click();
      this.showOperationMessage(this.i18n.t('settings.msg.profilesExported'), true);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  protected async importProfiles(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';

    if (file === undefined) {
      return;
    }
    if (file.size > 1_000_000) {
      this.showOperationMessage(this.i18n.t('settings.msg.importTooLarge'));
      return;
    }

    try {
      const imported = this.layout.importProfiles(await file.text());
      this.profileDeletePending.set(false);
      this.showOperationMessage(
        imported
          ? this.i18n.t('settings.msg.profilesImported')
          : (this.layout.profileError() ?? this.i18n.t('settings.msg.importFailed')),
        imported,
      );
    } catch {
      this.showOperationMessage(this.i18n.t('settings.msg.importUnreadable'));
    }
  }

  protected requestUnpair(): void {
    this.unpairPending.set(true);
  }

  protected cancelUnpair(): void {
    this.unpairPending.set(false);
  }

  protected async confirmUnpair(): Promise<void> {
    this.unpairing.set(true);
    const unpaired = await this.remote.unpair();
    this.unpairing.set(false);

    if (!unpaired) {
      this.unpairPending.set(false);
      this.showOperationMessage(
        this.lastError() ?? this.i18n.t('settings.msg.unpairFailed'),
      );
    }
  }

  private showOperationMessage(message: string, succeeded = false): void {
    this.operationSucceeded.set(succeeded);
    this.operationMessage.set(message);
  }
}
