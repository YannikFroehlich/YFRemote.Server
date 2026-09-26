import { TestBed } from '@angular/core/testing';
import { GamepadComponent } from './gamepad.component';
import { GAMEPAD_LAYOUT_STORAGE_KEY, presetLayout } from './gamepad-layout';
import {
  REMOTE_AUTO_CONNECT,
  REMOTE_STORAGE,
  REMOTE_VIBRATE,
  REMOTE_WEBSOCKET_FACTORY,
  RemoteService,
  RemoteSocket,
} from '../remote.service';

class MockRemoteSocket implements RemoteSocket {
  readonly sentMessages: string[] = [];

  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(readonly url: string) {}

  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = 3;
  }
}

describe('GamepadComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });

  it('sends the pressed face button as XInput bit and releases it again', async () => {
    const pad = await setupGamepad();

    pointer(pad.button('A'), 'pointerdown', 1, 0, 0);
    pad.nextFrame(100);
    pointer(pad.button('A'), 'pointerup', 1, 0, 0);
    pad.nextFrame(200);

    expect(pad.sent()).toEqual([
      { type: 'gamepad', gamepad: { ...neutral, buttons: 0x1000 } },
      { type: 'gamepad', gamepad: neutral },
    ]);
  });

  it('combines several fingers into one state and maps triggers to full pull', async () => {
    const pad = await setupGamepad();

    pointer(pad.button('RT'), 'pointerdown', 1, 0, 0);
    pointer(pad.button('B'), 'pointerdown', 2, 0, 0);

    expect(pad.sent().at(-1)).toEqual({
      type: 'gamepad',
      gamepad: { ...neutral, buttons: 0x2000, rightTrigger: 255 },
    });
  });

  it('maps a stick drag to axes with Y pointing up and clamps to the rim', async () => {
    const pad = await setupGamepad();
    const stick = pad.root.querySelector<HTMLElement>('.gp-stick')!;
    stick.getBoundingClientRect = () => new DOMRect(0, 0, 100, 100);

    pointer(stick, 'pointerdown', 1, 50, 50);
    pointer(stick, 'pointermove', 1, 50, 0);
    pad.nextFrame(100);
    pointer(stick, 'pointermove', 1, 400, 50);
    pad.nextFrame(200);

    expect(pad.sent()).toEqual([
      { type: 'gamepad', gamepad: { ...neutral, leftY: 32767 } },
      { type: 'gamepad', gamepad: { ...neutral, leftX: 32767 } },
    ]);
  });

  it('keeps a tap that is released before the next frame', async () => {
    const pad = await setupGamepad();

    pointer(pad.button('A'), 'pointerdown', 1, 0, 0);
    pointer(pad.button('A'), 'pointerup', 1, 0, 0);
    pad.nextFrame(100);

    expect(pad.sent()).toEqual([
      { type: 'gamepad', gamepad: { ...neutral, buttons: 0x1000 } },
      { type: 'gamepad', gamepad: neutral },
    ]);
  });

  it('sends stick movement at most every 16 ms', async () => {
    const pad = await setupGamepad();
    const stick = pad.root.querySelector<HTMLElement>('.gp-stick')!;
    stick.getBoundingClientRect = () => new DOMRect(0, 0, 100, 100);

    pointer(stick, 'pointerdown', 1, 60, 50);
    pad.nextFrame(100);
    pointer(stick, 'pointermove', 1, 70, 50);
    pad.nextFrame(108);

    expect(pad.sent()).toHaveLength(1);

    pad.nextFrame(117);

    expect(pad.sent()).toHaveLength(2);
  });

  it('releases everything when the page is hidden', async () => {
    const pad = await setupGamepad();

    pointer(pad.button('RT'), 'pointerdown', 1, 0, 0);
    pad.nextFrame(100);
    document.dispatchEvent(new Event('visibilitychange'));
    pad.nextFrame(200);

    expect(pad.sent().at(-1)).toEqual({ type: 'gamepad', gamepad: neutral });
  });

  it('vibrates while the game rumbles and stops when it ends', async () => {
    const pad = await setupGamepad();

    pad.receive({ type: 'rumble', largeMotor: 0, smallMotor: 120 });
    pad.flushEffects();
    pad.receive({ type: 'rumble', largeMotor: 0, smallMotor: 0 });
    pad.flushEffects();

    expect(pad.vibrations).toEqual([0, 10000, 0]);
    expect(pad.remote.lastError()).toBeNull();
  });

  it('stops vibrating when the connection drops', async () => {
    const pad = await setupGamepad();

    pad.receive({ type: 'rumble', largeMotor: 255, smallMotor: 0 });
    pad.flushEffects();
    pad.socket.onclose?.(new CloseEvent('close'));
    pad.flushEffects();

    expect(pad.vibrations.at(-1)).toBe(0);
  });

  it('labels the face buttons by preset but sends them by position', async () => {
    const playstation = await setupGamepad({ layout: presetLayout('playstation') });
    pointer(playstation.button('✕'), 'pointerdown', 1, 0, 0);
    expect(playstation.sent().at(-1)).toEqual({
      type: 'gamepad',
      gamepad: { ...neutral, buttons: 0x1000 },
    });

    TestBed.resetTestingModule();
    // Nintendo: unten steht B, gesendet wird trotzdem XInput-A.
    const nintendo = await setupGamepad({ layout: presetLayout('nintendo') });
    pointer(nintendo.button('B'), 'pointerdown', 1, 0, 0);
    expect(nintendo.sent().at(-1)).toEqual({
      type: 'gamepad',
      gamepad: { ...neutral, buttons: 0x1000 },
    });
  });

  it('moves a control in edit mode, stores it and sends no input meanwhile', async () => {
    const pad = await setupGamepad();
    pad.button('✎').click();
    pad.flushEffects();
    const grab = pad.root.querySelectorAll<HTMLElement>('.gp-slot__grab')[0];
    grab.closest('.gamepad')!.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 500);

    pointer(grab, 'pointerdown', 1, 100, 100);
    pointer(grab, 'pointermove', 1, 200, 150);
    pointer(grab, 'pointerup', 1, 200, 150);

    // Raster ist Standard: 9 % + 100 px = 190 px, naechste 25-px-Zelle 200 px = 20 %.
    expect(pad.storedLayout()?.controls.leftTrigger).toEqual({
      x: 20,
      y: 20,
      scale: 1,
      hidden: false,
    });
    expect(pad.sent()).toEqual([]);
  });

  it('snaps a dragged control to square grid cells and can switch that off', async () => {
    const pad = await setupGamepad();
    pad.button('✎').click();
    pad.flushEffects();
    const grab = pad.root.querySelectorAll<HTMLElement>('.gp-slot__grab')[0];
    // 20 Zellen pro Hoehe: 25 px. Start 90/50 px + 13 px rastet auf 100/75 px ein.
    grab.closest('.gamepad')!.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 500);

    pointer(grab, 'pointerdown', 1, 0, 0);
    pointer(grab, 'pointermove', 1, 13, 13);
    pointer(grab, 'pointerup', 1, 13, 13);

    expect(pad.storedLayout()?.controls.leftTrigger).toMatchObject({ x: 10, y: 15 });

    pad.button('Raster').click();
    pointer(grab, 'pointerdown', 2, 0, 0);
    pointer(grab, 'pointermove', 2, 13, 13);

    expect(pad.storedLayout()?.snapToGrid).toBe(false);
    expect(pad.storedLayout()?.controls.leftTrigger).toMatchObject({ x: 11.3, y: 17.6 });
  });

  it('hides a control once editing is done', async () => {
    const pad = await setupGamepad();
    pad.button('✎').click();
    pad.flushEffects();
    pointer(pad.root.querySelectorAll<HTMLElement>('.gp-slot__grab')[0], 'pointerdown', 1, 0, 0);
    pad.flushEffects();
    pad.button('+').click();
    pad.button('Ausblenden').click();
    pad.button('Fertig').click();
    pad.flushEffects();

    expect(pad.root.textContent).not.toContain('LT');
    expect(pad.storedLayout()?.controls.leftTrigger).toEqual({
      x: 9,
      y: 10,
      scale: 1.1,
      hidden: true,
    });
  });

  it('unplugs the controller when it is closed', async () => {
    const pad = await setupGamepad();

    pad.destroy();

    expect(pad.sent()).toEqual([{ type: 'gamepadDisconnect' }]);
  });
});

const neutral = {
  buttons: 0,
  leftX: 0,
  leftY: 0,
  rightX: 0,
  rightY: 0,
  leftTrigger: 0,
  rightTrigger: 0,
};

async function setupGamepad(options: { layout?: unknown } = {}) {
  const stored = new Map<string, string>();
  if (options.layout) {
    stored.set(GAMEPAD_LAYOUT_STORAGE_KEY, JSON.stringify(options.layout));
  }
  const storage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  } as unknown as Storage;
  const sockets: MockRemoteSocket[] = [];
  const frames: FrameRequestCallback[] = [];
  const vibrations: number[] = [];

  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);

  await TestBed.configureTestingModule({
    imports: [GamepadComponent],
    providers: [
      RemoteService,
      { provide: REMOTE_STORAGE, useValue: storage },
      { provide: REMOTE_AUTO_CONNECT, useValue: false },
      { provide: REMOTE_VIBRATE, useValue: (durationMs: number) => vibrations.push(durationMs) },
      {
        provide: REMOTE_WEBSOCKET_FACTORY,
        useValue: (url: string) => {
          const socket = new MockRemoteSocket(url);
          sockets.push(socket);
          return socket;
        },
      },
    ],
  }).compileComponents();

  const remote = TestBed.inject(RemoteService);
  remote.connect();
  sockets[0].open();

  const fixture = TestBed.createComponent(GamepadComponent);
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;

  return {
    root,
    remote,
    vibrations,
    socket: sockets[0],
    receive: (message: unknown) =>
      sockets[0].onmessage?.(new MessageEvent('message', { data: JSON.stringify(message) })),
    flushEffects: () => fixture.detectChanges(),
    button: (label: string) =>
      Array.from(root.querySelectorAll<HTMLElement>('button')).find(
        (button) => button.textContent?.trim() === label,
      )!,
    nextFrame: (now: number) => {
      const pending = frames.splice(0);
      for (const callback of pending) {
        callback(now);
      }
    },
    sent: () => sockets[0].sentMessages.map((message) => JSON.parse(message) as unknown),
    destroy: () => fixture.destroy(),
    storedLayout: () => {
      const raw = stored.get(GAMEPAD_LAYOUT_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as ReturnType<typeof presetLayout>) : null;
    },
  };
}

function pointer(
  target: HTMLElement,
  type: string,
  pointerId: number,
  clientX: number,
  clientY: number,
): void {
  const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    clientX: { value: clientX },
    clientY: { value: clientY },
  });
  target.dispatchEvent(event);
}
