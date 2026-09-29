import {
  afterNextRender,
  Component,
  computed,
  effect,
  inject,
  OnDestroy,
  output,
  signal,
} from '@angular/core';
import { GamepadState } from '../remote.models';
import { REMOTE_STORAGE, REMOTE_VIBRATE } from '../remote.service';
import { GAMEPAD_TRANSPORT } from './gamepad-transport';
import { isTrustworthyOrigin, SERVER_LOCATION } from '../server-config';
import { TranslationService } from '../translation.service';
import {
  clampPlacement,
  GAMEPAD_CONTROL_IDS,
  GAMEPAD_ICON_PATHS,
  GAMEPAD_LAYOUT_STORAGE_KEY,
  GAMEPAD_PRESET_IDS,
  GAMEPAD_PRESETS,
  GRID_CELLS,
  GamepadControlId,
  GamepadControlPlacement,
  GamepadLabelKey,
  GamepadLayout,
  GamepadPresetId,
  parseStoredGamepadLayout,
  presetLayout,
} from './gamepad-layout';

/** XInput-Bitmaske (XINPUT_GAMEPAD_*), dieselben Werte wie Xbox360Button auf dem Server. */
export const GAMEPAD_BUTTONS = {
  up: 0x0001,
  down: 0x0002,
  left: 0x0004,
  right: 0x0008,
  start: 0x0010,
  back: 0x0020,
  leftThumb: 0x0040,
  rightThumb: 0x0080,
  leftShoulder: 0x0100,
  rightShoulder: 0x0200,
  guide: 0x0400,
  a: 0x1000,
  b: 0x2000,
  x: 0x4000,
  y: 0x8000,
} as const;

export type GamepadButton = keyof typeof GAMEPAD_BUTTONS;
type Side = 'left' | 'right';

type ControlView =
  | { readonly id: GamepadControlId; readonly kind: 'stick' | 'trigger'; readonly side: Side }
  | { readonly id: GamepadControlId; readonly kind: 'dpad' | 'face' }
  | {
      readonly id: GamepadControlId;
      readonly kind: 'button';
      readonly button: GamepadButton & GamepadLabelKey;
      readonly keyClass: string;
    };

interface Drag {
  readonly pointerId: number;
  readonly id: GamepadControlId;
  readonly area: DOMRect;
  readonly startX: number;
  readonly startY: number;
  readonly origin: GamepadControlPlacement;
}

const CONTROL_VIEWS: readonly ControlView[] = GAMEPAD_CONTROL_IDS.map((id): ControlView => {
  switch (id) {
    case 'leftStick':
    case 'rightStick':
      return { id, kind: 'stick', side: id === 'leftStick' ? 'left' : 'right' };
    case 'leftTrigger':
    case 'rightTrigger':
      return { id, kind: 'trigger', side: id === 'leftTrigger' ? 'left' : 'right' };
    case 'dpad':
    case 'face':
      return { id, kind: id };
    case 'leftShoulder':
    case 'rightShoulder':
      return { id, kind: 'button', button: id, keyClass: 'gp-key--shoulder' };
    case 'guide':
      return { id, kind: 'button', button: id, keyClass: 'gp-key--guide' };
    default:
      return { id, kind: 'button', button: id, keyClass: 'gp-key--small' };
  }
});

const SCALE_STEP = 0.1;

// Anordnung wie auf dem Pad: Y oben, X links, B rechts, A unten.
const FACE_BUTTONS = [
  { button: 'y', area: 'up' },
  { button: 'x', area: 'left' },
  { button: 'b', area: 'right' },
  { button: 'a', area: 'down' },
] as const;

type HeldControl =
  | { readonly kind: 'button'; readonly button: GamepadButton }
  | {
      readonly kind: 'trigger';
      readonly side: Side;
      readonly top: number;
      readonly height: number;
      value: number;
    }
  | {
      readonly kind: 'stick';
      readonly side: Side;
      readonly centerX: number;
      readonly centerY: number;
      readonly radius: number;
      x: number;
      y: number;
    };

export const NEUTRAL_GAMEPAD: GamepadState = {
  buttons: 0,
  leftX: 0,
  leftY: 0,
  rightX: 0,
  rightY: 0,
  leftTrigger: 0,
  rightTrigger: 0,
};

const AXIS_MAX = 32767;
const TRIGGER_MAX = 255;
// Leichtester Wert eines gedrueckten Triggers - deutlich ueber der XInput-Schwelle von 30
// (XINPUT_GAMEPAD_TRIGGER_THRESHOLD), damit auch ein kurzer Tipp in jedem Spiel als Druck zaehlt.
const TRIGGER_MIN = 64;
// Ab diesem Anteil der Trigger-Hoehe ist er voll gezogen - ganz bis an die Unterkante muss der
// Finger dafuer nicht.
const TRIGGER_FULL_AT = 0.8;
// Ein 120-Hz-Display liefert 120 Frames pro Sekunde - genau das Nachrichtenlimit des Servers pro
// Verbindung. Mit diesem Abstand bleibt der Controller bei ~60 Nachrichten/s.
const MIN_SEND_INTERVAL_MS = 16;
const HAPTIC_PULSE_MS = 8;
// navigator.vibrate kennt nur an/aus und begrenzt die Dauer (Chrome: 10 s). Das Spiel meldet nur
// Aenderungen, deshalb bis zur naechsten Meldung durchvibrieren.
// ponytail: Staerke wird ignoriert und eine Vibration ueber 10 s endet vorzeitig - bei Bedarf per
// Muster (an/aus-Pulse) abstufen und vor Ablauf erneuern.
const RUMBLE_MAX_MS = 10000;

export const GAMEPAD_GYRO_STORAGE_KEY = 'yfremote.gamepadGyro';
// ponytail: feste Empfindlichkeit - bei Bedarf als Einstellung anbieten.
const GYRO_FULL_TILT_DEG = 25;
const GYRO_DEADZONE_DEG = 2;

interface Tilt {
  readonly beta: number;
  readonly gamma: number;
}

@Component({
  selector: 'app-gamepad',
  templateUrl: './gamepad.component.html',
  styleUrl: './gamepad.component.scss',
  host: {
    '(pointermove)': 'onPointerMove($event)',
    '(pointerup)': 'release($event)',
    '(pointercancel)': 'release($event)',
    '(lostpointercapture)': 'release($event)',
    '(contextmenu)': '$event.preventDefault()',
    // Wechselt das Handy die App, kommt kein pointerup mehr - ohne das hier bliebe z. B. Gas
    // (RT) am PC gedrueckt.
    '(document:visibilitychange)': 'releaseAll()',
    '(window:blur)': 'releaseAll()',
    '(window:deviceorientation)': 'onOrientation($event)',
  },
})
export class GamepadComponent implements OnDestroy {
  // WebSocket zum Server oder, in der Android-App, Bluetooth (gamepad-transport.ts).
  private readonly remote = inject(GAMEPAD_TRANSPORT);
  private readonly vibrate = inject(REMOTE_VIBRATE);
  private readonly storage = inject(REMOTE_STORAGE);
  private readonly location = inject(SERVER_LOCATION);
  protected readonly i18n = inject(TranslationService);

  protected readonly presetIds = GAMEPAD_PRESET_IDS;
  protected readonly presets = GAMEPAD_PRESETS;
  protected readonly controlViews = CONTROL_VIEWS;
  protected readonly faceButtons = FACE_BUTTONS;
  protected readonly layout = signal<GamepadLayout>(
    parseStoredGamepadLayout(this.storage?.getItem(GAMEPAD_LAYOUT_STORAGE_KEY) ?? null),
  );
  protected readonly labels = computed(() => GAMEPAD_PRESETS[this.layout().preset].labels);
  protected readonly editing = signal(false);
  protected readonly selectedId = signal<GamepadControlId | null>(null);
  protected readonly resetPending = signal(false);
  private drag: Drag | null = null;

  readonly closed = output<void>();

  protected readonly status = this.remote.status;
  protected readonly lastError = this.remote.lastError;
  protected readonly state = signal<GamepadState>(NEUTRAL_GAMEPAD);

  private readonly held = new Map<number, HeldControl>();
  private lastSent: GamepadState = NEUTRAL_GAMEPAD;
  private lastSentAt = -Infinity;
  private frameId: number | null = null;

  /** Neigungssteuerung: Handy neigen bewegt den rechten Stick. Nullstellung ist die Haltung beim
   *  Einschalten bzw. beim Zurueckkehren in die App. */
  protected readonly gyro = signal(this.storage?.getItem(GAMEPAD_GYRO_STORAGE_KEY) === 'true');
  protected readonly gyroHint = signal<string | null>(null);
  private gyroReference: Tilt | null = null;
  private gyroStick = { x: 0, y: 0 };

  // Nur ein Wechsel an/aus erreicht das Handy; derselbe Wert erneut aendert das Signal nicht.
  private readonly rumbling = computed(() => this.remote.gamepadRumble() > 0);
  private readonly rumbleEffect = effect(() => this.vibrate(this.rumbling() ? RUMBLE_MAX_MS : 0));

  constructor() {
    afterNextRender(() => void enterLandscapeFullscreen());
  }

  protected pressButton(event: PointerEvent, button: GamepadButton): void {
    this.hold(event, { kind: 'button', button });
  }

  protected pressTrigger(event: PointerEvent, side: Side): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const trigger: HeldControl = { kind: 'trigger', side, top: rect.top, height: rect.height, value: 0 };
    moveTrigger(trigger, event);
    this.hold(event, trigger);
  }

  protected grabStick(event: PointerEvent, side: Side): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const stick: HeldControl = {
      kind: 'stick',
      side,
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
      radius: Math.max(rect.width / 2, 1),
      x: 0,
      y: 0,
    };
    moveStick(stick, event);
    this.hold(event, stick);
  }

  protected async toggleGyro(): Promise<void> {
    this.gyroHint.set(null);

    if (this.gyro()) {
      this.setGyro(false);
      return;
    }

    // Browser liefern Bewegungssensoren nur in einem sicheren Kontext (HTTPS oder localhost).
    if (!isTrustworthyOrigin(this.location)) {
      this.gyroHint.set('gamepad.gyroInsecureOrigin');
      return;
    }

    // iOS fragt erst nach, und nur aus einem Tipp heraus; andere Browser kennen die Methode nicht.
    const orientationEvent = globalThis.DeviceOrientationEvent as
      { requestPermission?: () => Promise<string> } | undefined;
    try {
      if ((await orientationEvent?.requestPermission?.()) === 'denied') {
        this.gyroHint.set('gamepad.gyroDenied');
        return;
      }
    } catch {
      this.gyroHint.set('gamepad.gyroDenied');
      return;
    }

    this.setGyro(true);
  }

  protected onOrientation(event: DeviceOrientationEvent): void {
    if (!this.gyro() || event.beta === null || event.gamma === null) {
      return;
    }

    const tilt = { beta: event.beta, gamma: event.gamma };
    this.gyroReference ??= tilt;
    this.gyroStick = tiltToStick(
      tilt,
      this.gyroReference,
      globalThis.screen?.orientation?.angle ?? 0,
    );
    this.update();
  }

  protected label(key: GamepadLabelKey): string {
    return this.labels()[key];
  }

  protected iconPath(key: GamepadLabelKey): string | null {
    const icon = GAMEPAD_PRESETS[this.layout().preset].icons?.[key];
    return icon ? GAMEPAD_ICON_PATHS[icon] : null;
  }

  protected startEditing(): void {
    this.releaseAll();
    this.editing.set(true);
  }

  protected stopEditing(): void {
    this.editing.set(false);
    this.selectedId.set(null);
    this.resetPending.set(false);
  }

  protected selectPreset(preset: string): void {
    const id = GAMEPAD_PRESET_IDS.find((candidate) => candidate === preset);
    if (id) {
      this.saveLayout(presetLayout(id, this.layout().snapToGrid));
    }
  }

  protected confirmReset(): void {
    this.saveLayout(presetLayout(this.layout().preset, this.layout().snapToGrid));
    this.resetPending.set(false);
  }

  protected toggleSnapToGrid(): void {
    this.saveLayout({ ...this.layout(), snapToGrid: !this.layout().snapToGrid });
  }

  protected resize(direction: 1 | -1): void {
    this.updateSelected((placement) => ({
      ...placement,
      scale: placement.scale + direction * SCALE_STEP,
    }));
  }

  protected toggleHidden(): void {
    this.updateSelected((placement) => ({ ...placement, hidden: !placement.hidden }));
  }

  protected grabControl(event: PointerEvent, id: GamepadControlId): void {
    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture?.(event.pointerId);
    this.selectedId.set(id);
    this.drag = {
      pointerId: event.pointerId,
      id,
      area: (target.closest('.gamepad') ?? target).getBoundingClientRect(),
      startX: event.clientX,
      startY: event.clientY,
      origin: this.layout().controls[id],
    };
  }

  protected onPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (drag?.pointerId === event.pointerId) {
      const width = Math.max(drag.area.width, 1);
      const height = Math.max(drag.area.height, 1);
      let x = (drag.origin.x / 100) * width + event.clientX - drag.startX;
      let y = (drag.origin.y / 100) * height + event.clientY - drag.startY;
      if (this.layout().snapToGrid) {
        // Quadratische Zellen: Schrittweite in Pixeln aus der Hoehe, auch fuer x.
        const cell = height / GRID_CELLS;
        x = Math.round(x / cell) * cell;
        y = Math.round(y / cell) * cell;
      }
      this.setPlacement(drag.id, { ...drag.origin, x: (x / width) * 100, y: (y / height) * 100 });
      return;
    }

    const control = this.held.get(event.pointerId);
    if (control?.kind === 'stick') {
      moveStick(control, event);
      this.update();
    } else if (control?.kind === 'trigger') {
      moveTrigger(control, event);
      this.update();
    }
  }

  protected release(event: PointerEvent): void {
    if (this.drag?.pointerId === event.pointerId) {
      this.drag = null;
    }

    if (this.held.delete(event.pointerId)) {
      this.update();
    }
  }

  protected releaseAll(): void {
    // Nach dem Zurueckkehren haelt man das Handy meist anders - dann neu ausrichten.
    this.gyroReference = null;

    if (this.held.size > 0) {
      this.held.clear();
      this.update();
    }
  }

  protected isPressed(button: GamepadButton): boolean {
    return (this.state().buttons & GAMEPAD_BUTTONS[button]) !== 0;
  }

  /** Anteil 0..1 fuer die Fuellanzeige im Trigger. */
  protected triggerPull(side: Side): number {
    return (side === 'left' ? this.state().leftTrigger : this.state().rightTrigger) / TRIGGER_MAX;
  }

  protected isTriggerPressed(side: Side): boolean {
    return (side === 'left' ? this.state().leftTrigger : this.state().rightTrigger) > 0;
  }

  protected knobTransform(side: Side): string {
    const state = this.state();
    const x = (side === 'left' ? state.leftX : state.rightX) / AXIS_MAX;
    const y = (side === 'left' ? state.leftY : state.rightY) / AXIS_MAX;
    // Der Knopf wandert hoechstens bis zum Rand der Mulde (halbe Muldenbreite = 100 % Knopf).
    return `translate(${(x * 100).toFixed(1)}%, ${(-y * 100).toFixed(1)}%)`;
  }

  ngOnDestroy(): void {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }

    // Beim Verlassen den Controller am PC abstecken, sonst sieht ein Spiel ihn weiterhin -
    // auch dann, wenn das Geraet laengst wieder Maus oder Tastatur ist.
    if (this.status() === 'connected') {
      this.remote.sendAction({ type: 'gamepadDisconnect' });
    }

    this.vibrate(0);
    exitFullscreen();
  }

  private setGyro(enabled: boolean): void {
    this.gyro.set(enabled);
    this.storage?.setItem(GAMEPAD_GYRO_STORAGE_KEY, String(enabled));
    this.gyroReference = null;
    this.gyroStick = { x: 0, y: 0 };
    this.update();
  }

  private updateSelected(
    change: (placement: GamepadControlPlacement) => GamepadControlPlacement,
  ): void {
    const id = this.selectedId();
    if (id !== null) {
      this.setPlacement(id, change(this.layout().controls[id]));
    }
  }

  private setPlacement(id: GamepadControlId, placement: GamepadControlPlacement): void {
    const layout = this.layout();
    this.saveLayout({
      ...layout,
      controls: { ...layout.controls, [id]: clampPlacement(placement) },
    });
  }

  // ponytail: speichert bei jeder Ziehbewegung - localStorage ist synchron und schnell genug;
  // bei Rucklern erst beim Loslassen speichern.
  private saveLayout(layout: GamepadLayout): void {
    this.layout.set(layout);
    this.storage?.setItem(GAMEPAD_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  }

  private hold(event: PointerEvent, control: HeldControl): void {
    event.preventDefault();
    (event.currentTarget as Element | null)?.setPointerCapture?.(event.pointerId);
    this.held.set(event.pointerId, control);

    if (control.kind === 'stick') {
      this.update();
      return;
    }

    if (this.remote.haptics()) {
      this.vibrate(HAPTIC_PULSE_MS);
    }

    // Tasten sofort senden statt erst im naechsten Frame: ein kurzer Tipp waere dort schon wieder
    // losgelassen, und der Druck kaeme nie am PC an.
    this.state.set(this.computeState());
    this.send();
  }

  private update(): void {
    this.state.set(this.computeState());
    this.scheduleSend();
  }

  private computeState(): GamepadState {
    let buttons = 0;
    let leftTrigger = 0;
    let rightTrigger = 0;
    let left = { x: 0, y: 0 };
    // Ein Finger auf dem rechten Stick hat Vorrang vor der Neigung.
    let right = this.gyro() ? this.gyroStick : { x: 0, y: 0 };

    for (const control of this.held.values()) {
      switch (control.kind) {
        case 'button':
          buttons |= GAMEPAD_BUTTONS[control.button];
          break;
        case 'trigger':
          if (control.side === 'left') {
            leftTrigger = control.value;
          } else {
            rightTrigger = control.value;
          }
          break;
        case 'stick':
          if (control.side === 'left') {
            left = control;
          } else {
            right = control;
          }
          break;
      }
    }

    return {
      buttons,
      leftX: left.x,
      leftY: left.y,
      rightX: right.x,
      rightY: right.y,
      leftTrigger,
      rightTrigger,
    };
  }

  private scheduleSend(): void {
    if (this.frameId !== null) {
      return;
    }

    this.frameId = requestAnimationFrame((now) => {
      this.frameId = null;

      if (now - this.lastSentAt < MIN_SEND_INTERVAL_MS) {
        this.scheduleSend();
        return;
      }

      if (this.send()) {
        this.lastSentAt = now;
      }
    });
  }

  private send(): boolean {
    const state = this.state();
    // Ohne Verbindung nichts senden (sonst bei jeder Bewegung eine Fehlermeldung); lastSent bleibt
    // dann stehen, und die naechste Aenderung nach dem Wiederverbinden geht vollstaendig raus.
    if (sameState(state, this.lastSent) || this.status() !== 'connected') {
      return false;
    }

    if (!this.remote.sendAction({ type: 'gamepad', gamepad: state })) {
      return false;
    }

    this.lastSent = state;
    return true;
  }
}

/** Die Zugposition des Fingers stuft den Trigger ab: oben angetippt = leicht, nach unten gezogen
 *  = voll. Der Finger bleibt per Pointer-Capture am Trigger, auch wenn er ueber den Rand rutscht. */
function moveTrigger(trigger: Extract<HeldControl, { kind: 'trigger' }>, event: PointerEvent): void {
  // Ohne Layout (Hoehe 0) gibt es keine Zugposition - dann wie bisher voll.
  if (trigger.height <= 0) {
    trigger.value = TRIGGER_MAX;
    return;
  }

  const pull = Math.min(Math.max(event.clientY - trigger.top, 0) / (trigger.height * TRIGGER_FULL_AT), 1);
  trigger.value = Math.round(TRIGGER_MIN + pull * (TRIGGER_MAX - TRIGGER_MIN));
}

function moveStick(stick: Extract<HeldControl, { kind: 'stick' }>, event: PointerEvent): void {
  let dx = (event.clientX - stick.centerX) / stick.radius;
  let dy = (event.clientY - stick.centerY) / stick.radius;
  const length = Math.hypot(dx, dy);

  if (length > 1) {
    dx /= length;
    dy /= length;
  }

  stick.x = Math.round(dx * AXIS_MAX);
  // Bildschirm-Y waechst nach unten, XInput-Y nach oben.
  stick.y = Math.round(-dy * AXIS_MAX);
}

/** Rechnet die Neigung seit der Nullstellung in Stick-Achsen um, passend zur Bildschirmdrehung:
 *  rechte Kante runter = rechts, obere Kante zu sich kippen = hoch (wie Zielen mit dem Handy). */
export function tiltToStick(
  tilt: Tilt,
  reference: Tilt,
  screenAngle: number,
): { x: number; y: number } {
  const beta = wrapDegrees(tilt.beta - reference.beta);
  const gamma = wrapDegrees(tilt.gamma - reference.gamma);
  const angle = (screenAngle * Math.PI) / 180;
  const cos = Math.round(Math.cos(angle));
  const sin = Math.round(Math.sin(angle));

  return {
    x: tiltToAxis(gamma * cos + beta * sin),
    y: tiltToAxis(beta * cos - gamma * sin),
  };
}

function tiltToAxis(degrees: number): number {
  const magnitude = Math.abs(degrees) - GYRO_DEADZONE_DEG;
  if (magnitude <= 0) {
    return 0;
  }

  const scaled = Math.min(magnitude / (GYRO_FULL_TILT_DEG - GYRO_DEADZONE_DEG), 1);
  return Math.round(Math.sign(degrees) * scaled * AXIS_MAX);
}

function wrapDegrees(degrees: number): number {
  return ((((degrees + 180) % 360) + 360) % 360) - 180;
}

function sameState(a: GamepadState, b: GamepadState): boolean {
  return (Object.keys(a) as (keyof GamepadState)[]).every((key) => a[key] === b[key]);
}

// Nur auf Touch-Geraeten: dort fehlt sonst im Querformat der halbe Bildschirm an die
// Browserleiste. iOS kann beides nicht, Desktop-Browser sollen nicht ungefragt Vollbild werden -
// Fehler bleiben deshalb bewusst still.
async function enterLandscapeFullscreen(): Promise<void> {
  if (!globalThis.matchMedia?.('(pointer: coarse)').matches) {
    return;
  }

  try {
    await document.documentElement.requestFullscreen?.();
    const orientation = globalThis.screen?.orientation as
      { lock?: (orientation: string) => Promise<void> } | undefined;
    await orientation?.lock?.('landscape');
  } catch {
    // Kein Vollbild/keine Ausrichtungssperre moeglich - der Hinweis "quer halten" bleibt.
  }
}

function exitFullscreen(): void {
  if (globalThis.document?.fullscreenElement) {
    void document.exitFullscreen?.().catch(() => undefined);
  }
}
