import { Component, inject, output } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
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

  readonly closed = output<void>();

  protected readonly status = this.remote.status;
  protected readonly mouseSensitivityMin = MOUSE_SENSITIVITY_MIN;
  protected readonly mouseSensitivityMax = MOUSE_SENSITIVITY_MAX;
  protected readonly mouseSensitivityStep = MOUSE_SENSITIVITY_STEP;
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
}
