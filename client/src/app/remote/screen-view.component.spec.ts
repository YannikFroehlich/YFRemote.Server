import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClipboardSyncService } from './clipboard-sync.service';
import { ClipboardService } from './clipboard.service';
import { FileTransferService } from './file-transfer.service';
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
      async (_width: number, _quality: number, _monitor?: string | null, _signal?: AbortSignal) =>
        result,
    );
    const openScreenVideo = vi.fn(
      async (_width: number, _bitrate: number, _signal: AbortSignal, _monitor?: string | null) =>
        video?.stream ?? null,
    );
    const sendAction = vi.fn();
    const openScreenAudio = vi.fn(async () => audioResponse);
    const screenQuality = signal<'performance' | 'balanced' | 'quality'>('balanced');
    const touchAvailable = signal(false);
    const screenTouch = signal(false);
    const context = {
      currentTime: 0,
      destination: {},
      resume: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      createBuffer: vi.fn(),
      createBufferSource: vi.fn(),
    };
    const clipboardSync = {
      active: signal(false),
      available: signal(true),
      secureContextAvailable: true,
      syncPasted: vi.fn(async (_content: string | Blob) => undefined),
      deviceFilesChanged: vi.fn(() => true),
      noteDeviceFiles: vi.fn(),
    };
    const sendFiles = vi.fn(async (_names: readonly string[]) => ({ success: true }));
    const sendFile = vi.fn(async (file: File) => ({ success: true, fileName: file.name }));
    const clipboardSyncSetting = signal(false);
    const serverPlatform = signal<'windows' | 'linux'>('windows');
    const screenCursor = signal<string | null>(null);
    const watchScreenCursor = vi.fn((enabled: boolean) => screenCursor.set(enabled ? 'text' : null));
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
            scrollSpeed: signal(1),
            invertScroll: signal(false),
            saveScreenQuality: (quality: 'performance' | 'balanced' | 'quality') =>
              screenQuality.set(quality),
            touchAvailable,
            screenTouch,
            saveScreenTouch: (enabled: boolean) => screenTouch.set(enabled),
            clipboardSyncSupported: signal(true),
            clipboardSync: clipboardSyncSetting,
            saveClipboardSync: (enabled: boolean) => clipboardSyncSetting.set(enabled),
            serverPlatform,
            screenCursor,
            watchScreenCursor,
          },
        },
        { provide: ClipboardSyncService, useValue: clipboardSync },
        { provide: ClipboardService, useValue: { sendFiles } },
        {
          provide: FileTransferService,
          useValue: { sendFile, uploadProgress: signal<number | null>(null) },
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
      touchAvailable,
      screenTouch,
      clipboardSync,
      clipboardSyncSetting,
      serverPlatform,
      sendFiles,
      sendFile,
      watchScreenCursor,
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

  describe('video width per quality', () => {
    async function widthsFor(desktop: boolean, viewWidth = 1000) {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: desktop && query === '(pointer: fine)',
      }));
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
      const { fixture, openScreenVideo, element } = await setup(null, null, {
        player: { play },
        stream: { body: new ReadableStream(), codec: 'avc1.4d002a' },
      });
      const view = element.querySelector('.screen-view')!;
      Object.defineProperty(view, 'clientWidth', { configurable: true, value: viewWidth });
      const select = element.querySelector<HTMLSelectElement>('.screen-view__quality')!;
      const requests: [number, number][] = [];
      for (const quality of ['performance', 'balanced', 'quality']) {
        const calls = openScreenVideo.mock.calls.length;
        select.value = quality;
        select.dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(openScreenVideo.mock.calls.length).toBeGreaterThan(calls));
        const [width, kbps] = openScreenVideo.mock.calls.at(-1)!;
        requests.push([width, kbps]);
      }
      fixture.destroy();
      return requests;
    }

    it('differs per setting on a desktop and goes beyond 1080p there', async () => {
      expect(await widthsFor(true)).toEqual([
        [1000, 4000],
        [1500, 8000],
        [3000, 39063],
      ]);
    });

    it('asks for the full 4K bitrate at the widest picture', async () => {
      expect((await widthsFor(true, 1300)).at(-1)).toEqual([3840, 64000]);
    });

    it('stays at 1080p on a phone', async () => {
      expect(await widthsFor(false)).toEqual([
        [1000, 4000],
        [1500, 8000],
        [1920, 16000],
      ]);
    });
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

  it('falls back to JPEG when the server refuses video after it played', async () => {
    const play = vi.fn(
      async (
        _body: ReadableStream<Uint8Array<ArrayBuffer>>,
        _video: HTMLVideoElement,
        _codec: string,
        _abort: AbortSignal,
        onFrame: () => void,
      ) => onFrame(),
    );
    const { fixture, readScreen, openScreenVideo, element } = await setup(
      new Blob(['jpeg']),
      null,
      { player: { play }, stream: { body: new ReadableStream(), codec: 'avc1.4d002a' } },
    );
    await vi.waitFor(() => expect(play).toHaveBeenCalled());
    // Der Strom ist abgerissen, der neue Server kann fuer diesen Monitor kein Video.
    openScreenVideo.mockResolvedValue('unsupported' as never);

    await vi.waitFor(() => expect(readScreen).toHaveBeenCalled(), { timeout: 3000 });
    fixture.detectChanges();

    expect(element.querySelector('video')?.hidden).toBe(true);
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

  function penEvent(
    target: Element,
    type: string,
    init: { clientX: number; buttons?: number; pressure?: number; tiltX?: number; tiltY?: number },
  ): void {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      pointerId: { value: 9 },
      clientX: { value: init.clientX },
      clientY: { value: 100 },
      pointerType: { value: 'pen' },
      button: { value: 0 },
      buttons: { value: init.buttons ?? 0 },
      pressure: { value: init.pressure ?? 0 },
      tiltX: { value: init.tiltX ?? 0 },
      tiltY: { value: init.tiltY ?? 0 },
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

  function mouse(target: Element, type: string, clientX: number, buttons: number): void {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      pointerId: { value: 1 },
      clientX: { value: clientX },
      clientY: { value: 100 },
      pointerType: { value: 'mouse' },
      button: { value: 0 },
      buttons: { value: buttons },
    });
    target.dispatchEvent(event);
  }

  it('shows only its own pointer, shaped like the PC one, while the mouse is over the picture', async () => {
    const { fixture, stage, watchScreenCursor } = await setupGestures();

    mouse(stage, 'pointermove', 100, 0);
    fixture.detectChanges();
    expect(watchScreenCursor).toHaveBeenLastCalledWith(true);
    expect(stage.style.cursor).toBe('text');

    mouse(stage, 'pointerleave', 500, 0);
    fixture.detectChanges();
    expect(watchScreenCursor).toHaveBeenLastCalledWith(false);
    expect(stage.style.cursor).toBe('');
    fixture.destroy();
  });

  it('drives the PC pointer and buttons directly with a mouse', async () => {
    const { fixture, sendAction, stage } = await setupGestures();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      frames.push(callback),
    );

    mouse(stage, 'pointermove', 100, 0);
    frames.splice(0).forEach((callback) => callback(1000));
    mouse(stage, 'pointerdown', 100, 1);
    mouse(stage, 'pointermove', 200, 1);
    mouse(stage, 'pointermove', 200, 5);
    mouse(stage, 'pointerup', 300, 0);
    stage.dispatchEvent(new MouseEvent('click', { clientX: 300, clientY: 100, bubbles: true }));
    stage.dispatchEvent(
      new MouseEvent('contextmenu', { clientX: 300, clientY: 100, bubbles: true, cancelable: true }),
    );

    expect(sendAction.mock.calls).toEqual([
      [{ type: 'screenMove', x: 0.25, y: 0.5 }],
      [{ type: 'screenMove', x: 0.25, y: 0.5 }],
      [{ type: 'mouseDown', button: 'left' }],
      [{ type: 'screenMove', x: 0.5, y: 0.5 }],
      [{ type: 'mouseDown', button: 'middle' }],
      [{ type: 'screenMove', x: 0.75, y: 0.5 }],
      [{ type: 'mouseUp', button: 'left' }],
      [{ type: 'mouseUp', button: 'middle' }],
    ]);
    fixture.destroy();
  });

  it('scrolls and zooms the PC with the mouse wheel', async () => {
    const { fixture, sendAction, stage } = await setupGestures();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      frames.push(callback),
    );

    stage.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true }));
    stage.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true }));
    frames.splice(0).forEach((callback) => callback(1000));
    stage.dispatchEvent(new WheelEvent('wheel', { deltaY: -3, deltaMode: 1, ctrlKey: true }));
    frames.splice(0).forEach((callback) => callback(1000));

    expect(sendAction.mock.calls).toEqual([
      [{ type: 'mouseScroll', delta: -240 }],
      [{ type: 'mouseZoom', delta: 120 }],
    ]);
    fixture.destroy();
  });

  it('sends keys of a real keyboard while the picture has the focus', async () => {
    const { fixture, sendAction, stage } = await setupGestures();
    const key = (type: string, init: KeyboardEventInit) => {
      const event = new KeyboardEvent(type, { ...init, bubbles: true, cancelable: true });
      stage.dispatchEvent(event);
      return event.defaultPrevented;
    };

    expect(key('keydown', { key: 'ä' })).toBe(true);
    key('keydown', { key: 'z', code: 'KeyY', ctrlKey: true });
    key('keydown', { key: 'ArrowLeft', shiftKey: true });
    key('keydown', { key: 'Shift', shiftKey: true });
    key('keydown', { key: 'Meta' });
    key('keyup', { key: 'Meta' });
    key('keydown', { key: 'Meta', metaKey: true });
    key('keydown', { key: 'e', metaKey: true });
    key('keyup', { key: 'Meta' });

    expect(sendAction.mock.calls).toEqual([
      [{ type: 'text', text: 'ä' }],
      [{ type: 'hotkey', keys: ['CTRL', 'Z'] }],
      [{ type: 'hotkey', keys: ['SHIFT', 'LEFT'] }],
      [{ type: 'key', keys: ['WIN'] }],
      [{ type: 'hotkey', keys: ['WIN', 'E'] }],
    ]);
    fixture.destroy();
  });

  describe('clipboard and files', () => {
    const ctrlV = { type: 'hotkey', keys: ['CTRL', 'V'] };

    function pressCtrlV(stage: HTMLElement): boolean {
      const event = new KeyboardEvent('keydown', {
        key: 'v',
        code: 'KeyV',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      stage.dispatchEvent(event);
      return event.defaultPrevented;
    }

    // jsdom kennt weder ClipboardEvent noch DataTransfer.
    function paste(text: string, files: File[] = []): Event {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', {
        value: { getData: () => text, files },
      });
      document.dispatchEvent(event);
      return event;
    }

    it('sends what the device copied before Ctrl+V, and later keys after it', async () => {
      const { fixture, sendAction, stage, clipboardSync } = await setupGestures();
      clipboardSync.active.set(true);
      let finishSync = () => {};
      clipboardSync.syncPasted.mockImplementation(
        () => new Promise<undefined>((resolve) => (finishSync = () => resolve(undefined))),
      );

      expect(pressCtrlV(stage)).toBe(false);
      expect(paste('vom Gerät').defaultPrevented).toBe(true);
      stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await Promise.resolve();
      expect(sendAction).not.toHaveBeenCalled();

      finishSync();
      await vi.waitFor(() =>
        expect(sendAction.mock.calls).toEqual([[ctrlV], [{ type: 'key', keys: ['ENTER'] }]]),
      );
      expect(clipboardSync.syncPasted).toHaveBeenCalledWith('vom Gerät');
      fixture.destroy();
    });

    it('sends Ctrl+V on its own when the browser fires no paste event', async () => {
      const { fixture, sendAction, stage, clipboardSync } = await setupGestures();
      clipboardSync.active.set(true);

      pressCtrlV(stage);
      await vi.waitFor(() => expect(sendAction.mock.calls).toEqual([[ctrlV]]));
      expect(clipboardSync.syncPasted).not.toHaveBeenCalled();
      fixture.destroy();
    });

    it('leaves Ctrl+V alone while the clipboard is not shared', async () => {
      const { fixture, sendAction, stage, clipboardSync } = await setupGestures();

      expect(pressCtrlV(stage)).toBe(true);
      expect(sendAction.mock.calls).toEqual([[ctrlV]]);
      expect(paste('vom Gerät').defaultPrevented).toBe(false);
      expect(clipboardSync.syncPasted).not.toHaveBeenCalled();
      fixture.destroy();
    });

    it('uploads files copied on the device and pastes them on the PC', async () => {
      const { fixture, sendAction, stage, clipboardSync, sendFile, sendFiles } =
        await setupGestures();
      clipboardSync.active.set(true);
      const file = new File(['x'], 'bericht.pdf');

      pressCtrlV(stage);
      paste('', [file]);

      await vi.waitFor(() => expect(sendAction.mock.calls).toEqual([[ctrlV]]));
      expect(sendFile).toHaveBeenCalledWith(file);
      expect(sendFiles).toHaveBeenCalledWith(['bericht.pdf']);
      expect(clipboardSync.noteDeviceFiles).toHaveBeenCalledWith([file]);
      expect(clipboardSync.syncPasted).not.toHaveBeenCalled();
      fixture.destroy();
    });

    it('syncs before Ctrl+Shift+V too', async () => {
      const { fixture, sendAction, stage, clipboardSync } = await setupGestures();
      clipboardSync.active.set(true);
      const event = new KeyboardEvent('keydown', {
        key: 'V',
        code: 'KeyV',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });

      stage.dispatchEvent(event);
      paste('ohne Format');

      expect(event.defaultPrevented).toBe(false);
      await vi.waitFor(() =>
        expect(sendAction.mock.calls).toEqual([[{ type: 'hotkey', keys: ['CTRL', 'SHIFT', 'V'] }]]),
      );
      expect(clipboardSync.syncPasted).toHaveBeenCalledWith('ohne Format');
      fixture.destroy();
    });

    it('pastes copied files only through a Windows server, without uploading them elsewhere', async () => {
      const { fixture, sendAction, stage, clipboardSync, sendFile, serverPlatform } =
        await setupGestures();
      clipboardSync.active.set(true);
      serverPlatform.set('linux');

      pressCtrlV(stage);
      paste('', [new File(['x'], 'bericht.pdf')]);

      await vi.waitFor(() => expect(sendAction.mock.calls).toEqual([[ctrlV]]));
      expect(sendFile).not.toHaveBeenCalled();
      expect(clipboardSync.syncPasted).not.toHaveBeenCalled();
      fixture.destroy();
    });

    it('sends a pasted screenshot as an image, not as a file', async () => {
      const { fixture, stage, clipboardSync, sendFile } = await setupGestures();
      clipboardSync.active.set(true);
      const image = new File(['png'], 'image.png', { type: 'image/png' });

      pressCtrlV(stage);
      paste('', [image]);

      await vi.waitFor(() => expect(clipboardSync.syncPasted).toHaveBeenCalledWith(image));
      expect(sendFile).not.toHaveBeenCalled();
      fixture.destroy();
    });

    it('uploads dropped files and puts them on the PC clipboard', async () => {
      const { fixture, element, sendFile, sendFiles } = await setupGestures();
      const view = element.querySelector<HTMLElement>('.screen-view')!;
      const file = new File(['x'], 'foto.jpg');
      const drag = (type: string) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'dataTransfer', {
          value: { types: ['Files'], files: [file], dropEffect: 'none' },
        });
        view.dispatchEvent(event);
        return event.defaultPrevented;
      };

      expect(drag('dragover')).toBe(true);
      fixture.detectChanges();
      expect(view.classList).toContain('screen-view--dropping');
      expect(drag('drop')).toBe(true);

      await vi.waitFor(() => expect(sendFiles).toHaveBeenCalledWith(['foto.jpg']));
      expect(sendFile).toHaveBeenCalledWith(file);
      fixture.detectChanges();
      expect(view.classList).not.toContain('screen-view--dropping');
      expect(element.textContent).toContain('Strg+V');
      fixture.destroy();
    });

    it('switches the shared clipboard from the toolbar', async () => {
      const { fixture, element, clipboardSyncSetting } = await setupGestures();
      const button = [...element.querySelectorAll<HTMLButtonElement>('.snap-switch')].find(
        (candidate) => candidate.textContent?.includes('Zwischenablage'),
      )!;

      button.click();

      expect(clipboardSyncSetting()).toBe(true);
      fixture.destroy();
    });
  });

  it('moves the PC pointer while a pen hovers, also with the side button', async () => {
    const { fixture, sendAction, stage } = await setupGestures();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    const hover = (pointerType: string, clientX: number, buttons = 0) => {
      const event = new Event('pointermove', { bubbles: true });
      Object.defineProperties(event, {
        pointerId: { value: 5 },
        clientX: { value: clientX },
        clientY: { value: 50 },
        pointerType: { value: pointerType },
        buttons: { value: buttons },
      });
      stage.dispatchEvent(event);
    };

    hover('pen', 100);
    hover('pen', 200, 2);
    frames.splice(0).forEach((callback) => callback(1000));

    expect(sendAction.mock.calls).toEqual([[{ type: 'screenMove', x: 0.5, y: 0.25 }]]);
    fixture.destroy();
  });

  it('right-clicks for a pen tap with the side button held, without dragging', async () => {
    const { fixture, sendAction, stage } = await setupGestures();

    penEvent(stage, 'pointerdown', { clientX: 100, buttons: 3 });
    penEvent(stage, 'pointermove', { clientX: 200, buttons: 3 });
    stage.dispatchEvent(
      new MouseEvent('contextmenu', {
        clientX: 100,
        clientY: 100,
        bubbles: true,
        cancelable: true,
      }),
    );
    penEvent(stage, 'pointerup', { clientX: 200, buttons: 2 });
    stage.dispatchEvent(new MouseEvent('click', { clientX: 200, clientY: 100, bubbles: true }));

    expect(sendAction.mock.calls).toEqual([
      [{ type: 'screenClick', x: 0.25, y: 0.5, button: 'right' }],
    ]);
    fixture.destroy();
  });

  it('sends a pen as a real pen with the switch on, and takes it away in the background', async () => {
    const { fixture, sendAction, stage, element, touchAvailable } = await setupGestures();
    touchAvailable.set(true);
    fixture.detectChanges();
    [...element.querySelectorAll<HTMLButtonElement>('.snap-switch')]
      .find((button) => button.textContent?.includes('Touch'))!
      .click();
    fixture.detectChanges();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    const hovering = { x: 0.25, y: 0.5, pressure: 0, tiltX: 0, tiltY: 0, contact: false };

    penEvent(stage, 'pointermove', { clientX: 100 });
    frames.splice(0).forEach((callback) => callback(1000));
    penEvent(stage, 'pointerdown', {
      clientX: 100,
      buttons: 1,
      pressure: 0.6,
      tiltX: 20,
      tiltY: -10,
    });
    penEvent(stage, 'pointerup', { clientX: 100, buttons: 2 });
    stage.dispatchEvent(new MouseEvent('click', { clientX: 100, clientY: 100, bubbles: true }));
    penEvent(stage, 'pointerleave', { clientX: 100 });
    penEvent(stage, 'pointerleave', { clientX: 100 });
    penEvent(stage, 'pointerdown', { clientX: 100, buttons: 32 });
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));

    expect(sendAction.mock.calls).toEqual([
      [{ type: 'pen', pen: { ...hovering, barrel: false, eraser: false } }],
      [
        {
          type: 'pen',
          pen: {
            ...hovering,
            pressure: 0.6,
            tiltX: 20,
            tiltY: -10,
            contact: true,
            barrel: false,
            eraser: false,
          },
        },
      ],
      [{ type: 'pen', pen: { ...hovering, barrel: true, eraser: false } }],
      [{ type: 'pen', pen: null }],
      [
        {
          type: 'pen',
          pen: { ...hovering, pressure: 0.5, contact: true, barrel: false, eraser: true },
        },
      ],
      [{ type: 'pen', pen: null }],
    ]);
    fixture.destroy();
  });

  it('sends every finger as real touch with the switch on, and lifts them in the background', async () => {
    const { fixture, sendAction, stage, element, touchAvailable } = await setupGestures();
    touchAvailable.set(true);
    fixture.detectChanges();
    const touchSwitch = [...element.querySelectorAll<HTMLButtonElement>('.snap-switch')].find(
      (button) => button.textContent?.includes('Touch'),
    )!;
    touchSwitch.click();
    fixture.detectChanges();
    expect(touchSwitch.getAttribute('aria-checked')).toBe('true');

    pointer(stage, 'pointerdown', 7, 100, 100);
    pointer(stage, 'pointerdown', 8, 300, 50);
    pointer(stage, 'pointerup', 7, 100, 100);
    stage.dispatchEvent(new MouseEvent('click', { clientX: 100, clientY: 100, bubbles: true }));
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));

    expect(sendAction.mock.calls).toEqual([
      [{ type: 'touch', points: [{ id: 0, x: 0.25, y: 0.5 }] }],
      [
        {
          type: 'touch',
          points: [
            { id: 0, x: 0.25, y: 0.5 },
            { id: 1, x: 0.75, y: 0.25 },
          ],
        },
      ],
      [{ type: 'touch', points: [{ id: 1, x: 0.75, y: 0.25 }] }],
      [{ type: 'touch', points: [] }],
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

  it('zooms the PC with Ctrl+wheel steps when spreading two fingers', async () => {
    const { fixture, sendAction, stage } = await setupGestures();

    pointer(stage, 'pointerdown', 1, 90, 100);
    pointer(stage, 'pointerdown', 2, 110, 100);
    pointer(stage, 'pointermove', 1, 80, 100);
    pointer(stage, 'pointermove', 2, 120, 100);
    pointer(stage, 'pointermove', 2, 100, 100);
    pointer(stage, 'pointerup', 1, 80, 100);
    pointer(stage, 'pointermove', 2, 300, 100);
    pointer(stage, 'pointerup', 2, 300, 100);
    stage.dispatchEvent(new MouseEvent('click', { clientX: 300, clientY: 100, bubbles: true }));

    const zoomIn = [{ type: 'mouseZoom', delta: 120 }];
    const zoomOut = [{ type: 'mouseZoom', delta: -120 }];
    expect(sendAction.mock.calls).toEqual([
      [{ type: 'screenMove', x: 0.25, y: 0.5 }],
      zoomIn,
      zoomIn,
      zoomIn,
      zoomIn,
      zoomOut,
      zoomOut,
      zoomOut,
      zoomOut,
    ]);
    fixture.destroy();
  });

  it('scrolls the page with two fingers', async () => {
    const { fixture, sendAction, stage } = await setupGestures();
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
    expect(sendAction).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('scrolls the PC with two fingers when the page has nothing to scroll', async () => {
    const { fixture, sendAction, stage } = await setupGestures();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      frames.push(callback),
    );

    pointer(stage, 'pointerdown', 1, 100, 150);
    pointer(stage, 'pointerdown', 2, 200, 150);
    expect(sendAction).not.toHaveBeenCalled();
    pointer(stage, 'pointermove', 1, 100, 130);
    pointer(stage, 'pointermove', 2, 200, 130);
    frames.splice(0).forEach((callback) => callback(0));

    expect(sendAction.mock.calls).toEqual([
      [{ type: 'screenMove', x: 0.375, y: 0.75 }],
      [{ type: 'mouseScroll', delta: -120 }],
    ]);
    pointer(stage, 'pointerup', 1, 100, 130);
    pointer(stage, 'pointerup', 2, 200, 130);
    fixture.destroy();
  });

  it('keeps scrolling the PC when the finger distance changes on the way', async () => {
    const { fixture, sendAction, stage } = await setupGestures();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      frames.push(callback),
    );

    pointer(stage, 'pointerdown', 1, 100, 150);
    pointer(stage, 'pointerdown', 2, 200, 150);
    pointer(stage, 'pointermove', 1, 95, 130);
    pointer(stage, 'pointermove', 2, 210, 130);
    pointer(stage, 'pointermove', 1, 90, 110);
    frames.splice(0).forEach((callback) => callback(0));

    expect(sendAction.mock.calls.map(([action]) => action.type)).not.toContain('mouseZoom');
    expect(sendAction.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'mouseScroll' });
    pointer(stage, 'pointerup', 1, 90, 110);
    pointer(stage, 'pointerup', 2, 210, 130);
    fixture.destroy();
  });

  it('zooms the PC instead of scrolling the page when spreading two fingers', async () => {
    const { fixture, sendAction, stage } = await setupGestures();
    const scroller = stage.parentElement!;
    scroller.style.overflowY = 'auto';
    Object.defineProperty(scroller, 'scrollHeight', { value: 1000 });
    Object.defineProperty(scroller, 'clientHeight', { value: 300 });

    pointer(stage, 'pointerdown', 1, 90, 100);
    pointer(stage, 'pointerdown', 2, 110, 100);
    pointer(stage, 'pointermove', 1, 50, 80);
    pointer(stage, 'pointermove', 2, 150, 80);

    expect(scroller.scrollTop).toBe(0);
    expect(sendAction.mock.calls.at(-1)).toEqual([{ type: 'mouseZoom', delta: 120 }]);
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
    const { fixture, openScreenVideo, element } = await setup('blocked', null, {
      player: { play },
      stream: 'blocked',
    });
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(element.textContent).toContain('Sperrbildschirm');
    });
    openScreenVideo.mockResolvedValue({
      body: new ReadableStream(),
      codec: 'avc1.4d002a',
    } as never);

    await vi.waitFor(() => expect(play).toHaveBeenCalled(), { timeout: 3000 });
    fixture.detectChanges();

    expect(element.textContent).not.toContain('Sperrbildschirm');
    fixture.destroy();
  });

  it('shows still pictures while the PC service serves the lock screen, and drops them for the video', async () => {
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
      {
        player: { play },
        stream: 'blocked',
      },
    );

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(element.querySelector('img')?.getAttribute('src')).toBeTruthy();
    });
    expect(readScreen).toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    expect(element.textContent).not.toContain('Sperrbildschirm');

    openScreenVideo.mockResolvedValue({
      body: new ReadableStream(),
      codec: 'avc1.4d002a',
    } as never);
    await vi.waitFor(() => expect(play).toHaveBeenCalled(), { timeout: 3000 });
    fixture.detectChanges();

    expect(element.querySelector('img')).toBeNull();
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

  it('aborts hanging JPEG requests and asks again', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    try {
      const { fixture, readScreen } = await setup(new Blob(['jpeg']));
      const hanging: AbortSignal[] = [];
      readScreen.mockImplementation(
        (_width, _quality, _monitor, signal) =>
          new Promise((resolve) => {
            hanging.push(signal!);
            signal!.addEventListener('abort', () => resolve(null));
          }),
      );
      await vi.waitFor(() => expect(hanging).toHaveLength(2));

      vi.advanceTimersByTime(11000);

      expect(hanging.every((signal) => signal.aborted)).toBe(true);
      // Nach der Wartezeit fuer Fehler geht es mit frischen Abrufen weiter.
      await vi.waitFor(() => expect(hanging).toHaveLength(4), { timeout: 3000 });
      expect(hanging.slice(2).some((signal) => signal.aborted)).toBe(false);
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

  it('fills the visible area instead where the device has no fullscreen (iPhone)', async () => {
    const { fixture, element } = await setup(new Blob(['jpeg']));
    const view = element.querySelector('.screen-view')!;
    const button = element.querySelector<HTMLElement>('[aria-label="Vollbild"]')!;

    button.click();
    fixture.detectChanges();
    expect(view.classList).toContain('screen-view--fullscreen');
    expect(button.getAttribute('aria-checked')).toBe('true');
    expect(element.querySelector('.screen-view__handle')).not.toBeNull();

    // Zurueck wie im echten Vollbild: Logo antippen, dann der Vollbild-Schalter.
    element.querySelector<HTMLElement>('.screen-view__handle')!.click();
    fixture.detectChanges();
    button.click();
    fixture.detectChanges();
    expect(view.classList).not.toContain('screen-view--fullscreen');
    expect(element.querySelector('.screen-view__handle')).toBeNull();
    fixture.destroy();
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

    it('fetches the picture as wide as the fullscreen view, not the page around it', async () => {
      const { fixture, element, readScreen } = await setup(new Blob(['jpeg']));
      const view = element.querySelector('.screen-view')!;
      Object.defineProperty(view, 'clientWidth', { configurable: true, value: 1600 });

      await enterFullscreen(element);
      // "Ausgeglichen": anderthalbfach, auch an einem Bildschirm mit Pixeldichte 1.
      await vi.waitFor(() => expect(readScreen.mock.calls.at(-1)?.[0]).toBe(2400));
      fixture.destroy();
    });

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
      view.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 400 }) as DOMRect;
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
      image.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 }) as DOMRect;

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

  it('sends special keys and held modifiers with the next key while the keyboard is open', async () => {
    const { fixture, sendAction, element } = await setup(new Blob(['jpeg']));
    expect(element.querySelector('.screen-view__keys')).toBeNull();
    Array.from(element.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Tastatur'))!
      .click();
    fixture.detectChanges();
    const key = (label: string) =>
      Array.from(element.querySelectorAll<HTMLButtonElement>('.screen-view__keys button')).find(
        (button) => button.textContent?.trim() === label,
      )!;
    const input = element.querySelector<HTMLInputElement>('.screen-view__keyboard input')!;

    key('ESC').click();
    key('CTRL').click();
    fixture.detectChanges();
    expect(key('CTRL').getAttribute('aria-pressed')).toBe('true');
    input.value = 'c';
    input.dispatchEvent(new Event('input'));
    key('ALT').click();
    key('→').click();
    input.value = 'x';
    input.dispatchEvent(new Event('input'));

    expect(sendAction.mock.calls).toEqual([
      [{ type: 'key', keys: ['ESC'] }],
      [{ type: 'hotkey', keys: ['CTRL', 'C'] }],
      [{ type: 'hotkey', keys: ['ALT', 'RIGHT'] }],
      [{ type: 'text', text: 'x' }],
    ]);
    fixture.detectChanges();
    expect(key('CTRL').getAttribute('aria-pressed')).toBe('false');
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
