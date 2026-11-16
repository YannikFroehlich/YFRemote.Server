import { InjectionToken } from '@angular/core';

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
