import { InjectionToken } from '@angular/core';

/** "Gerät klingeln lassen" im Tray des PCs: spielt einen Suchton, bis `stop` kommt. */
export interface RingPlayer {
  start(): void;
  stop(): void;
  /** Meldet ein Stoppen ausserhalb der Seite ("Stopp" in der Benachrichtigung der App). */
  onStopped(callback: () => void): void;
}

/** `window.YFRemoteRing` der Android-App: Alarmton auch bei lautlosem Handy, mit Stopp in der
 *  Benachrichtigung. */
interface RingBridge {
  start(): void;
  stop(): void;
}

export const RING_PLAYER = new InjectionToken<RingPlayer>('RING_PLAYER', {
  providedIn: 'root',
  factory: () => {
    const bridge = (globalThis as { YFRemoteRing?: RingBridge }).YFRemoteRing;
    return bridge
      ? {
          start: () => bridge.start(),
          stop: () => bridge.stop(),
          onStopped: (callback) => globalThis.addEventListener('yfremote-ring-stop', callback),
        }
      : new BrowserRingPlayer();
  },
});

const BEEP_INTERVAL_MS = 1000;

// Ohne App nur, solange die Seite offen ist; das Stummschalten des Handys gilt hier mit.
export class BrowserRingPlayer implements RingPlayer {
  private context: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;

  // Der Ruf vom PC kommt ohne Nutzergeste, und iOS laesst einen AudioContext nur klingen, der in
  // einer Geste gestartet wurde. Deshalb beim ersten Tippen anlegen und bis zum Klingeln anhalten.
  private readonly unlock = (): void => {
    const context = this.createContext();
    void (this.timer === undefined ? context?.suspend() : context?.resume())?.catch(
      () => undefined,
    );
  };

  constructor() {
    globalThis.addEventListener?.('pointerdown', this.unlock, { capture: true, once: true });
  }

  start(): void {
    if (this.timer !== undefined) {
      return;
    }

    void this.createContext()?.resume().catch(() => undefined);
    this.beep();
    this.timer = setInterval(() => this.beep(), BEEP_INTERVAL_MS);
  }

  onStopped(): void {
    // Ohne App stoppt nur der Knopf auf der Seite.
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    // Nicht schliessen: ein neuer Kontext waere ohne Geste wieder stumm.
    void this.context?.suspend().catch(() => undefined);
    globalThis.navigator?.vibrate?.(0);
  }

  private createContext(): AudioContext | null {
    const Context = globalThis.AudioContext;
    if (this.context === null && typeof Context === 'function') {
      this.context = new Context();
    }
    return this.context;
  }

  private beep(): void {
    globalThis.navigator?.vibrate?.([300, 100, 300]);
    const context = this.context;
    if (!context) {
      return;
    }

    for (const [offset, frequency] of [
      [0, 1320],
      [0.2, 990],
    ]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + offset;
      oscillator.type = 'square';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.3, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.18);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.18);
    }
  }
}
