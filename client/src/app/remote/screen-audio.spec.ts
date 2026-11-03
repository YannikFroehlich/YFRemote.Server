import { describe, expect, it, vi } from 'vitest';
import { playPcmStream, ScreenAudioContext } from './screen-audio';

describe('playPcmStream', () => {
  it('schedules gapless stereo chunks and joins a sample split across chunks', async () => {
    const buffers: Float32Array[][] = [];
    const starts: number[] = [];
    const context = {
      currentTime: 1,
      destination: {},
      createBuffer: vi.fn((channels: number, frames: number) => {
        const data = Array.from({ length: channels }, () => new Float32Array(frames));
        buffers.push(data);
        return { getChannelData: (channel: number) => data[channel] };
      }),
      createBufferSource: vi.fn(() => ({
        connect: vi.fn(),
        start: (when: number) => starts.push(when),
        buffer: null,
      })),
    } as unknown as ScreenAudioContext;
    // Zwei Frames Stereo: links 16384 / -32768, rechts 0 / 32767 - das letzte Byte kommt einzeln.
    const bytes = [0x00, 0x40, 0x00, 0x00, 0x00, 0x80, 0xff, 0x7f];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(bytes.slice(0, 4)));
        controller.enqueue(new Uint8Array(bytes.slice(4, 7)));
        controller.enqueue(new Uint8Array(bytes.slice(7)));
        controller.close();
      },
    });

    await playPcmStream(stream, context, 4, 2);

    expect(starts).toEqual([1.15, 1.4]);
    expect(buffers.map((data) => data.map((channel) => channel[0]))).toEqual([
      [0.5, 0],
      [-1, 32767 / 32768],
    ]);
  });
});
