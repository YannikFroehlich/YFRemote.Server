import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { KeyboardAction, TextAction } from './remote.models';

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
  'HOME',
  'END',
  'PAGE_UP',
  'PAGE_DOWN',
  'PRINT_SCREEN',
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

// label ist ein Key ins Uebersetzungs-Dictionary (translation.ts), kein Anzeigetext.
export const KEY_GROUPS: readonly KeyGroup[] = [
  { label: 'keyGroup.modifiers', keys: MODIFIER_KEYS },
  {
    label: 'Navigation',
    keys: [
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
      'HOME',
      'END',
      'PAGE_UP',
      'PAGE_DOWN',
      'PRINT_SCREEN',
    ],
  },
  {
    label: 'keyGroup.functionKeys',
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
  { label: 'keyGroup.letters', keys: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('') },
  { label: 'keyGroup.numbers', keys: '0123456789'.split('') },
];

// Werte sind Keys ins Uebersetzungs-Dictionary fuer Tasten, deren interner Name zu lang fuer
// die Tastenkacheln ist; BACKSPACE bleibt das sprachneutrale Symbol.
const KEY_LABELS: Readonly<Record<string, string>> = {
  HOME: 'key.home',
  END: 'key.end',
  PAGE_UP: 'key.pageUp',
  PAGE_DOWN: 'key.pageDown',
  PRINT_SCREEN: 'key.printScreen',
  BACKSPACE: '⌫',
};

export function keyLabel(key: string): string {
  return KEY_LABELS[key] ?? key;
}

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

// KeyboardEvent.key -> Tastenname des Servers, fuer Tasten ohne Zeichen.
const NAMED_KEYS: Readonly<Record<string, string>> = {
  Enter: 'ENTER',
  Escape: 'ESC',
  Tab: 'TAB',
  ' ': 'SPACE',
  Backspace: 'BACKSPACE',
  Delete: 'DELETE',
  ArrowUp: 'UP',
  ArrowDown: 'DOWN',
  ArrowLeft: 'LEFT',
  ArrowRight: 'RIGHT',
  Home: 'HOME',
  End: 'END',
  PageUp: 'PAGE_UP',
  PageDown: 'PAGE_DOWN',
  PrintScreen: 'PRINT_SCREEN',
};

/** Eine Taste der echten Tastatur am Geraet als Aktion fuer den PC, null fuer reine
 *  Umschalttasten und Tasten, die der Server nicht kennt. Zeichen ohne Strg/Alt/Win gehen als
 *  Text, so stimmen Umlaute, Grossbuchstaben und AltGr-Zeichen unabhaengig vom Tastaturlayout. */
export function physicalKeyAction(
  event: Pick<
    KeyboardEvent,
    'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey' | 'getModifierState'
  >,
): KeyboardAction | TextAction | null {
  const altGraph = event.getModifierState('AltGraph');
  const ctrl = event.ctrlKey && !altGraph;
  const alt = event.altKey && !altGraph;
  if (Array.from(event.key).length === 1 && event.key !== ' ' && !ctrl && !alt && !event.metaKey) {
    return { type: 'text', text: event.key };
  }

  // Kuerzel nach dem Buchstaben auf der Taste (Strg+Z bleibt auf QWERTZ Rueckgaengig), mit
  // Umschalt zaehlt die Taste selbst (Strg+Umschalt+1 statt "!").
  const name =
    NAMED_KEYS[event.key] ??
    (/^F([1-9]|1[0-2])$/.test(event.key) ? event.key : null) ??
    (/^[a-z0-9]$/i.test(event.key) ? event.key.toUpperCase() : null) ??
    /^(?:Key([A-Z])|Digit([0-9]))$/.exec(event.code)?.slice(1).find(Boolean) ??
    null;
  if (name === null) {
    return null;
  }

  const keys = [
    ...(ctrl ? ['CTRL'] : []),
    ...(alt ? ['ALT'] : []),
    ...(event.shiftKey ? ['SHIFT'] : []),
    ...(event.metaKey ? ['WIN'] : []),
    name,
  ];
  return keysToAction(keys);
}

/** Live-Eingabe: vergleicht das Feld mit dem zuletzt gesendeten Stand und liefert nur die
 *  Differenz (Rücktasten + neuer Text). So funktionieren auch Autokorrektur und
 *  Wortvorschläge der Handy-Tastatur, die ganze Wörter auf einmal ersetzen. */
export function liveTextActions(
  previousText: string,
  nextText: string,
): (KeyboardAction | TextAction)[] {
  // ponytail: eine Rücktaste pro Codepoint. Löscht die PC-Anwendung zusammengesetzte Emoji
  // am Stück, gehen dabei zu viele Zeichen weg; dann auf Intl.Segmenter (Grapheme) umstellen.
  const previous = Array.from(previousText);
  const next = Array.from(nextText);
  let common = 0;

  while (common < previous.length && common < next.length && previous[common] === next[common]) {
    common++;
  }

  const actions: (KeyboardAction | TextAction)[] = previous
    .slice(common)
    .map(() => ({ type: 'key', keys: ['BACKSPACE'] }));
  const inserted = next.slice(common).join('');

  if (inserted.length > 0) {
    actions.push({ type: 'text', text: inserted });
  }

  return actions;
}
