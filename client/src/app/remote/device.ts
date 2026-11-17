import { DOCUMENT } from '@angular/common';
import { DestroyRef, inject, InjectionToken } from '@angular/core';

/** Wie die Tokens in remote.service.ts: Browser-API austauschbar, damit Tests nicht neu laden. */
export const PAGE_RELOAD = new InjectionToken<() => void>('PAGE_RELOAD', {
  providedIn: 'root',
  factory: () => () => globalThis.location.reload(),
});

const EDGE_SWIPE_PX = 24;
// Nur Flaechen, die per Pointer Events ziehen. Die Bildschirm-Ansicht nicht: sie klickt ueber das
// click-Ereignis, das ein abgefangenes touchstart am Rand mit unterdruecken wuerde.
const EDGE_SWIPE_TARGETS = '.touchpad-surface, .gamepad';

/** Safari im Tab deutet ein Wischen vom linken oder rechten Rand als Zurueck/Vor, auch mitten auf
 *  dem Touchpad; touch-action hilft dagegen nicht. Ein abgefangenes touchstart nahe am Rand schon. */
export function preventEdgeSwipe(document: Document): () => void {
  const listener = (event: TouchEvent): void => {
    const width = document.defaultView?.innerWidth ?? 0;
    const nearEdge = Array.from(event.changedTouches).some(
      (touch) => touch.clientX < EDGE_SWIPE_PX || touch.clientX > width - EDGE_SWIPE_PX,
    );
    if (nearEdge && event.target instanceof Element && event.target.closest(EDGE_SWIPE_TARGETS)) {
      event.preventDefault();
    }
  };

  document.addEventListener('touchstart', listener, { passive: false });
  return () => document.removeEventListener('touchstart', listener);
}

export interface ScreenWakeLock {
  release(): Promise<void>;
}

/** Screen Wake Lock API; `null` ohne Unterstuetzung (aeltere Safari-Versionen, die Android-WebView). */
export const SCREEN_WAKE_LOCK = new InjectionToken<(() => Promise<ScreenWakeLock>) | null>(
  'SCREEN_WAKE_LOCK',
  {
    providedIn: 'root',
    factory: () => {
      const wakeLock = (
        globalThis.navigator as
          | { wakeLock?: { request(type: 'screen'): Promise<ScreenWakeLock> } }
          | undefined
      )?.wakeLock;
      return wakeLock ? () => wakeLock.request('screen') : null;
    },
  },
);

/** Haelt den Bildschirm wach, solange die aufrufende Komponente lebt - als Feld-Initialisierer
 *  aufrufen. Ohne Beruehrung sperrt sich das Handy sonst nach der Auto-Sperrzeit, mitten im Vortrag
 *  oder beim Zuschauen, und die Verbindung bricht ab. Der Browser gibt die Sperre selbst frei, sobald
 *  die Seite verborgen ist; sie wird beim Zurueckkommen neu geholt. Lehnt der Browser ohne
 *  Nutzeraktion ab, klappt es beim naechsten Tippen. */
export function keepScreenAwake(): void {
  const request = inject(SCREEN_WAKE_LOCK);
  const document = inject(DOCUMENT);
  if (!request) {
    return;
  }

  let lock: ScreenWakeLock | null = null;
  let pending = false;
  let destroyed = false;
  const acquire = (): void => {
    if (destroyed || lock || pending || document.visibilityState !== 'visible') {
      return;
    }
    pending = true;
    request().then(
      (sentinel) => {
        pending = false;
        if (destroyed) {
          void sentinel.release().catch(() => undefined);
        } else {
          lock = sentinel;
        }
      },
      () => {
        pending = false;
      },
    );
  };
  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') {
      acquire();
    } else {
      lock = null;
    }
  };

  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('pointerdown', acquire);
  acquire();
  inject(DestroyRef).onDestroy(() => {
    destroyed = true;
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('pointerdown', acquire);
    void lock?.release().catch(() => undefined);
    lock = null;
  });
}

/** iPhone oder iPad. iPadOS gibt sich als Mac aus, verraet sich aber durch Touch-Punkte. */
export const IS_IOS = new InjectionToken<boolean>('IS_IOS', {
  providedIn: 'root',
  factory: () => {
    const navigator = globalThis.navigator;
    const userAgent = navigator?.userAgent ?? '';
    return (
      /iPhone|iPad|iPod/.test(userAgent) ||
      (/Macintosh/.test(userAgent) && (navigator?.maxTouchPoints ?? 0) > 1)
    );
  },
});

/** Vom Home-Bildschirm gestartet statt im Browser-Tab. */
export const IS_STANDALONE = new InjectionToken<boolean>('IS_STANDALONE', {
  providedIn: 'root',
  factory: () =>
    (globalThis.navigator as { standalone?: boolean } | undefined)?.standalone === true ||
    globalThis.matchMedia?.('(display-mode: standalone)').matches === true,
});

/** Haelt `--keyboard-inset` auf `body` aktuell: wie weit die Bildschirmtastatur den unteren Rand
 *  verdeckt. Safari verkleinert dafuer weder `dvh` noch das Layout (es ignoriert
 *  `interactive-widget`), nur den sichtbaren Ausschnitt; ohne Ausgleich liegen untere Felder und
 *  Knoepfe hinter der Tastatur. Wo der Browser das Layout selbst verkleinert, bleibt der Wert 0.
 *  Auf `body`, weil ThemeService die Inline-Styles von `<html>` komplett ersetzt. */
export function watchKeyboardInset(window: Window): () => void {
  const viewport = window.visualViewport;
  const body = window.document.body;
  if (!viewport || !body) {
    return () => undefined;
  }

  const update = (): void => {
    const covered = window.innerHeight - viewport.height - viewport.offsetTop;
    body.style.setProperty('--keyboard-inset', `${Math.max(0, Math.round(covered))}px`);
  };

  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
  update();
  return () => {
    viewport.removeEventListener('resize', update);
    viewport.removeEventListener('scroll', update);
  };
}
