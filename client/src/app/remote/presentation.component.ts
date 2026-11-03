import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  Injectable,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { formatDuration } from './duration';
import { MediaBridgeService } from './media-bridge.service';
import { REMOTE_ICON_PATHS } from './remote-icons';
import { REMOTE_STORAGE, REMOTE_VIBRATE, RemoteService } from './remote.service';
import { TranslationService } from './translation.service';

export type TalkPhase = 'running' | 'warning' | 'over';

/** Waehlbare Zielzeiten in Minuten; 0 = ohne. */
export const TALK_TARGETS: readonly number[] = [0, 5, 10, 15, 20, 30, 45, 60];
export const TALK_TARGET_STORAGE_KEY = 'yfremote.presentationTarget';
// Warnen vor dem Ende: zwei Minuten, bei kurzen Vortraegen ein Fuenftel der Zeit.
const MAX_WARNING_SECONDS = 120;

/** Laufender Vortrag; ausserhalb der Komponente, damit ein Tabwechsel ihn nicht verliert und die
 *  Vibration bei Warnung und Ablauf auch kommt, waehrend ein anderer Tab offen ist. */
@Injectable({ providedIn: 'root' })
export class PresentationClock {
  private readonly storage = inject(REMOTE_STORAGE);
  private readonly vibrate = inject(REMOTE_VIBRATE);
  readonly startedAt = signal<number | null>(null);
  readonly targetMinutes = signal(this.readTarget());
  private readonly now = signal(Date.now());
  readonly elapsedSeconds = computed(() => {
    const startedAt = this.startedAt();
    return startedAt === null ? null : Math.max(0, Math.floor((this.now() - startedAt) / 1000));
  });
  readonly phase = computed<TalkPhase | null>(() => {
    const elapsed = this.elapsedSeconds();
    const target = this.targetMinutes() * 60;
    if (elapsed === null) {
      return null;
    }
    if (target === 0 || elapsed < target - Math.min(MAX_WARNING_SECONDS, target / 5)) {
      return 'running';
    }
    return elapsed < target ? 'warning' : 'over';
  });

  constructor() {
    // Tickt nur, solange ein Vortrag laeuft.
    effect((onCleanup) => {
      if (this.startedAt() === null) {
        return;
      }
      this.now.set(Date.now());
      const interval = setInterval(() => this.now.set(Date.now()), 1000);
      onCleanup(() => clearInterval(interval));
    });

    // Lautlos auf der Buehne: einmal kurz zur Warnung, lang beim Ablauf.
    let previous: TalkPhase | null = null;
    effect(() => {
      const phase = this.phase();
      if (previous !== null && phase !== previous) {
        if (phase === 'warning') {
          this.vibrate([200, 100, 200]);
        } else if (phase === 'over') {
          this.vibrate([600, 200, 600]);
        }
      }
      previous = phase;
    });
  }

  setTarget(minutes: number): void {
    if (!TALK_TARGETS.includes(minutes)) {
      return;
    }
    this.targetMinutes.set(minutes);
    try {
      this.storage?.setItem(TALK_TARGET_STORAGE_KEY, String(minutes));
    } catch {
      // Ohne Speicher gilt die Zielzeit nur bis zum Neuladen.
    }
  }

  private readTarget(): number {
    let stored: string | null = null;
    try {
      stored = this.storage?.getItem(TALK_TARGET_STORAGE_KEY) ?? null;
    } catch {
      return 0;
    }
    const minutes = Number(stored);
    return TALK_TARGETS.includes(minutes) ? minutes : 0;
  }
}

/** Folien steuern: Pfeiltasten verstehen PowerPoint, LibreOffice, Google Slides und PDF-Betrachter;
 *  Start, Schwarz und Laserpointer sind die PowerPoint-Kuerzel (LibreOffice kennt F5 und B auch). */
@Component({
  selector: 'app-presentation',
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './presentation.component.html',
})
export class PresentationComponent implements OnInit, OnDestroy {
  private readonly remote = inject(RemoteService);
  private readonly mediaBridge = inject(MediaBridgeService);
  protected readonly i18n = inject(TranslationService);
  protected readonly iconPaths = REMOTE_ICON_PATHS;
  protected readonly volumeKeysAvailable = this.mediaBridge.volumeKeysAvailable;
  protected readonly laser = signal(false);

  protected readonly clock = inject(PresentationClock);
  private readonly startedAt = this.clock.startedAt;
  protected readonly targets = TALK_TARGETS;
  protected readonly elapsed = computed(() => {
    const elapsed = this.clock.elapsedSeconds();
    if (elapsed === null) {
      return null;
    }
    const target = this.clock.targetMinutes();
    return target === 0
      ? formatDuration(elapsed)
      : `${formatDuration(elapsed)} / ${formatDuration(target * 60)}`;
  });

  private pointerId: number | null = null;
  private lastX = 0;
  private lastY = 0;
  private pendingX = 0;
  private pendingY = 0;
  private frame: number | null = null;

  ngOnInit(): void {
    this.mediaBridge.setVolumeKeyHandler((direction) => this.step(direction === 'up' ? 1 : -1));
  }

  ngOnDestroy(): void {
    this.mediaBridge.setVolumeKeyHandler(null);
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
    }
  }

  protected step(direction: 1 | -1): void {
    this.press(direction === 1 ? 'RIGHT' : 'LEFT');
  }

  /** Startet die Praesentation am PC und, falls noch keiner laeuft, den Timer. */
  protected start(...keys: string[]): void {
    this.press(...keys);
    if (this.startedAt() === null) {
      this.startedAt.set(Date.now());
    }
  }

  protected end(): void {
    this.press('ESC');
    this.startedAt.set(null);
  }

  protected restartTimer(): void {
    this.startedAt.set(Date.now());
  }

  protected onTargetChange(event: Event): void {
    this.clock.setTarget(Number((event.target as HTMLSelectElement).value));
  }

  protected press(...keys: string[]): void {
    this.remote.sendAction({ type: keys.length === 1 ? 'key' : 'hotkey', keys });
  }

  // Strg+L macht den Mauszeiger in PowerPoint zum Laserpointer, Strg+A wieder zum Pfeil.
  protected toggleLaser(): void {
    this.press('CTRL', this.laser() ? 'A' : 'L');
    this.laser.update((on) => !on);
  }

  protected onPointerDown(event: PointerEvent): void {
    if (this.pointerId !== null) {
      return;
    }
    this.pointerId = event.pointerId;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  protected onPointerMove(event: PointerEvent): void {
    if (event.pointerId !== this.pointerId) {
      return;
    }
    const scale = this.remote.mouseSensitivity();
    this.pendingX += (event.clientX - this.lastX) * scale;
    this.pendingY += (event.clientY - this.lastY) * scale;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    // Wie das Touchpad: hoechstens eine Bewegung pro Bild, sonst flutet es den Socket.
    this.frame ??= requestAnimationFrame(() => {
      this.frame = null;
      this.flush();
    });
  }

  protected onPointerUp(event: PointerEvent): void {
    if (event.pointerId === this.pointerId) {
      this.pointerId = null;
      this.flush();
    }
  }

  private flush(): void {
    const deltaX = Math.round(this.pendingX);
    const deltaY = Math.round(this.pendingY);
    if (deltaX === 0 && deltaY === 0) {
      return;
    }
    this.pendingX -= deltaX;
    this.pendingY -= deltaY;
    this.remote.sendAction({ type: 'mouseMove', deltaX, deltaY });
  }
}
