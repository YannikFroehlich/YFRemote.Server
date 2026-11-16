import { BrowserRingPlayer } from './ring-player';

class FakeAudioContext {
  static created: FakeAudioContext[] = [];
  readonly calls: string[] = [];
  readonly currentTime = 0;
  readonly destination = {};

  constructor() {
    FakeAudioContext.created.push(this);
  }

  async resume(): Promise<void> {
    this.calls.push('resume');
  }

  async suspend(): Promise<void> {
    this.calls.push('suspend');
  }

  async close(): Promise<void> {
    this.calls.push('close');
  }

  createOscillator() {
    return {
      type: '',
      frequency: { value: 0 },
      connect: (node: unknown) => node,
      start: () => undefined,
      stop: () => undefined,
    };
  }

  createGain() {
    return {
      gain: { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined },
      connect: (node: unknown) => node,
    };
  }
}

describe('BrowserRingPlayer', () => {
  beforeEach(() => {
    FakeAudioContext.created = [];
    vi.stubGlobal('AudioContext', FakeAudioContext);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('creates the audio context on the first tap, keeps it suspended and reuses it for ringing', () => {
    const player = new BrowserRingPlayer();
    globalThis.dispatchEvent(new Event('pointerdown'));

    expect(FakeAudioContext.created.length).toBe(1);
    const context = FakeAudioContext.created[0];
    expect(context.calls).toEqual(['suspend']);

    player.start();
    player.stop();

    expect(FakeAudioContext.created.length).toBe(1);
    expect(context.calls).toEqual(['suspend', 'resume', 'suspend']);
  });

  it('still rings without an earlier tap', () => {
    const player = new BrowserRingPlayer();

    player.start();

    expect(FakeAudioContext.created[0].calls).toEqual(['resume']);
    player.stop();
  });
});
