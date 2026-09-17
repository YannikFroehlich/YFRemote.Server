import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { KeyboardAction } from './remote.models';

export const MAX_HOTKEY_KEYS = 4;

export const MODIFIER_KEYS: readonly string[] = ['CTRL', 'SHIFT', 'ALT', 'WIN'];

// Muss zur Allowlist in WindowsInputService.VirtualKeys auf dem Server passen.
export const SUPPORTED_KEYS: readonly string[] = [
  ...MODIFIER_KEYS,
  'ENTER',
  'ESC',
  'TAB',
  'SPACE',
  'BACKSPACE',
  'DELETE',
  'UP',
  'DOWN',
  'LEFT',
  'RIGHT',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
  ...'0123456789'.split(''),
];

export interface KeyGroup {
  readonly label: string;
  readonly keys: readonly string[];
}

export const KEY_GROUPS: readonly KeyGroup[] = [
  { label: 'Modifikatoren', keys: MODIFIER_KEYS },
  {
    label: 'Navigation',
    keys: ['ENTER', 'ESC', 'TAB', 'SPACE', 'BACKSPACE', 'DELETE', 'UP', 'DOWN', 'LEFT', 'RIGHT'],
  },
  {
    label: 'Funktionstasten',
    keys: [
      'F1',
      'F2',
      'F3',
      'F4',
      'F5',
      'F6',
      'F7',
      'F8',
      'F9',
      'F10',
      'F11',
      'F12',
    ],
  },
  { label: 'Buchstaben', keys: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('') },
  { label: 'Zahlen', keys: '0123456789'.split('') },
];

export function isSupportedKey(key: string): boolean {
  return SUPPORTED_KEYS.includes(normalizeKeyName(key));
}

export function normalizeKeyName(key: string): string {
  return key.trim().toUpperCase();
}

/**
 * Normalizes a raw key selection: trims/uppercases, drops blanks, de-duplicates
 * (case-insensitively) while preserving first-seen order, and rejects the
 * selection outright if any entry is unsupported or the count is out of range.
 */
export function normalizeKeySelection(keys: readonly string[]): readonly string[] | null {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const rawKey of keys) {
    const key = normalizeKeyName(rawKey);

    if (key.length === 0) {
      continue;
    }

    if (!isSupportedKey(key)) {
      return null;
    }

    if (seen.has(key)) {
      return null;
    }

    seen.add(key);
    normalized.push(key);
  }

  if (normalized.length === 0 || normalized.length > MAX_HOTKEY_KEYS) {
    return null;
  }

  return normalized;
}

export function keysToAction(keys: readonly string[]): KeyboardAction | null {
  const normalized = normalizeKeySelection(keys);

  if (normalized === null) {
    return null;
  }

  return normalized.length === 1
    ? { type: 'key', keys: normalized }
    : { type: 'hotkey', keys: normalized };
}

export const keySelectionValidator: ValidatorFn = (
  control: AbstractControl<unknown>,
): ValidationErrors | null => {
  const value = Array.isArray(control.value) ? (control.value as unknown[]) : [];
  const keys = value.filter((entry): entry is string => typeof entry === 'string');
  return keysToAction(keys) === null ? { keys: true } : null;
};
