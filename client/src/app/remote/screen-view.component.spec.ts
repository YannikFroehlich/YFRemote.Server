import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScreenMonitor } from './remote.models';
import { RemoteService } from './remote.service';
import { SCREEN_AUDIO_CONTEXT_FACTORY } from './screen-audio';
import { SCREEN_VIDEO_PLAYER, ScreenVideoPlayer } from './screen-video';
import { ScreenViewComponent } from './screen-view.component';

describe('ScreenViewComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function setup(
    result: Blob | 'blocked' | null,
    audioResponse: Response | null = null,
    video: {
      player: ScreenVideoPlayer;
      stream: { body: ReadableStream<Uint8Array<ArrayBuffer>>; codec: string } | 'blocked' | null;
    } | null = null,
    monitors: readonly ScreenMonitor[] | null = null,
  ) {
    const screenMonitor = signal<string | null>(null);
    const readScreen = vi.fn(
      async (_width: number, _quality: number, _monitor?: string | null) => result,
    );
    const openScreenVideo = vi.fn(
      async (_width: number, _bitrate: number, _signal: AbortSignal, _monitor?: string | null) =>
        video?.stream ?? null,
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
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      imports: [ScreenViewComponent],
      providers: [
        {
          provide: RemoteService,
          useValue: {
            readScreen,
            readScreenMonitors: async () => monitors,
            screenMonitor,
            saveScreenMonitor: (monitor: string) => screenMonitor.set(monitor),
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

    image.dispatchEvent(new MouseEvent('click', { clientX: 60, clientY: 120, bubbles: true }));
    image.dispatchEvent(
      new MouseEvent('contextmenu', { clientX: 500, clientY: 20, cancelable: true, bubbles: true }),
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

  const twoMonitors: readonly ScreenMonitor[] = [
    { id: 'left', width: 1920, height: 1080, primary: false },
    { id: 'main', width: 2560, height: 1440, primary: true },
  ];

  it('offers no monitor choice with a single monitor', async () => {
    const { fixture, element } = await setup(new Blob(['jpeg']), null, null, [twoMonitors[1]]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(element.querySelectorAll('select')).toHaveLength(1);
    fixture.destroy();
  });

  it('captures and clicks on the chosen monitor, starting on the primary one', async () => {
    const { fixture, readScreen, sendAction, element } = await setup(
      new Blob(['jpeg']),
      null,
      null,
      twoMonitors,
    );
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(element.querySelectorAll('select')).toHaveLength(2);
    });
    const select = element.querySelectorAll('select')[1];
    expect(select.value).toBe('main');
    expect(select.options[0].textContent).toContain('Monitor 1 (1920×1080)');
    expect(select.options[1].textContent).toContain('Hauptmonitor (2560×1440)');

    select.value = 'left';
    select.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(readScreen.mock.calls.at(-1)?.[2]).toBe('left'));
    fixture.detectChanges();

    const image = element.querySelector('img')!;
    image.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect;
    image.dispatchEvent(new MouseEvent('click', { clientX: 50, clientY: 50, bubbles: true }));
    expect(sendAction).toHaveBeenCalledWith({
      type: 'screenClick',
      x: 0.5,
      y: 0.5,
      button: 'left',
      monitor: 'left',
    });
    fixture.destroy();
  });

  it('restarts the video stream on the chosen monitor', async () => {
    const play = vi.fn(
      (
        _body: ReadableStream<Uint8Array<ArrayBuffer>>,
        _video: HTMLVideoElement,
        _codec: string,
        abort: AbortSignal,
        onFrame: () => void,
      ) => {
        onFrame();
        return new Promise<void>((resolve) => abort.addEventListener('abort', () => resolve()));
      },
    );
    const { fixture, openScreenVideo, element } = await setup(
      null,
      null,
      { player: { play }, stream: { body: new ReadableStream(), codec: 'avc1.4d002a' } },
      twoMonitors,
    );
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(element.querySelectorAll('select')).toHaveLength(2);
    });
    await vi.waitFor(() => expect(play).toHaveBeenCalled());
    const select = element.querySelectorAll('select')[1];

    select.value = 'left';
    select.dispatchEvent(new Event('change'));

    await vi.waitFor(() => expect(openScreenVideo.mock.calls.at(-1)?.[3]).toBe('left'));
    fixture.destroy();
  });

  function pointer(
    target: Element,
    type: string,
    pointerId: number,
    clientX: number,
    clientY: number,
  ): void {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      pointerId: { value: pointerId },
      clientX: { value: clientX },
      clientY: { value: clientY },
      pointerType: { value: 'touch' },
      button: { value: 0 },
    });
    target.dispatchEvent(event);
  }

  async function setupGestures() {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const result = await setup(new Blob(['jpeg']));
    const stage = result.element.querySelector<HTMLElement>('.screen-view__stage')!;
    const image = result.element.querySelector('img')!;
    Object.defineProperty(stage, 'clientWidth', { value: 400 });
    Object.defineProperty(stage, 'clientHeight', { value: 200 });
    const box = { left: 0, top: 0, width: 400, height: 200 } as DOMRect;
    stage.getBoundingClientRect = () => box;
    image.getBoundingClientRect = () => box;
    return { ...result, stage, image };
  }

  it('drags on the PC with one finger', async () => {
    const { fixture, sendAction, stage } = await setupGestures();

    pointer(stage, 'pointerdown', 1, 100, 100);
    pointer(stage, 'pointermove', 1, 103, 100);
    expect(sendAction).not.toHaveBeenCalled();
    pointer(stage, 'pointermove', 1, 200, 100);
    pointer(stage, 'pointerup', 1, 200, 100);
    stage.dispatchEvent(new MouseEvent('click', { clientX: 200, clientY: 100, bubbles: true }));

    expect(sendAction.mock.calls).toEqual([
      [{ type: 'screenMove', x: 0.25, y: 0.5 }],
      [{ type: 'mouseDown', button: 'left' }],
      [{ type: 'screenMove', x: 0.5, y: 0.5 }],
      [{ type: 'mouseUp', button: 'left' }],
    ]);
    fixture.destroy();
  });

  it('keeps the pointer inside the picture when dragging past its edge', async () => {
    const { fixture, sendAction, stage } = await setupGestures();

    pointer(stage, 'pointerdown', 1, 100, 100);
    pointer(stage, 'pointermove', 1, 900, -50);
    pointer(stage, 'pointerup', 1, 900, -50);

    expect(sendAction.mock.calls[2]).toEqual([{ type: 'screenMove', x: 1, y: 0 }]);
    fixture.destroy();
  });

  it('releases the mouse button when the page goes to the background mid-drag', async () => {
    const { fixture, sendAction, stage } = await setupGestures();
    pointer(stage, 'pointerdown', 1, 100, 100);
    pointer(stage, 'pointermove', 1, 200, 100);

    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));

    expect(sendAction.mock.calls.at(-1)).toEqual([{ type: 'mouseUp', button: 'left' }]);
    fixture.destroy();
  });

  it('zooms with two fingers without touching the PC', async () => {
    const { fixture, sendAction, stage, image } = await setupGestures();

    pointer(stage, 'pointerdown', 1, 90, 100);
    pointer(stage, 'pointerdown', 2, 110, 100);
    pointer(stage, 'pointermove', 1, 80, 100);
    pointer(stage, 'pointermove', 2, 120, 100);
    fixture.detectChanges();
    expect(image.style.transform).toBe('translate(-100px, -100px) scale(2)');

    pointer(stage, 'pointerup', 1, 80, 100);
    pointer(stage, 'pointermove', 2, 300, 100);
    pointer(stage, 'pointerup', 2, 300, 100);
    stage.dispatchEvent(new MouseEvent('click', { clientX: 300, clientY: 100, bubbles: true }));

    expect(sendAction).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('scrolls the page with two fingers while not zoomed', async () => {
    const { fixture, sendAction, stage, image } = await setupGestures();
    const scroller = stage.parentElement!;
    scroller.style.overflowY = 'auto';
    Object.defineProperty(scroller, 'scrollHeight', { value: 1000 });
    Object.defineProperty(scroller, 'clientHeight', { value: 300 });
    scroller.scrollTop = 100;

    pointer(stage, 'pointerdown', 1, 100, 150);
    pointer(stage, 'pointerdown', 2, 200, 150);
    pointer(stage, 'pointermove', 1, 100, 130);
    pointer(stage, 'pointermove', 2, 200, 130);
    pointer(stage, 'pointerup', 1, 100, 130);
    pointer(stage, 'pointerup', 2, 200, 130);
    fixture.detectChanges();

    expect(scroller.scrollTop).toBe(120);
    expect(image.style.transform).toBe('');
    expect(sendAction).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('does not scroll the page while zoomed', async () => {
    const { fixture, stage } = await setupGestures();
    const scroller = stage.parentElement!;
    scroller.style.overflowY = 'auto';
    Object.defineProperty(scroller, 'scrollHeight', { value: 1000 });
    Object.defineProperty(scroller, 'clientHeight', { value: 300 });

    pointer(stage, 'pointerdown', 1, 90, 100);
    pointer(stage, 'pointerdown', 2, 110, 100);
    pointer(stage, 'pointermove', 1, 50, 80);
    pointer(stage, 'pointermove', 2, 150, 80);

    expect(scroller.scrollTop).toBe(0);
    fixture.destroy();
  });

  it('clicks at the zoomed spot', async () => {
    const { fixture, sendAction, stage, image } = await setupGestures();
    // Der Browser rechnet den Zoom in den Rahmen ein: doppelt so gross, nach links oben verschoben.
    image.getBoundingClientRect = () =>
      ({ left: -100, top: -100, width: 800, height: 400 }) as DOMRect;

    stage.dispatchEvent(new MouseEvent('click', { clientX: 100, clientY: 100, bubbles: true }));

    expect(sendAction.mock.calls).toEqual([
      [{ type: 'screenClick', x: 0.25, y: 0.5, button: 'left' }],
    ]);
    fixture.destroy();
  });

  it('does not start a drag after a long press opened the right click', async () => {
    const { fixture, sendAction, stage } = await setupGestures();

    pointer(stage, 'pointerdown', 1, 100, 100);
    stage.dispatchEvent(
      new MouseEvent('contextmenu', {
        clientX: 100,
        clientY: 100,
        cancelable: true,
        bubbles: true,
      }),
    );
    pointer(stage, 'pointermove', 1, 200, 100);
    pointer(stage, 'pointerup', 1, 200, 100);

    expect(sendAction.mock.calls).toEqual([
      [{ type: 'screenClick', x: 0.25, y: 0.5, button: 'right' }],
    ]);
    fixture.destroy();
  });

  it('shows the hint and resumes the video when the screen becomes available', async () => {
    const play = vi.fn(
      (
        _body: ReadableStream<Uint8Array<ArrayBuffer>>,
        _video: HTMLVideoElement,
        _codec: string,
        abort: AbortSignal,
        onFrame: () => void,
      ) => {
        onFrame();
        return new Promise<void>((resolve) => abort.addEventListener('abort', () => resolve()));
      },
    );
    const { fixture, readScreen, openScreenVideo, element } = await setup(
      new Blob(['jpeg']),
      null,
      { player: { play }, stream: 'blocked' },
    );
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(element.textContent).toContain('Sperrbildschirm');
    });
    expect(readScreen).not.toHaveBeenCalled();
    openScreenVideo.mockResolvedValue({
      body: new ReadableStream(),
      codec: 'avc1.4d002a',
    } as never);

    await vi.waitFor(() => expect(play).toHaveBeenCalled(), { timeout: 3000 });
    fixture.detectChanges();

    expect(element.textContent).not.toContain('Sperrbildschirm');
    expect(readScreen).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('flags a hanging video stream and reconnects', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    try {
      let frame: () => void = () => undefined;
      const play = vi.fn(
        (
          _body: ReadableStream<Uint8Array<ArrayBuffer>>,
          _video: HTMLVideoElement,
          _codec: string,
          abort: AbortSignal,
          onFrame: () => void,
        ) => {
          frame = onFrame;
          onFrame();
          return new Promise<void>((resolve) => abort.addEventListener('abort', () => resolve()));
        },
      );
      const { fixture, openScreenVideo, element } = await setup(null, null, {
        player: { play },
        stream: { body: new ReadableStream(), codec: 'avc1.4d002a' },
      });
      await vi.waitFor(() => expect(play).toHaveBeenCalled());
      vi.advanceTimersByTime(2000);
      fixture.detectChanges();
      expect(element.textContent).not.toContain('Verbindung hängt');

      // Geprueft wird einmal pro Sekunde, der Hinweis kommt also nach 3 bis 4 s.
      vi.advanceTimersByTime(2000);
      fixture.detectChanges();
      expect(element.textContent).toContain('Verbindung hängt');

      frame();
      fixture.detectChanges();
      expect(element.textContent).not.toContain('Verbindung hängt');
      expect(openScreenVideo).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(11000);
      await vi.waitFor(() => expect(openScreenVideo).toHaveBeenCalledTimes(2));
      fixture.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('flags hanging JPEG requests', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    try {
      const { fixture, readScreen, element } = await setup(new Blob(['jpeg']));
      readScreen.mockImplementation(() => new Promise(() => undefined));
      // Beide laufenden Abrufe enden noch mit Bild, erst danach kommt nichts mehr.
      await new Promise((resolve) => setTimeout(resolve, 100));

      vi.advanceTimersByTime(4000);
      fixture.detectChanges();

      expect(element.textContent).toContain('Verbindung hängt');
      fixture.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['the first picture', null],
    ['the lock screen', 'blocked'],
  ] as const)('shows no stall hint while waiting for %s', async (_name, result) => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    try {
      const { fixture, element } = await setup(result);
      vi.advanceTimersByTime(5000);
      fixture.detectChanges();

      expect(element.textContent).not.toContain('Verbindung hängt');
      fixture.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  describe('in fullscreen', () => {
    const enterFullscreen = async (element: HTMLElement) => {
      const view = element.querySelector('.screen-view')!;
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        get: () => view,
      });
      document.dispatchEvent(new Event('fullscreenchange'));
    };
    const leaveFullscreen = () => {
      delete (document as { fullscreenElement?: Element }).fullscreenElement;
      document.dispatchEvent(new Event('fullscreenchange'));
    };
    const pointer = (type: string, x: number, y: number) =>
      new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });

    afterEach(leaveFullscreen);

    it('hides the options behind the logo until it is tapped', async () => {
      const { fixture, element } = await setup(new Blob(['jpeg']));
      const toolbar = element.querySelector('.screen-view__toolbar')!;
      expect(element.querySelector('.screen-view__handle')).toBeNull();

      await enterFullscreen(element);
      fixture.detectChanges();
      const handle = element.querySelector<HTMLElement>('.screen-view__handle')!;
      expect(toolbar.classList).toContain('screen-view__toolbar--closed');

      handle.click();
      fixture.detectChanges();
      expect(toolbar.classList).not.toContain('screen-view__toolbar--closed');
      expect(handle.getAttribute('aria-expanded')).toBe('true');

      handle.click();
      fixture.detectChanges();
      expect(toolbar.classList).toContain('screen-view__toolbar--closed');

      handle.click();
      leaveFullscreen();
      fixture.detectChanges();
      expect(element.querySelector('.screen-view__handle')).toBeNull();
      fixture.destroy();
    });

    it('moves the logo by dragging, without opening the options or touching the PC', async () => {
      const { fixture, sendAction, element } = await setup(new Blob(['jpeg']));
      await enterFullscreen(element);
      fixture.detectChanges();
      const view = element.querySelector<HTMLElement>('.screen-view')!;
      view.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 800, height: 400 }) as DOMRect;
      const handle = element.querySelector<HTMLElement>('.screen-view__handle')!;

      handle.dispatchEvent(pointer('pointerdown', 760, 30));
      handle.dispatchEvent(pointer('pointermove', 763, 30));
      fixture.detectChanges();
      expect(view.style.getPropertyValue('--handle-x')).toBe('0.95');

      handle.dispatchEvent(pointer('pointermove', 200, 300));
      handle.dispatchEvent(pointer('pointerup', 200, 300));
      handle.click();
      fixture.detectChanges();

      expect(view.style.getPropertyValue('--handle-x')).toBe('0.25');
      expect(view.style.getPropertyValue('--handle-y')).toBe('0.75');
      const toolbar = element.querySelector('.screen-view__toolbar')!;
      expect(toolbar.classList).toContain('screen-view__toolbar--closed');
      expect(toolbar.classList).toContain('screen-view__toolbar--left');
      expect(toolbar.classList).toContain('screen-view__toolbar--up');
      expect(sendAction).not.toHaveBeenCalled();

      handle.click();
      fixture.detectChanges();
      expect(toolbar.classList).not.toContain('screen-view__toolbar--closed');
      fixture.destroy();
    });

    it('closes the options on a tap beside them without clicking on the PC', async () => {
      const { fixture, sendAction, element } = await setup(new Blob(['jpeg']));
      await enterFullscreen(element);
      fixture.detectChanges();
      element.querySelector<HTMLElement>('.screen-view__handle')!.click();
      const image = element.querySelector('img.screen-view__image')!;
      image.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 200, height: 100 }) as DOMRect;

      image.dispatchEvent(pointer('pointerdown', 50, 50));
      image.dispatchEvent(pointer('pointerup', 50, 50));
      image.dispatchEvent(pointer('click', 50, 50));
      fixture.detectChanges();

      expect(element.querySelector('.screen-view__toolbar')!.classList).toContain(
        'screen-view__toolbar--closed',
      );
      expect(sendAction).not.toHaveBeenCalled();

      image.dispatchEvent(pointer('pointerdown', 50, 50));
      image.dispatchEvent(pointer('pointerup', 50, 50));
      image.dispatchEvent(pointer('click', 50, 50));
      expect(sendAction).toHaveBeenCalledOnce();
      fixture.destroy();
    });
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
