import { BUILT_IN_BUTTONS, DEFAULT_PLACEMENTS } from './remote-actions';
import { REMOTE_ICONS } from './remote-icons';
import { keysToAction } from './keyboard-keys';
import { MacroStep, RemoteAction, RemoteButtonConfig, RemoteIcon } from './remote.models';

export const BUTTON_LAYOUT_STORAGE_KEY = 'yfremote.buttonLayout';
export const BUTTON_LAYOUT_VERSION = 1;

export const LAYOUT_COLUMNS = 12;
export const LAYOUT_ROW_HEIGHT_PX = 34;
export const LAYOUT_GAP_PX = 9;
export const LAYOUT_MIN_ROWS = 14;
export const LAYOUT_MAX_ROWS = 60;

export const CUSTOM_BUTTON_ID_PREFIX = 'custom:';
export const MAX_CUSTOM_BUTTONS = 40;
export const MAX_LABEL_LENGTH = 14;
export const MAX_MACRO_STEPS = 10;
export const MAX_MACRO_DELAY_MS = 5000;
export const MAX_MACRO_TEXT_LENGTH = 500;

export interface ButtonPlacement {
  readonly id: string;
  readonly col: number;
  readonly row: number;
  readonly colSpan: number;
  readonly rowSpan: number;
}

export interface CustomButtonDefinition {
  readonly id: string;
  readonly label: string;
  readonly icon: RemoteIcon | null;
  readonly steps: readonly MacroStep[];
}

export interface ButtonLayout {
  readonly version: number;
  readonly snapToGrid: boolean;
  readonly placements: readonly ButtonPlacement[];
  readonly customButtons: readonly CustomButtonDefinition[];
  readonly hiddenBuiltInIds: readonly string[];
}

/** Zusammengeführte Sicht für die Darstellung; wird nie persistiert. */
export interface PlacedButton {
  readonly placement: ButtonPlacement;
  readonly button: RemoteButtonConfig;
  readonly isCustom: boolean;
}

export const DEFAULT_BUTTON_LAYOUT: ButtonLayout = {
  version: BUTTON_LAYOUT_VERSION,
  snapToGrid: true,
  placements: DEFAULT_PLACEMENTS,
  customButtons: [],
  hiddenBuiltInIds: [],
};

export function isCustomButtonId(id: string): boolean {
  return id.startsWith(CUSTOM_BUTTON_ID_PREFIX);
}

export function customButtonToConfig(definition: CustomButtonDefinition): RemoteButtonConfig {
  return {
    id: definition.id,
    label: definition.label,
    ariaLabel: definition.label,
    icon: definition.icon ?? 'key',
    steps: definition.steps,
  };
}

/** Liefert die auszuführenden Schritte für einen Button, egal ob er ein einfaches `action`
 *  (eingebaute Buttons) oder eine mehrschrittige `steps`-Kette (Custom-Buttons) trägt. */
export function resolveButtonSteps(button: RemoteButtonConfig): readonly MacroStep[] {
  if (button.steps !== undefined) {
    return button.steps;
  }

  return button.action === undefined ? [] : [{ action: button.action, delayMs: 0 }];
}

export function clampPlacement(
  placement: ButtonPlacement,
  columns: number = LAYOUT_COLUMNS,
): ButtonPlacement {
  const colSpan = clampInteger(placement.colSpan, 1, columns);
  const rowSpan = clampInteger(placement.rowSpan, 1, LAYOUT_MAX_ROWS);
  const col = clampNumber(placement.col, 0, columns - colSpan);
  const row = clampNumber(placement.row, 0, LAYOUT_MAX_ROWS - rowSpan);

  return { id: placement.id, col, row, colSpan, rowSpan };
}

export function snapPlacement(placement: ButtonPlacement): ButtonPlacement {
  return {
    ...placement,
    col: Math.round(placement.col),
    row: Math.round(placement.row),
  };
}

export function roundPlacementForStorage(placement: ButtonPlacement): ButtonPlacement {
  return {
    ...placement,
    col: roundTo(placement.col, 3),
    row: roundTo(placement.row, 3),
  };
}

export function overlaps(a: ButtonPlacement, b: ButtonPlacement): boolean {
  return (
    a.col < b.col + b.colSpan &&
    a.col + a.colSpan > b.col &&
    a.row < b.row + b.rowSpan &&
    a.row + a.rowSpan > b.row
  );
}

export function findFreeSlot(
  existing: readonly ButtonPlacement[],
  colSpan: number,
  rowSpan: number,
  columns: number = LAYOUT_COLUMNS,
): { readonly col: number; readonly row: number } {
  const span = clampInteger(colSpan, 1, columns);

  for (let row = 0; row <= LAYOUT_MAX_ROWS - rowSpan; row += 1) {
    for (let col = 0; col <= columns - span; col += 1) {
      const candidate: ButtonPlacement = { id: '', col, row, colSpan: span, rowSpan };

      if (!existing.some((placement) => overlaps(placement, candidate))) {
        return { col, row };
      }
    }
  }

  return { col: 0, row: computeMaxRow(existing) };
}

export function computeMaxRow(placements: readonly ButtonPlacement[]): number {
  return placements.reduce((max, placement) => Math.max(max, placement.row + placement.rowSpan), 0);
}

export function normalizeCustomButtonDefinition(
  candidate: unknown,
): CustomButtonDefinition | null {
  if (typeof candidate !== 'object' || candidate === null) {
    return null;
  }

  const value = candidate as Partial<CustomButtonDefinition> & {
    readonly action?: { readonly keys?: unknown };
  };

  if (typeof value.id !== 'string' || !isCustomButtonId(value.id)) {
    return null;
  }

  const label = typeof value.label === 'string' ? value.label.trim() : '';

  if (label.length === 0 || label.length > MAX_LABEL_LENGTH) {
    return null;
  }

  const icon = isRemoteIcon(value.icon) ? value.icon : null;

  // `steps` ist das aktuelle Format; ältere gespeicherte Buttons haben stattdessen ein
  // einzelnes `action.keys` (vor Einführung von Aktionsketten) und werden hier in einen
  // Ein-Schritt-Ablauf migriert.
  const steps = normalizeMacroSteps(value.steps) ?? legacyStepsFromAction(value.action);

  if (steps === null) {
    return null;
  }

  return { id: value.id, label, icon, steps };
}

function legacyStepsFromAction(
  action: { readonly keys?: unknown } | undefined,
): readonly MacroStep[] | null {
  const rawKeys = Array.isArray(action?.keys) ? (action?.keys as unknown[]) : [];
  const keys = rawKeys.filter((entry): entry is string => typeof entry === 'string');
  const keyboardAction = keysToAction(keys);

  return keyboardAction === null ? null : [{ action: keyboardAction, delayMs: 0 }];
}

export function normalizeMacroSteps(candidate: unknown): readonly MacroStep[] | null {
  if (!Array.isArray(candidate)) {
    return null;
  }

  const steps = candidate
    .map((entry) => normalizeMacroStep(entry))
    .filter((step): step is MacroStep => step !== null)
    .slice(0, MAX_MACRO_STEPS);

  return steps.length === 0 ? null : steps;
}

export function normalizeMacroStep(candidate: unknown): MacroStep | null {
  if (typeof candidate !== 'object' || candidate === null) {
    return null;
  }

  const value = candidate as { readonly action?: unknown; readonly delayMs?: unknown };
  const action = normalizeRemoteAction(value.action);

  if (action === null) {
    return null;
  }

  const delayMs =
    typeof value.delayMs === 'number' && Number.isFinite(value.delayMs)
      ? Math.min(Math.max(Math.round(value.delayMs), 0), MAX_MACRO_DELAY_MS)
      : 0;

  return { action, delayMs };
}

function normalizeRemoteAction(candidate: unknown): RemoteAction | null {
  if (typeof candidate !== 'object' || candidate === null) {
    return null;
  }

  const value = candidate as { readonly type?: unknown };

  switch (value.type) {
    case 'key':
    case 'hotkey': {
      const rawKeys = (candidate as { readonly keys?: unknown }).keys;
      const keys = Array.isArray(rawKeys)
        ? rawKeys.filter((entry): entry is string => typeof entry === 'string')
        : [];
      return keysToAction(keys);
    }

    case 'text': {
      const text = (candidate as { readonly text?: unknown }).text;
      return typeof text === 'string' && text.length > 0 && text.length <= MAX_MACRO_TEXT_LENGTH
        ? { type: 'text', text }
        : null;
    }

    case 'mouseClick': {
      const button = (candidate as { readonly button?: unknown }).button;
      return button === 'left' || button === 'right' ? { type: 'mouseClick', button } : null;
    }

    default:
      return null;
  }
}

/**
 * Führt ein gespeichertes Layout mit den eingebauten Buttons dieser App-Version
 * zusammen: unbekannte Platzierungen fallen weg, neue eingebaute Buttons werden
 * automatisch platziert (außer sie stehen bereits in hiddenBuiltInIds).
 */
export function resolveButtonLayout(
  stored: ButtonLayout,
  builtIns: readonly RemoteButtonConfig[] = BUILT_IN_BUTTONS,
): ButtonLayout {
  const customButtons = stored.customButtons
    .map((candidate) => normalizeCustomButtonDefinition(candidate))
    .filter((definition): definition is CustomButtonDefinition => definition !== null)
    .slice(0, MAX_CUSTOM_BUTTONS);

  const knownIds = new Set<string>([
    ...builtIns.map((button) => button.id),
    ...customButtons.map((definition) => definition.id),
  ]);

  const placements: ButtonPlacement[] = [];
  const seen = new Set<string>();

  for (const placement of stored.placements) {
    if (
      typeof placement.id !== 'string' ||
      !knownIds.has(placement.id) ||
      seen.has(placement.id) ||
      !Number.isFinite(placement.col) ||
      !Number.isFinite(placement.row) ||
      !Number.isFinite(placement.colSpan) ||
      !Number.isFinite(placement.rowSpan)
    ) {
      continue;
    }

    seen.add(placement.id);
    placements.push(clampPlacement(placement));
  }

  const hiddenBuiltInIds = stored.hiddenBuiltInIds.filter(
    (id) => typeof id === 'string' && knownIds.has(id) && !seen.has(id),
  );

  for (const builtIn of builtIns) {
    if (seen.has(builtIn.id) || hiddenBuiltInIds.includes(builtIn.id)) {
      continue;
    }

    const slot = findFreeSlot(placements, 1, 1);
    placements.push({ id: builtIn.id, col: slot.col, row: slot.row, colSpan: 1, rowSpan: 1 });
    seen.add(builtIn.id);
  }

  return {
    version: BUTTON_LAYOUT_VERSION,
    snapToGrid: stored.snapToGrid !== false,
    placements,
    customButtons,
    hiddenBuiltInIds,
  };
}

export function parseStoredButtonLayout(rawValue: string | null): ButtonLayout {
  if (rawValue === null) {
    return DEFAULT_BUTTON_LAYOUT;
  }

  try {
    const parsedValue: unknown = JSON.parse(rawValue);

    if (!isButtonLayoutLike(parsedValue) || parsedValue.version !== BUTTON_LAYOUT_VERSION) {
      return DEFAULT_BUTTON_LAYOUT;
    }

    return resolveButtonLayout(parsedValue);
  } catch {
    return DEFAULT_BUTTON_LAYOUT;
  }
}

export function labelVisibleFor(button: RemoteButtonConfig): boolean {
  return button.showLabel !== false;
}

function isButtonLayoutLike(value: unknown): value is ButtonLayout {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<ButtonLayout>;
  return (
    typeof candidate.version === 'number' &&
    Array.isArray(candidate.placements) &&
    Array.isArray(candidate.customButtons) &&
    Array.isArray(candidate.hiddenBuiltInIds)
  );
}

function isRemoteIcon(value: unknown): value is RemoteIcon {
  return typeof value === 'string' && (REMOTE_ICONS as readonly string[]).includes(value);
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(Math.max(Math.round(value), min), Math.max(min, max));
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(Math.max(value, min), Math.max(min, max));
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
