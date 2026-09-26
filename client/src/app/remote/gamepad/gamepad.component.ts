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
import { REMOTE_VIBRATE, RemoteService } from '../remote.service';
import { TranslationService } from '../translation.service';

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

type HeldControl =
  | { readonly kind: 'button'; readonly button: GamepadButton }
  | { readonly kind: 'trigger'; readonly side: Side }
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
// Ein 120-Hz-Display liefert 120 Frames pro Sekunde - genau das Nachrichtenlimit des Servers pro
// Verbindung. Mit diesem Abstand bleibt der Controller bei ~60 Nachrichten/s.
const MIN_SEND_INTERVAL_MS = 16;
const HAPTIC_PULSE_MS = 8;
// navigator.vibrate kennt nur an/aus und begrenzt die Dauer (Chrome: 10 s). Das Spiel meldet nur
// Aenderungen, deshalb bis zur naechsten Meldung durchvibrieren.
// ponytail: Staerke wird ignoriert und eine Vibration ueber 10 s endet vorzeitig - bei Bedarf per
// Muster (an/aus-Pulse) abstufen und vor Ablauf erneuern.
const RUMBLE_MAX_MS = 10000;

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
  },
})
export class GamepadComponent implements OnDestroy {
  private readonly remote = inject(RemoteService);
  private readonly vibrate = inject(REMOTE_VIBRATE);
  protected readonly i18n = inject(TranslationService);

  readonly closed = output<void>();

  protected readonly status = this.remote.status;
  protected readonly lastError = this.remote.lastError;
  protected readonly state = signal<GamepadState>(NEUTRAL_GAMEPAD);

  private readonly held = new Map<number, HeldControl>();
  private lastSent: GamepadState = NEUTRAL_GAMEPAD;
  private lastSentAt = -Infinity;
  private frameId: number | null = null;

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
    this.hold(event, { kind: 'trigger', side });
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

  protected onPointerMove(event: PointerEvent): void {
    const control = this.held.get(event.pointerId);
    if (control?.kind !== 'stick') {
      return;
    }

    moveStick(control, event);
    this.update();
  }

  protected release(event: PointerEvent): void {
    if (this.held.delete(event.pointerId)) {
      this.update();
    }
  }

  protected releaseAll(): void {
    if (this.held.size > 0) {
      this.held.clear();
      this.update();
    }
  }

  protected isPressed(button: GamepadButton): boolean {
    return (this.state().buttons & GAMEPAD_BUTTONS[button]) !== 0;
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
    let right = { x: 0, y: 0 };

    for (const control of this.held.values()) {
      switch (control.kind) {
        case 'button':
          buttons |= GAMEPAD_BUTTONS[control.button];
          break;
        // ponytail: Trigger sind digital (0 oder voll) - fuer Halbgas bräuchte es einen
        // Schieberegler statt einer Taste.
        case 'trigger':
          if (control.side === 'left') {
            leftTrigger = TRIGGER_MAX;
          } else {
            rightTrigger = TRIGGER_MAX;
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

function sameState(a: GamepadState, b: GamepadState): boolean {
  return (
    a.buttons === b.buttons &&
    a.leftX === b.leftX &&
    a.leftY === b.leftY &&
    a.rightX === b.rightX &&
    a.rightY === b.rightY &&
    a.leftTrigger === b.leftTrigger &&
    a.rightTrigger === b.rightTrigger
  );
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
      | { lock?: (orientation: string) => Promise<void> }
      | undefined;
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
