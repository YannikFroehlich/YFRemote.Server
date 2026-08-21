import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export const PAIRING_TOKEN_STORAGE_KEY = 'yfremote.pairingToken';
export const PIN_LENGTH = 6;
export const DEVICE_NAME_MAX_LENGTH = 60;

const PIN_PATTERN = /^[0-9]{6}$/;

export function normalizePin(raw: string): string {
  return raw.trim();
}

export function isValidPin(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}

export function normalizeDeviceName(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > DEVICE_NAME_MAX_LENGTH ? trimmed.slice(0, DEVICE_NAME_MAX_LENGTH) : trimmed;
}

/** Grobe Geräte-Vorbelegung aus dem User-Agent; nur ein Startwert, den der Nutzer im
 *  Kopplungsformular überschreiben kann. */
export function guessDeviceName(): string {
  try {
    const userAgent = globalThis.navigator?.userAgent ?? '';

    if (/iPhone/i.test(userAgent)) {
      return 'iPhone';
    }

    if (/iPad/i.test(userAgent)) {
      return 'iPad';
    }

    if (/Android/i.test(userAgent)) {
      return 'Android-Gerät';
    }

    if (/Macintosh/i.test(userAgent)) {
      return 'Mac';
    }

    if (/Windows/i.test(userAgent)) {
      return 'Windows-PC';
    }

    if (/Linux/i.test(userAgent)) {
      return 'Linux-Gerät';
    }

    return 'Mein Gerät';
  } catch {
    return 'Mein Gerät';
  }
}

export function parseStoredPairingToken(rawValue: string | null): string | null {
  return rawValue !== null && rawValue.length > 0 ? rawValue : null;
}

export const pinValidator: ValidatorFn = (
  control: AbstractControl<unknown>,
): ValidationErrors | null => {
  const value = typeof control.value === 'string' ? control.value : '';
  return isValidPin(normalizePin(value)) ? null : { pin: true };
};
