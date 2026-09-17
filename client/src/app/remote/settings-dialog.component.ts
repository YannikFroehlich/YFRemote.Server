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
  parsePortValue,
  portValidator,
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

    if (this.form.invalid || !isValidHost(host) || port === null || mouseSensitivity === null) {
      return;
    }

    const mouseSensitivitySaved = this.remote.saveMouseSensitivity(mouseSensitivity);
    const configSaved = mouseSensitivitySaved && this.remote.saveConfig({ host, port });

    if (configSaved && mouseSensitivitySaved) {
      this.closed.emit();
    }
  }

  protected sensitivityLabel(): string {
    return Number(this.form.controls.mouseSensitivity.value).toFixed(2);
  }

  protected hasFieldError(fieldName: 'host' | 'port' | 'mouseSensitivity'): boolean {
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
