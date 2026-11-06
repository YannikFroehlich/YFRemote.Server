import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteService } from './remote.service';
import { SCREEN_AUDIO_CONTEXT_FACTORY } from './screen-audio';
import { SCREEN_VIDEO_PLAYER, ScreenVideoPlayer } from './screen-video';
import { ScreenViewComponent } from './screen-view.component';

describe('ScreenViewComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  async function setup(
    result: Blob | 'blocked' | null,
    audioResponse: Response | null = null,
    video: {
      player: ScreenVideoPlayer;
      stream: { body: ReadableStream<Uint8Array<ArrayBuffer>>; codec: string } | null;
    } | null = null,
  ) {
    const readScreen = vi.fn(async (_width: number, _quality: number) => result);
    const openScreenVideo = vi.fn(
      async (_width: number, _bitrate: number, _signal: AbortSignal) => video?.stream ?? null,
    );
    const sendAction = vi.fn();
    const openScreenAudio = vi.fn(async () => audioResponse);
    const screenQuality = signal<'performance' | 'balanced' | 'quality'>('balanced');
    const context = {
      currentTime: 0,
      destination: {},
      resume: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      createBuffer: vi.fn(),
      createBufferSource: vi.fn(),
    };
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:frame');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      imports: [ScreenViewComponent],
      providers: [
        {
          provide: RemoteService,
          useValue: {
            readScreen,
            openScreenVideo,
            sendAction,
            openScreenAudio,
            audioAvailable: signal(true),
            screenQuality,
            saveScreenQuality: (quality: 'performance' | 'balanced' | 'quality') =>
              screenQuality.set(quality),
          },
        },
        { provide: SCREEN_AUDIO_CONTEXT_FACTORY, useValue: () => context },
        { provide: SCREEN_VIDEO_PLAYER, useValue: video?.player ?? null },
      ],
    });
    const fixture = TestBed.createComponent(ScreenViewComponent);
    // jsdom rechnet kein Layout; die Komponente wartet auf eine Breite.
    Object.defineProperty(fixture.nativeElement, 'clientWidth', { value: 400 });
    await vi.waitFor(() => expect(video?.stream ? openScreenVideo : readScreen).toHaveBeenCalled());
    await fixture.whenStable();
    fixture.detectChanges();
    return {
      fixture,
      readScreen,
      openScreenVideo,
      screenQuality,
      sendAction,
      openScreenAudio,
      context,
      element: fixture.nativeElement as HTMLElement,
    };
  }

  it('shows the fetched frame and releases it when closed', async () => {
    const { fixture, element } = await setup(new Blob(['jpeg'], { type: 'image/jpeg' }));

    expect(element.querySelector('img')?.getAttribute('src')).toBe('blob:frame');
    fixture.destroy();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:frame');
  });

  it('clicks at the tapped spot, right on a long press', async () => {
    const { fixture, sendAction, element } = await setup(new Blob(['jpeg']));
    const image = element.querySelector('img')!;
    image.getBoundingClientRect = () => ({ left: 10, top: 20, width: 200, height: 100 }) as DOMRect;

    image.dispatchEvent(new MouseEvent('click', { clientX: 60, clientY: 120 }));
    image.dispatchEvent(
      new MouseEvent('contextmenu', { clientX: 500, clientY: 20, cancelable: true }),
    );

    expect(sendAction.mock.calls).toEqual([
      [{ type: 'screenClick', x: 0.25, y: 1, button: 'left' }],
      [{ type: 'screenClick', x: 1, y: 0, button: 'right' }],
    ]);
    fixture.destroy();
  });

  it('plays the H.264 stream instead of fetching JPEGs', async () => {
    const body = new ReadableStream<Uint8Array<ArrayBuffer>>();
    let signal: AbortSignal | null = null;
    const play = vi.fn(
      (
        _body: ReadableStream<Uint8Array<ArrayBuffer>>,
        _video: HTMLVideoElement,
        _codec: string,
        abort: AbortSignal,
        onFrame: () => void,
      ) => {
        signal = abort;
        onFrame();
        return new Promise<void>((resolve) => abort.addEventListener('abort', () => resolve()));
      },
    );
    const { fixture, readScreen, openScreenVideo, element } = await setup(null, null, {
      player: { play },
      stream: { body, codec: 'avc1.4d002a' },
    });
    await vi.waitFor(() => expect(play).toHaveBeenCalled());
    fixture.detectChanges();

    expect(play.mock.calls[0][0]).toBe(body);
    expect(play.mock.calls[0][2]).toBe('avc1.4d002a');
    expect(openScreenVideo.mock.calls[0][1]).toBe(8000);
    expect(element.querySelector('video')?.hidden).toBe(false);
    expect(element.textContent).not.toContain('geladen');
    expect(readScreen).not.toHaveBeenCalled();
    fixture.destroy();
    expect(signal!.aborted).toBe(true);
  });

  it('falls back to JPEG when the server sends no video', async () => {
    const play = vi.fn(async () => undefined);
    const { fixture, readScreen, openScreenVideo, element } = await setup(
      new Blob(['jpeg']),
      null,
      { player: { play }, stream: null },
    );

    expect(openScreenVideo).toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    expect(readScreen).toHaveBeenCalled();
    expect(element.querySelector('img')?.getAttribute('src')).toBe('blob:frame');
    fixture.destroy();
  });

  it('explains a blocked secure desktop', async () => {
    const { fixture, element } = await setup('blocked');

    expect(element.textContent).toContain('Sperrbildschirm');
    fixture.destroy();
  });

  it('asks for the JPEG quality of the chosen setting', async () => {
    const { fixture, readScreen, screenQuality, element } = await setup(new Blob(['jpeg']));
    const select = element.querySelector<HTMLSelectElement>('.screen-view__quality')!;

    select.value = 'performance';
    select.dispatchEvent(new Event('change'));

    expect(readScreen.mock.calls[0][1]).toBe(70);
    expect(screenQuality()).toBe('performance');
    await vi.waitFor(() => expect(readScreen.mock.calls.at(-1)?.[1]).toBe(50));
    fixture.destroy();
  });

  it('types live into the PC from the hidden keyboard field', async () => {
    const { fixture, sendAction, element } = await setup(new Blob(['jpeg']));
    const keyboard = Array.from(element.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Tastatur'),
    )!;

    keyboard.click();
    fixture.detectChanges();
    const input = element.querySelector<HTMLInputElement>('.screen-view__keyboard input')!;
    input.value = 'Hallo';
    input.dispatchEvent(new Event('input'));
    input.value = 'Hal';
    input.dispatchEvent(new Event('input'));
    input.form!.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(sendAction.mock.calls).toEqual([
      [{ type: 'text', text: 'Hallo' }],
      [{ type: 'key', keys: ['BACKSPACE'] }],
      [{ type: 'key', keys: ['BACKSPACE'] }],
      [{ type: 'key', keys: ['ENTER'] }],
    ]);
    expect(input.value).toBe('');
    expect(keyboard.getAttribute('aria-checked')).toBe('true');

    keyboard.click();
    fixture.detectChanges();
    expect(keyboard.getAttribute('aria-checked')).toBe('false');
    fixture.destroy();
  });

  it('switches the PC sound off again when the server has none', async () => {
    const { fixture, openScreenAudio, context, element } = await setup(new Blob(['jpeg']));
    const sound = Array.from(element.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Ton'),
    )!;

    sound.click();
    await vi.waitFor(() => expect(context.close).toHaveBeenCalled());
    fixture.detectChanges();

    expect(openScreenAudio).toHaveBeenCalled();
    expect(sound.getAttribute('aria-checked')).toBe('false');
    expect(element.textContent).toContain('nicht abspielen');
    fixture.destroy();
  });
});
