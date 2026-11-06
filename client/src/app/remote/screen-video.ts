import { InjectionToken } from '@angular/core';

/** Spielt den H.264-Strom von `GET /screen/video` in `video` ab, bis er endet oder `signal`
 *  abbricht; `onFrame` meldet jedes angekommene Bild. In Tests durch eine Attrappe ersetzt. */
export interface ScreenVideoPlayer {
  play(
    body: ReadableStream<Uint8Array<ArrayBuffer>>,
    video: HTMLVideoElement,
    codec: string,
    signal: AbortSignal,
    onFrame: () => void,
  ): Promise<void>;
}

/** `null` ohne MediaSource (iPhone-Safari, alte Browser) - dann bleibt es bei JPEG. */
export const SCREEN_VIDEO_PLAYER = new InjectionToken<ScreenVideoPlayer | null>(
  'SCREEN_VIDEO_PLAYER',
  {
    providedIn: 'root',
    factory: () =>
      typeof globalThis.MediaSource === 'function' &&
      globalThis.MediaSource.isTypeSupported('video/mp4; codecs="avc1.4d0028"')
        ? { play: playFmp4Stream }
        : null,
  },
);

// Der Server zaehlt jedes Bild als 1/60 s Videozeit, egal wie selten es kommt. Kommen Bilder
// langsamer, wartet das Video am Pufferende und zeigt jedes sofort; liegt mehr vor (WLAN-Stau),
// holt es mit doppelter Geschwindigkeit auf und springt bei grossem Rueckstand ans Ende.
const CATCH_UP_SECONDS = 0.1;
const JUMP_SECONDS = 1;
// Alten Puffer verwerfen, sonst laeuft der Speicher des Browsers voll. Der Server setzt alle
// 2 s Videozeit ein Schluesselbild, bis dahin darf der Browser loeschen.
const KEEP_SECONDS = 10;
const TRIM_SECONDS = 30;

async function playFmp4Stream(
  body: ReadableStream<Uint8Array<ArrayBuffer>>,
  video: HTMLVideoElement,
  codec: string,
  signal: AbortSignal,
  onFrame: () => void,
): Promise<void> {
  const source = new MediaSource();
  const url = URL.createObjectURL(source);
  const reader = body.getReader();
  const cancel = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener('abort', cancel);
  video.src = url;
  try {
    await new Promise((resolve) => source.addEventListener('sourceopen', resolve, { once: true }));
    const buffer = source.addSourceBuffer(`video/mp4; codecs="${codec}"`);
    let started = false;
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done || signal.aborted) {
        return;
      }

      await append(buffer, () => buffer.appendBuffer(value));
      if (buffer.buffered.length === 0) {
        continue;
      }

      const start = buffer.buffered.start(0);
      const end = buffer.buffered.end(buffer.buffered.length - 1);
      if (!started) {
        started = true;
        video.currentTime = start;
      }

      onFrame();
      // Auch negativ: ohne Darstellung (verdecktes Fenster) laeuft die Uhr dem Puffer davon.
      const lag = end - video.currentTime;
      if (Math.abs(lag) > JUMP_SECONDS) {
        video.currentTime = end - 0.02;
      }
      video.playbackRate = lag > CATCH_UP_SECONDS ? 2 : 1;
      if (video.paused) {
        void video.play().catch(() => undefined);
      }

      if (video.currentTime - start > TRIM_SECONDS) {
        await append(buffer, () => buffer.remove(start, video.currentTime - KEEP_SECONDS));
      }
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
    // Das letzte Bild bleibt stehen, bis der naechste Strom da ist: beim Neuverbinden wuerde das
    // Video sonst leer und schrumpft auf 150 px Hoehe.
    URL.revokeObjectURL(url);
  }
}

function append(buffer: SourceBuffer, action: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      buffer.removeEventListener('updateend', done);
      buffer.removeEventListener('error', failed);
      resolve();
    };
    const failed = () => {
      buffer.removeEventListener('updateend', done);
      buffer.removeEventListener('error', failed);
      reject(new Error('SourceBuffer error'));
    };
    buffer.addEventListener('updateend', done);
    buffer.addEventListener('error', failed);
    action();
  });
}
