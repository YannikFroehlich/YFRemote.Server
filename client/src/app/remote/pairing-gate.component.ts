import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { PairingService } from './pairing.service';
import {
  DEVICE_NAME_MAX_LENGTH,
  guessDeviceName,
  normalizeDeviceName,
  normalizePin,
  pinValidator,
} from './pairing';

@Component({
  selector: 'app-pairing-gate',
  imports: [ReactiveFormsModule],
  templateUrl: './pairing-gate.component.html',
})
export class PairingGateComponent {
  private readonly pairing = inject(PairingService);

  protected readonly lastError = this.pairing.lastError;
  protected readonly remember = signal(true);
  protected readonly submitting = signal(false);

  protected readonly form = new FormGroup({
    pin: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, pinValidator],
    }),
    deviceName: new FormControl(guessDeviceName(), {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(DEVICE_NAME_MAX_LENGTH)],
    }),
  });

  protected toggleRemember(): void {
    this.remember.update((value) => !value);
  }

  protected hasFieldError(fieldName: 'pin' | 'deviceName'): boolean {
    const control = this.form.controls[fieldName];
    return control.invalid && (control.dirty || control.touched);
  }

  protected async submit(): Promise<void> {
    this.form.markAllAsTouched();

    if (this.form.invalid || this.submitting()) {
      return;
    }

    const pin = normalizePin(this.form.controls.pin.value);
    const deviceName = normalizeDeviceName(this.form.controls.deviceName.value);

    this.submitting.set(true);
    try {
      await this.pairing.pair(pin, deviceName, this.remember());
    } finally {
      this.submitting.set(false);
    }
  }
}
