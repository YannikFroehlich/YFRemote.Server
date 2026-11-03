import { DOCUMENT } from '@angular/common';
import { DestroyRef, effect, inject, Injectable, InjectionToken } from '@angular/core';
import { RemoteService } from './remote.service';

/** Haengt die Android-App (remote/RemoteWebActivity.kt) als window.YFRemoteMedia ein: Sie zeigt die
 *  Wiedergabe des gesteuerten Geraets als Media-Benachrichtigung, auch auf dem Sperrbildschirm. */
export interface MediaBridge {
  update(json: string): void;
  /** Data-URL des Covers, leer ohne. */
  cover(dataUrl: string): void;
  clear(): void;
  /** Lautstaerketasten des Handys abfangen; fehlt in aelteren App-Versionen. */
  captureVolumeKeys?(enabled: boolean): void;
}

export const MEDIA_BRIDGE = new InjectionToken<MediaBridge | null>('MEDIA_BRIDGE', {
  providedIn: 'root',
  factory: () => (globalThis as { YFRemoteMedia?: MediaBridge }).YFRemoteMedia ?? null,
});

const MEDIA_KEYS = new Set(['MEDIA_PLAY_PAUSE', 'MEDIA_NEXT', 'MEDIA_PREVIOUS']);

export type VolumeKeyDirection = 'up' | 'down';

/** Tasten der Benachrichtigung und Lautstaerketasten kommen als 'yfremote-media'-Ereignis zurueck. */
type MediaBridgeEvent =
  | { readonly type: 'key'; readonly key: string }
  | { readonly type: 'seek'; readonly position: number }
  | { readonly type: 'volume'; readonly direction: VolumeKeyDirection };

@Injectable({
  providedIn: 'root',
})
export class MediaBridgeService {
  private readonly remote = inject(RemoteService);
  private readonly bridge = inject(MEDIA_BRIDGE);

  /** Die Lautstaerketasten koennen nur in der Android-App etwas am PC ausloesen. */
  readonly volumeKeysAvailable = this.bridge?.captureVolumeKeys !== undefined;
  // Der Praesentationsmodus blaettert damit, sonst steuern sie die Lautstaerke.
  private volumeKeyHandler: ((direction: VolumeKeyDirection) => void) | null = null;

  constructor() {
    const bridge = this.bridge;
    if (bridge === null) {
      return;
    }

    effect(() => {
      const status = this.remote.mediaStatus();
      if (status?.title === undefined) {
        bridge.clear();
        return;
      }

      const { title, artist, playing, position, duration, canSeek } = status;
      bridge.update(JSON.stringify({ title, artist, playing, position, duration, canSeek }));
    });
    effect(() => bridge.cover(this.remote.mediaCover() ?? ''));
    // Ohne Verbindung bleiben die Tasten beim Handy.
    effect(() => bridge.captureVolumeKeys?.(this.remote.status() === 'connected'));

    const view = inject(DOCUMENT).defaultView;
    const onEvent = (event: Event) => this.onBridgeEvent((event as CustomEvent).detail);
    view?.addEventListener('yfremote-media', onEvent);
    inject(DestroyRef).onDestroy(() => {
      view?.removeEventListener('yfremote-media', onEvent);
      bridge.captureVolumeKeys?.(false);
      bridge.clear();
    });
  }

  setVolumeKeyHandler(handler: ((direction: VolumeKeyDirection) => void) | null): void {
    this.volumeKeyHandler = handler;
  }

  private onBridgeEvent(detail: MediaBridgeEvent | undefined): void {
    if (detail?.type === 'key' && MEDIA_KEYS.has(detail.key)) {
      this.remote.sendAction({ type: 'key', keys: [detail.key] });
    } else if (detail?.type === 'seek' && Number.isFinite(detail.position)) {
      this.remote.sendAction({ type: 'mediaSeek', position: Math.max(0, Math.round(detail.position)) });
    } else if (detail?.type === 'volume' && (detail.direction === 'up' || detail.direction === 'down')) {
      if (this.volumeKeyHandler !== null) {
        this.volumeKeyHandler(detail.direction);
      } else {
        this.remote.sendAction({
          type: 'key',
          keys: [detail.direction === 'up' ? 'VOLUME_UP' : 'VOLUME_DOWN'],
        });
      }
    }
  }
}
