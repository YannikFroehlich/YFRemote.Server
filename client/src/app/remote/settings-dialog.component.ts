import { Component, inject, output, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonLayoutService } from './button-layout.service';
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

@Component({
  selector: 'app-settings-dialog',
  imports: [ReactiveFormsModule],
  templateUrl: './settings-dialog.component.html',
})
export class SettingsDialogComponent {
  private readonly remote = inject(RemoteService);
  protected readonly layout = inject(ButtonLayoutService);

  readonly closed = output<void>();

  protected readonly status = this.remote.status;
  protected readonly lastError = this.remote.lastError;
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
  });

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

    // saveConfig zuletzt: bei geändertem Host/Port navigiert es die Seite weg.
    const configSaved =
      this.remote.saveMouseSensitivity(mouseSensitivity) &&
      this.remote.saveScrollSettings(scrollSpeed, this.form.controls.invertScroll.value) &&
      this.remote.saveConfig({ host, port });

    if (configSaved) {
      this.closed.emit();
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

  protected selectProfile(event: Event): void {
    const id = (event.target as HTMLSelectElement).value;
    this.profileDeletePending.set(false);

    if (this.layout.switchProfile(id)) {
      this.showOperationMessage('Profil geladen.', true);
    } else {
      this.showOperationMessage(
        this.layout.profileError() ?? 'Profil konnte nicht geladen werden.',
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
      this.showOperationMessage('Profil aus dem aktuellen Layout erstellt.', true);
    } else {
      this.showOperationMessage(
        this.layout.profileError() ?? 'Profil konnte nicht erstellt werden.',
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
        ? 'Profil gelöscht.'
        : (this.layout.profileError() ?? 'Profil konnte nicht gelöscht werden.'),
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
      this.showOperationMessage('Layoutprofile wurden exportiert.', true);
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
      this.showOperationMessage('Die Importdatei darf höchstens 1 MB groß sein.');
      return;
    }

    try {
      const imported = this.layout.importProfiles(await file.text());
      this.profileDeletePending.set(false);
      this.showOperationMessage(
        imported
          ? 'Layoutprofile wurden importiert.'
          : (this.layout.profileError() ?? 'Import fehlgeschlagen.'),
        imported,
      );
    } catch {
      this.showOperationMessage('Die Importdatei konnte nicht gelesen werden.');
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
        this.lastError() ?? 'Entkopplung fehlgeschlagen. Die Kopplung bleibt erhalten.',
      );
    }
  }

  private showOperationMessage(message: string, succeeded = false): void {
    this.operationSucceeded.set(succeeded);
    this.operationMessage.set(message);
  }
}
