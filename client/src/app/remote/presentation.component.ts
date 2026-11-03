import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { MediaBridgeService } from './media-bridge.service';
import { REMOTE_ICON_PATHS } from './remote-icons';
import { RemoteService } from './remote.service';
import { TranslationService } from './translation.service';

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
