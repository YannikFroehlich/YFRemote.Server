import { TestBed } from '@angular/core/testing';
import { GamepadComponent } from './gamepad.component';
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

async function setupGamepad() {
  const sockets: MockRemoteSocket[] = [];
  const frames: FrameRequestCallback[] = [];

  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);

  await TestBed.configureTestingModule({
    imports: [GamepadComponent],
    providers: [
      RemoteService,
      { provide: REMOTE_STORAGE, useValue: null },
      { provide: REMOTE_AUTO_CONNECT, useValue: false },
      { provide: REMOTE_VIBRATE, useValue: () => undefined },
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

  TestBed.inject(RemoteService).connect();
  sockets[0].open();

  const fixture = TestBed.createComponent(GamepadComponent);
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;

  return {
    root,
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
