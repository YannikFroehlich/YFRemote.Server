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
}

export const MEDIA_BRIDGE = new InjectionToken<MediaBridge | null>('MEDIA_BRIDGE', {
  providedIn: 'root',
  factory: () => (globalThis as { YFRemoteMedia?: MediaBridge }).YFRemoteMedia ?? null,
});

const MEDIA_KEYS = new Set(['MEDIA_PLAY_PAUSE', 'MEDIA_NEXT', 'MEDIA_PREVIOUS']);

/** Tasten der Benachrichtigung kommen als 'yfremote-media'-Ereignis zurueck. */
type MediaBridgeEvent =
  | { readonly type: 'key'; readonly key: string }
  | { readonly type: 'seek'; readonly position: number };

@Injectable({
  providedIn: 'root',
})
export class MediaBridgeService {
  private readonly remote = inject(RemoteService);
  private readonly bridge = inject(MEDIA_BRIDGE);

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

    const view = inject(DOCUMENT).defaultView;
    const onEvent = (event: Event) => this.onBridgeEvent((event as CustomEvent).detail);
    view?.addEventListener('yfremote-media', onEvent);
    inject(DestroyRef).onDestroy(() => {
      view?.removeEventListener('yfremote-media', onEvent);
      bridge.clear();
    });
  }

  private onBridgeEvent(detail: MediaBridgeEvent | undefined): void {
    if (detail?.type === 'key' && MEDIA_KEYS.has(detail.key)) {
      this.remote.sendAction({ type: 'key', keys: [detail.key] });
    } else if (detail?.type === 'seek' && Number.isFinite(detail.position)) {
      this.remote.sendAction({ type: 'mediaSeek', position: Math.max(0, Math.round(detail.position)) });
    }
  }
}
