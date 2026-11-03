import { InjectionToken } from '@angular/core';

/** Der Teil von AudioContext, den der PC-Ton braucht - in Tests durch eine Attrappe ersetzt. */
export type ScreenAudioContext = Pick<
  AudioContext,
  'currentTime' | 'destination' | 'createBuffer' | 'createBufferSource' | 'resume' | 'close'
>;

/** `null` ohne Web Audio. Muss im Klick-Handler laufen, sonst bleibt der Kontext stumm. */
export const SCREEN_AUDIO_CONTEXT_FACTORY = new InjectionToken<() => ScreenAudioContext | null>(
  'SCREEN_AUDIO_CONTEXT_FACTORY',
  {
    providedIn: 'root',
    factory: () => () =>
      typeof globalThis.AudioContext === 'function' ? new globalThis.AudioContext() : null,
  },
);

// Vorlauf gegen WLAN-Ruckler; liegt mehr als MAX_AHEAD_SECONDS in der Warteschlange (etwa nach
// einer Pause im Hintergrund), wird verworfen statt immer weiter hinterherzulaufen.
const LEAD_SECONDS = 0.15;
const MAX_AHEAD_SECONDS = 0.6;

/** Spielt rohes 16-Bit-PCM (little-endian, Kanaele verschraenkt) ab, bis der Strom endet. Ohne
 *  AudioWorklet, das es nur ueber HTTPS gibt: jedes Stueck wird ein eigener, lueckenlos
 *  angeschlossener AudioBufferSourceNode. */
export async function playPcmStream(
  stream: ReadableStream<Uint8Array>,
  context: ScreenAudioContext,
  sampleRate: number,
  channels: number,
): Promise<void> {
  const reader = stream.getReader();
  const frameBytes = 2 * channels;
  let rest = new Uint8Array(0);
  let next = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      return;
    }

    // Ein Stueck kann mitten in einem Sample enden; der Rest kommt vor das naechste.
    const bytes = new Uint8Array(rest.length + value.length);
    bytes.set(rest);
    bytes.set(value, rest.length);
    const frames = Math.floor(bytes.length / frameBytes);
    rest = bytes.slice(frames * frameBytes);
    if (frames === 0) {
      continue;
    }

    const now = context.currentTime;
    if (next < now) {
      next = now + LEAD_SECONDS;
    }
    if (next - now > MAX_AHEAD_SECONDS) {
      continue;
    }

    const buffer = context.createBuffer(channels, frames, sampleRate);
    const view = new DataView(bytes.buffer, 0, frames * frameBytes);
    for (let channel = 0; channel < channels; channel++) {
      const data = buffer.getChannelData(channel);
      for (let frame = 0; frame < frames; frame++) {
        data[frame] = view.getInt16((frame * channels + channel) * 2, true) / 32768;
      }
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start(next);
    next += frames / sampleRate;
  }
}
