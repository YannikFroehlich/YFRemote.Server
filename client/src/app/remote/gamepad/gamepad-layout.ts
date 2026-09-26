export const GAMEPAD_LAYOUT_STORAGE_KEY = 'yfremote.gamepadLayout';

export const GAMEPAD_PRESET_IDS = ['xbox', 'playstation', 'nintendo', 'retro'] as const;
export type GamepadPresetId = (typeof GAMEPAD_PRESET_IDS)[number];

/** Reihenfolge = Zeichenreihenfolge; Spaeteres liegt bei Ueberlappung oben. */
export const GAMEPAD_CONTROL_IDS = [
  'leftTrigger',
  'leftShoulder',
  'rightShoulder',
  'rightTrigger',
  'leftStick',
  'rightStick',
  'dpad',
  'face',
  'back',
  'guide',
  'start',
  'leftThumb',
  'rightThumb',
] as const;
export type GamepadControlId = (typeof GAMEPAD_CONTROL_IDS)[number];

/** Mittelpunkt in Prozent der Controller-Flaeche, Groesse als Faktor der Grundgroesse. */
export interface GamepadControlPlacement {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly hidden: boolean;
}

export type GamepadControls = Readonly<Record<GamepadControlId, GamepadControlPlacement>>;

export interface GamepadLayout {
  readonly preset: GamepadPresetId;
  readonly controls: GamepadControls;
}

/** Beschriftbare Tasten; das Steuerkreuz hat Pfeile und braucht keine. */
export type GamepadLabelKey =
  | 'a'
  | 'b'
  | 'x'
  | 'y'
  | 'leftShoulder'
  | 'rightShoulder'
  | 'leftTrigger'
  | 'rightTrigger'
  | 'back'
  | 'start'
  | 'guide'
  | 'leftThumb'
  | 'rightThumb';

export interface GamepadPreset {
  readonly name: string;
  readonly labels: Readonly<Record<GamepadLabelKey, string>>;
  readonly controls: GamepadControls;
}

export const MIN_CONTROL_SCALE = 0.5;
export const MAX_CONTROL_SCALE = 2;

function place(x: number, y: number, scale = 1, hidden = false): GamepadControlPlacement {
  return { x, y, scale, hidden };
}

// Versetzte Sticks: links Stick oben/Kreuz unten, rechts Tasten oben/Stick unten.
const OFFSET_CONTROLS: GamepadControls = {
  leftTrigger: place(9, 10),
  leftShoulder: place(24, 10),
  rightShoulder: place(76, 10),
  rightTrigger: place(91, 10),
  leftStick: place(14, 45),
  rightStick: place(70, 78),
  dpad: place(30, 78),
  face: place(86, 45),
  back: place(40, 50),
  guide: place(50, 50),
  start: place(60, 50),
  leftThumb: place(44, 68),
  rightThumb: place(56, 68),
};

// Nintendo beschriftet nach Position anders als Xbox: unten steht B, rechts A. Gesendet wird nach
// Position (unten = XInput-A), so wie es Steam und Windows mit einem Switch-Controller auch tun.
const NINTENDO_FACE = { a: 'B', b: 'A', x: 'Y', y: 'X' } as const;

export const GAMEPAD_PRESETS: Readonly<Record<GamepadPresetId, GamepadPreset>> = {
  xbox: {
    name: 'Xbox',
    labels: {
      a: 'A',
      b: 'B',
      x: 'X',
      y: 'Y',
      leftShoulder: 'LB',
      rightShoulder: 'RB',
      leftTrigger: 'LT',
      rightTrigger: 'RT',
      back: 'Back',
      start: 'Start',
      guide: 'Xbox',
      leftThumb: 'LS',
      rightThumb: 'RS',
    },
    controls: OFFSET_CONTROLS,
  },
  playstation: {
    name: 'PlayStation',
    labels: {
      a: '✕',
      b: '○',
      x: '□',
      y: '△',
      leftShoulder: 'L1',
      rightShoulder: 'R1',
      leftTrigger: 'L2',
      rightTrigger: 'R2',
      back: 'Share',
      start: 'Options',
      guide: 'PS',
      leftThumb: 'L3',
      rightThumb: 'R3',
    },
    controls: {
      ...OFFSET_CONTROLS,
      dpad: place(15, 42),
      face: place(85, 42),
      leftStick: place(33, 76),
      rightStick: place(67, 76),
      back: place(36, 30),
      start: place(64, 30),
      guide: place(50, 78),
      leftThumb: place(43, 52),
      rightThumb: place(57, 52),
    },
  },
  nintendo: {
    name: 'Nintendo Switch',
    labels: {
      ...NINTENDO_FACE,
      leftShoulder: 'L',
      rightShoulder: 'R',
      leftTrigger: 'ZL',
      rightTrigger: 'ZR',
      back: '−',
      start: '+',
      guide: 'Home',
      leftThumb: 'LS',
      rightThumb: 'RS',
    },
    controls: OFFSET_CONTROLS,
  },
  retro: {
    name: 'Retro (SNES)',
    labels: {
      ...NINTENDO_FACE,
      leftShoulder: 'L',
      rightShoulder: 'R',
      leftTrigger: 'ZL',
      rightTrigger: 'ZR',
      back: 'Select',
      start: 'Start',
      guide: 'Home',
      leftThumb: 'LS',
      rightThumb: 'RS',
    },
    controls: {
      leftTrigger: place(9, 10, 1, true),
      leftShoulder: place(14, 10, 1.2),
      rightShoulder: place(86, 10, 1.2),
      rightTrigger: place(91, 10, 1, true),
      leftStick: place(14, 45, 1, true),
      rightStick: place(70, 78, 1, true),
      dpad: place(20, 58, 1.25),
      face: place(80, 58, 1.25),
      back: place(42, 64),
      guide: place(50, 50, 1, true),
      start: place(58, 64),
      leftThumb: place(44, 68, 1, true),
      rightThumb: place(56, 68, 1, true),
    },
  },
};

export function presetLayout(preset: GamepadPresetId): GamepadLayout {
  return { preset, controls: GAMEPAD_PRESETS[preset].controls };
}

export const DEFAULT_GAMEPAD_LAYOUT = presetLayout('xbox');

/** Liest ein gespeichertes Layout; Unbrauchbares faellt pro Element auf die Vorlage zurueck. */
export function parseStoredGamepadLayout(rawValue: string | null): GamepadLayout {
  let parsed: unknown;
  try {
    parsed = rawValue === null ? null : JSON.parse(rawValue);
  } catch {
    return DEFAULT_GAMEPAD_LAYOUT;
  }

  if (!isRecord(parsed) || !isPresetId(parsed['preset'])) {
    return DEFAULT_GAMEPAD_LAYOUT;
  }

  const preset = GAMEPAD_PRESETS[parsed['preset']];
  const stored = isRecord(parsed['controls']) ? parsed['controls'] : {};
  const controls = Object.fromEntries(
    GAMEPAD_CONTROL_IDS.map((id) => [id, normalizePlacement(stored[id]) ?? preset.controls[id]]),
  ) as Record<GamepadControlId, GamepadControlPlacement>;

  return { preset: parsed['preset'], controls };
}

export function clampPlacement(placement: GamepadControlPlacement): GamepadControlPlacement {
  return {
    x: roundTo(clamp(placement.x, 0, 100), 1),
    y: roundTo(clamp(placement.y, 0, 100), 1),
    scale: roundTo(clamp(placement.scale, MIN_CONTROL_SCALE, MAX_CONTROL_SCALE), 2),
    hidden: placement.hidden,
  };
}

function normalizePlacement(candidate: unknown): GamepadControlPlacement | null {
  if (
    !isRecord(candidate) ||
    !isFiniteNumber(candidate['x']) ||
    !isFiniteNumber(candidate['y']) ||
    !isFiniteNumber(candidate['scale']) ||
    typeof candidate['hidden'] !== 'boolean'
  ) {
    return null;
  }

  return clampPlacement({
    x: candidate['x'],
    y: candidate['y'],
    scale: candidate['scale'],
    hidden: candidate['hidden'],
  });
}

function isPresetId(value: unknown): value is GamepadPresetId {
  return (GAMEPAD_PRESET_IDS as readonly unknown[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
