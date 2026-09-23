import { Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { PairingService } from './pairing.service';
import {
  DEVICE_NAME_MAX_LENGTH,
  guessDeviceName,
  getPairingPinFromHash,
  normalizeDeviceName,
  normalizePin,
  PAIRING_HISTORY,
  pinValidator,
} from './pairing';
import { SERVER_LOCATION } from './server-config';
import { TranslationKey } from './translation';
import { TranslationService } from './translation.service';

@Component({
  selector: 'app-pairing-gate',
  imports: [ReactiveFormsModule],
  templateUrl: './pairing-gate.component.html',
})
export class PairingGateComponent {
  private readonly pairing = inject(PairingService);
  private readonly serverLocation = inject(SERVER_LOCATION);
  private readonly history = inject(PAIRING_HISTORY);
  protected readonly i18n = inject(TranslationService);
  private readonly initialPin = getPairingPinFromHash(this.serverLocation.hash ?? '');

  protected readonly lastError = this.pairing.lastError;
  private readonly serverPlatform = this.pairing.serverPlatform;
  protected readonly titleKey = computed<TranslationKey>(() =>
    this.serverPlatform() === 'android' ? 'pairingGate.title.android' : 'pairingGate.title',
  );
  protected readonly copyKey = computed<TranslationKey>(() => {
    switch (this.serverPlatform()) {
      case 'android':
        return 'pairingGate.copy.android';
      case 'linux':
        return 'pairingGate.copy.linux';
      default:
        return 'pairingGate.copy';
    }
  });
  protected readonly remember = signal(true);
  protected readonly submitting = signal(false);

  protected readonly form = new FormGroup({
    pin: new FormControl(this.initialPin, {
      nonNullable: true,
      validators: [Validators.required, pinValidator],
    }),
    deviceName: new FormControl(this.i18n.t(guessDeviceName()), {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(DEVICE_NAME_MAX_LENGTH)],
    }),
  });

  constructor() {
    void this.pairing.detectServerPlatform();

    if (this.initialPin.length > 0) {
      const cleanUrl = `${this.serverLocation.pathname ?? '/'}${this.serverLocation.search ?? ''}`;
      this.history.replaceState(null, '', cleanUrl);
    }
  }

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
