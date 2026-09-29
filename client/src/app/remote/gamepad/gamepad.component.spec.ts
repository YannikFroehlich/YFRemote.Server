import { TestBed } from '@angular/core/testing';
import { GAMEPAD_GYRO_STORAGE_KEY, GamepadComponent, tiltToStick } from './gamepad.component';
import { GAMEPAD_LAYOUT_STORAGE_KEY, presetLayout } from './gamepad-layout';
import {
  REMOTE_AUTO_CONNECT,
  REMOTE_STORAGE,
  REMOTE_VIBRATE,
  REMOTE_WEBSOCKET_FACTORY,
  RemoteService,
  RemoteSocket,
} from '../remote.service';
import { SERVER_LOCATION } from '../server-config';

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

  it('grades a trigger by how far the finger pulls it down', async () => {
    const pad = await setupGamepad();
    const trigger = pad.button('LT');
    trigger.getBoundingClientRect = () => new DOMRect(0, 100, 80, 50);

    pointer(trigger, 'pointerdown', 1, 10, 100);
    expect(pad.sent().at(-1)).toEqual({ type: 'gamepad', gamepad: { ...neutral, leftTrigger: 64 } });

    pointer(trigger, 'pointermove', 1, 10, 120);
    pad.nextFrame(100);
    expect(pad.sent().at(-1)).toEqual({ type: 'gamepad', gamepad: { ...neutral, leftTrigger: 160 } });

    // Ueber den Rand hinaus bleibt er voll, der Finger haengt per Pointer-Capture am Trigger.
    pointer(trigger, 'pointermove', 1, 10, 400);
    pad.nextFrame(200);
    expect(pad.sent().at(-1)).toEqual({ type: 'gamepad', gamepad: { ...neutral, leftTrigger: 255 } });
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
    pointer(playstation.button('Cross'), 'pointerdown', 1, 0, 0);
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

  it('maps tilt since the reference to stick axes for every screen rotation', () => {
    const reference = { beta: 40, gamma: 0 };

    // Hochformat: obere Kante zu sich = hoch, rechte Kante runter = rechts.
    expect(tiltToStick({ beta: 65, gamma: 0 }, reference, 0)).toEqual({ x: 0, y: 32767 });
    expect(tiltToStick({ beta: 40, gamma: 25 }, reference, 0)).toEqual({ x: 32767, y: 0 });
    // Querformat (90 Grad gegen den Uhrzeigersinn): die obere Geraetekante liegt links.
    expect(tiltToStick({ beta: 65, gamma: 0 }, reference, 90)).toEqual({ x: 32767, y: 0 });
    expect(tiltToStick({ beta: 40, gamma: 25 }, reference, 90)).toEqual({ x: 0, y: -32767 });
    expect(tiltToStick({ beta: 65, gamma: 0 }, reference, 270)).toEqual({ x: -32767, y: 0 });
    // Kleines Wackeln bleibt in der Totzone.
    expect(tiltToStick({ beta: 41, gamma: -1 }, reference, 0)).toEqual({ x: 0, y: 0 });
  });

  it('moves the right stick by tilt once switched on, and a finger on the stick wins', async () => {
    const pad = await setupGamepad();

    pad.button('Neigungssteuerung (rechter Stick)').click();
    await new Promise((resolve) => setTimeout(resolve));
    pad.tilt(40, 0);
    pad.tilt(65, 0);
    pad.nextFrame(100);

    expect(pad.sent().at(-1)).toEqual({ type: 'gamepad', gamepad: { ...neutral, rightY: 32767 } });
    expect(pad.stored.get(GAMEPAD_GYRO_STORAGE_KEY)).toBe('true');

    const rightStick = pad.root.querySelectorAll<HTMLElement>('.gp-stick')[1];
    rightStick.getBoundingClientRect = () => new DOMRect(0, 0, 100, 100);
    pointer(rightStick, 'pointerdown', 1, 100, 50);
    pad.nextFrame(200);

    expect(pad.sent().at(-1)).toEqual({ type: 'gamepad', gamepad: { ...neutral, rightX: 32767 } });
  });

  it('ignores tilt while switched off and centers the stick when switched off', async () => {
    const pad = await setupGamepad();

    pad.tilt(40, 0);
    pad.tilt(65, 0);
    pad.nextFrame(100);
    expect(pad.sent()).toEqual([]);

    pad.button('Neigungssteuerung (rechter Stick)').click();
    await new Promise((resolve) => setTimeout(resolve));
    pad.tilt(40, 0);
    pad.tilt(65, 0);
    pad.nextFrame(200);
    pad.button('Neigungssteuerung (rechter Stick)').click();
    await new Promise((resolve) => setTimeout(resolve));
    pad.nextFrame(300);

    expect(pad.sent().at(-1)).toEqual({ type: 'gamepad', gamepad: neutral });
    expect(pad.stored.get(GAMEPAD_GYRO_STORAGE_KEY)).toBe('false');
  });

  it('explains that tilt control needs HTTPS instead of switching on over plain http', async () => {
    const pad = await setupGamepad({ pageUrl: 'http://192.168.1.44:5050/' });

    pad.button('Neigungssteuerung (rechter Stick)').click();
    await new Promise((resolve) => setTimeout(resolve));
    pad.flushEffects();

    expect(pad.root.querySelector('.gamepad__status')?.textContent).toContain('braucht HTTPS');
    expect(pad.stored.has(GAMEPAD_GYRO_STORAGE_KEY)).toBe(false);
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

async function setupGamepad(options: { layout?: unknown; pageUrl?: string } = {}) {
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
      ...(options.pageUrl
        ? [{ provide: SERVER_LOCATION, useValue: new URL(options.pageUrl) }]
        : []),
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
    stored,
    tilt: (beta: number, gamma: number) => {
      const event = new Event('deviceorientation');
      Object.defineProperties(event, { beta: { value: beta }, gamma: { value: gamma } });
      window.dispatchEvent(event);
    },
    button: (label: string) =>
      Array.from(root.querySelectorAll<HTMLElement>('button')).find(
        (button) =>
          button.textContent?.trim() === label || button.getAttribute('aria-label') === label,
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
