import { TestBed } from '@angular/core/testing';
import {
  REMOTE_AUTO_CONNECT,
  REMOTE_STORAGE,
  REMOTE_WEBSOCKET_FACTORY,
  RemoteService,
  RemoteSocket,
} from '../remote.service';
import { MOUSE_SENSITIVITY_STORAGE_KEY } from '../server-config';
import { TouchpadComponent } from './touchpad.component';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class MockRemoteSocket implements RemoteSocket {
  readonly sentMessages: string[] = [];

  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  closed = false;

  constructor(readonly url: string) {}

  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
  }
}

interface TouchpadHarness {
  readonly fixture: ReturnType<typeof TestBed.createComponent<TouchpadComponent>>;
  readonly surface: HTMLElement;
  readonly sockets: MockRemoteSocket[];
  readonly flushRaf: () => void;
}

describe('TouchpadComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });

  it('batches one-finger movement per animation frame and applies sensitivity', async () => {
    const { surface, sockets, flushRaf } = await setupTouchpad({ sensitivity: 2 });

    dispatchPointer(surface, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
    dispatchPointer(surface, 'pointermove', { pointerId: 1, clientX: 102, clientY: 101 });
    dispatchPointer(surface, 'pointermove', { pointerId: 1, clientX: 105, clientY: 99 });

    expect(sockets[0].sentMessages).toEqual([]);

    flushRaf();

    expect(sockets[0].sentMessages).toEqual([
      '{"type":"mouseMove","deltaX":10,"deltaY":-2}',
    ]);
  });

  it('turns a short tap into left click but does not click after a drag', async () => {
    const { surface, sockets, flushRaf } = await setupTouchpad();

    dispatchPointer(surface, 'pointerdown', { pointerId: 1, clientX: 10, clientY: 10 });
    dispatchPointer(surface, 'pointerup', { pointerId: 1, clientX: 10, clientY: 10 });

    expect(sockets[0].sentMessages).toEqual(['{"type":"mouseClick","button":"left"}']);

    dispatchPointer(surface, 'pointerdown', { pointerId: 2, clientX: 20, clientY: 20 });
    dispatchPointer(surface, 'pointermove', { pointerId: 2, clientX: 45, clientY: 20 });
    flushRaf();
    dispatchPointer(surface, 'pointerup', { pointerId: 2, clientX: 45, clientY: 20 });

    expect(sockets[0].sentMessages).toEqual([
      '{"type":"mouseClick","button":"left"}',
      '{"type":"mouseMove","deltaX":25,"deltaY":0}',
    ]);
  });

  it('uses two fingers for scroll instead of pointer movement', async () => {
    const { surface, sockets, flushRaf } = await setupTouchpad();

    dispatchPointer(surface, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
    dispatchPointer(surface, 'pointerdown', { pointerId: 2, clientX: 140, clientY: 100 });
    dispatchPointer(surface, 'pointermove', { pointerId: 1, clientX: 100, clientY: 90 });
    dispatchPointer(surface, 'pointermove', { pointerId: 2, clientX: 140, clientY: 90 });
    flushRaf();

    expect(sockets[0].sentMessages).toEqual(['{"type":"mouseScroll","delta":-60}']);
  });

  it('scrolls horizontally when two fingers move sideways', async () => {
    const { surface, sockets, flushRaf } = await setupTouchpad();

    dispatchPointer(surface, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
    dispatchPointer(surface, 'pointerdown', { pointerId: 2, clientX: 100, clientY: 140 });
    dispatchPointer(surface, 'pointermove', { pointerId: 1, clientX: 90, clientY: 100 });
    dispatchPointer(surface, 'pointermove', { pointerId: 2, clientX: 90, clientY: 140 });
    flushRaf();

    expect(sockets[0].sentMessages).toEqual(['{"type":"mouseScroll","deltaX":-60}']);
  });

  it('clears pending movement on pointercancel', async () => {
    const { surface, sockets, flushRaf } = await setupTouchpad();

    dispatchPointer(surface, 'pointerdown', { pointerId: 1, clientX: 0, clientY: 0 });
    dispatchPointer(surface, 'pointermove', { pointerId: 1, clientX: 40, clientY: 0 });
    dispatchPointer(surface, 'pointercancel', { pointerId: 1, clientX: 40, clientY: 0 });
    flushRaf();

    expect(sockets[0].sentMessages).toEqual([]);
  });

  it('holds and releases the right-click button like a real mouse button', async () => {
    const { fixture, sockets } = await setupTouchpad();
    const rightClickButton = mouseButton(fixture, 'Rechtsklick');

    dispatchPointer(rightClickButton, 'pointerdown', { pointerId: 5, clientX: 0, clientY: 0 });

    expect(sockets[0].sentMessages).toEqual(['{"type":"mouseDown","button":"right"}']);

    dispatchPointer(rightClickButton, 'pointerup', { pointerId: 5, clientX: 0, clientY: 0 });

    expect(sockets[0].sentMessages).toEqual([
      '{"type":"mouseDown","button":"right"}',
      '{"type":"mouseUp","button":"right"}',
    ]);
  });

  it('holds and releases the middle-click button like a real mouse button', async () => {
    const { fixture, sockets } = await setupTouchpad();
    const middleClickButton = mouseButton(fixture, 'Mittelklick');

    dispatchPointer(middleClickButton, 'pointerdown', { pointerId: 7, clientX: 0, clientY: 0 });
    dispatchPointer(middleClickButton, 'pointerup', { pointerId: 7, clientX: 0, clientY: 0 });

    expect(sockets[0].sentMessages).toEqual([
      '{"type":"mouseDown","button":"middle"}',
      '{"type":"mouseUp","button":"middle"}',
    ]);
  });

  it('keeps the left button held while dragging on the touchpad surface, then releases it', async () => {
    const { fixture, surface, sockets, flushRaf } = await setupTouchpad();
    const leftClickButton = mouseButton(fixture, 'Linksklick');

    dispatchPointer(leftClickButton, 'pointerdown', { pointerId: 1, clientX: 0, clientY: 0 });
    expect(sockets[0].sentMessages).toEqual(['{"type":"mouseDown","button":"left"}']);

    dispatchPointer(surface, 'pointerdown', { pointerId: 2, clientX: 10, clientY: 10 });
    dispatchPointer(surface, 'pointermove', { pointerId: 2, clientX: 30, clientY: 10 });
    flushRaf();
    dispatchPointer(surface, 'pointerup', { pointerId: 2, clientX: 30, clientY: 10 });

    dispatchPointer(leftClickButton, 'pointerup', { pointerId: 1, clientX: 0, clientY: 0 });

    expect(sockets[0].sentMessages).toEqual([
      '{"type":"mouseDown","button":"left"}',
      '{"type":"mouseMove","deltaX":20,"deltaY":0}',
      '{"type":"mouseUp","button":"left"}',
    ]);
  });

  it('releases a held button on pointercancel so it never stays stuck down', async () => {
    const { fixture, sockets } = await setupTouchpad();
    const leftClickButton = mouseButton(fixture, 'Linksklick');

    dispatchPointer(leftClickButton, 'pointerdown', { pointerId: 1, clientX: 0, clientY: 0 });
    dispatchPointer(leftClickButton, 'pointercancel', { pointerId: 1, clientX: 0, clientY: 0 });

    expect(sockets[0].sentMessages).toEqual([
      '{"type":"mouseDown","button":"left"}',
      '{"type":"mouseUp","button":"left"}',
    ]);
  });

  it('releases any held button when the component is destroyed', async () => {
    const { fixture, sockets } = await setupTouchpad();
    const leftClickButton = mouseButton(fixture, 'Linksklick');

    dispatchPointer(leftClickButton, 'pointerdown', { pointerId: 1, clientX: 0, clientY: 0 });
    fixture.destroy();

    expect(sockets[0].sentMessages).toEqual([
      '{"type":"mouseDown","button":"left"}',
      '{"type":"mouseUp","button":"left"}',
    ]);
  });

  it('sends typed text and clears the input', async () => {
    const { fixture, sockets } = await setupTouchpad();
    const root = fixture.nativeElement as HTMLElement;
    const textInput = root.querySelector<HTMLInputElement>('.touchpad-text__input');
    const form = root.querySelector<HTMLFormElement>('.touchpad-text');

    expect(textInput).not.toBeNull();
    expect(form).not.toBeNull();

    textInput!.value = 'Hallo Welt!';
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(sockets[0].sentMessages).toEqual(['{"type":"text","text":"Hallo Welt!"}']);
    expect(textInput!.value).toBe('');
  });

  it('does not send anything when submitting an empty text field', async () => {
    const { fixture, sockets } = await setupTouchpad();
    const root = fixture.nativeElement as HTMLElement;
    const form = root.querySelector<HTMLFormElement>('.touchpad-text');

    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(sockets[0].sentMessages).toEqual([]);
  });
});

async function setupTouchpad(options: { readonly sensitivity?: number } = {}): Promise<TouchpadHarness> {
  const sockets: MockRemoteSocket[] = [];
  const storage = new MemoryStorage();
  const rafCallbacks: FrameRequestCallback[] = [];

  if (options.sensitivity !== undefined) {
    storage.setItem(MOUSE_SENSITIVITY_STORAGE_KEY, String(options.sensitivity));
  }

  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    rafCallbacks.push(callback);
    return rafCallbacks.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);

  await TestBed.configureTestingModule({
    imports: [TouchpadComponent],
    providers: [
      RemoteService,
      { provide: REMOTE_STORAGE, useValue: storage },
      { provide: REMOTE_AUTO_CONNECT, useValue: false },
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

  const fixture = TestBed.createComponent(TouchpadComponent);
  fixture.detectChanges();
  await fixture.whenStable();

  const surface = fixture.nativeElement.querySelector('.touchpad-surface') as HTMLElement | null;

  if (surface === null) {
    throw new Error('Touchpad surface not found');
  }

  stubPointerCapture(surface);

  return {
    fixture,
    surface,
    sockets,
    flushRaf: () => {
      const callbacks = rafCallbacks.splice(0, rafCallbacks.length);

      for (const callback of callbacks) {
        callback(performance.now());
      }

      fixture.detectChanges();
    },
  };
}

function mouseButton(
  fixture: ReturnType<typeof TestBed.createComponent<TouchpadComponent>>,
  ariaLabel: string,
): HTMLButtonElement {
  const root = fixture.nativeElement as HTMLElement;
  const button = root.querySelector<HTMLButtonElement>(`button[aria-label="${ariaLabel}"]`);

  if (button === null) {
    throw new Error(`Button with aria-label "${ariaLabel}" not found`);
  }

  stubPointerCapture(button);
  return button;
}

function stubPointerCapture(element: HTMLElement): void {
  Object.defineProperty(element, 'setPointerCapture', {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(element, 'releasePointerCapture', {
    configurable: true,
    value: () => undefined,
  });
}

function dispatchPointer(
  target: HTMLElement,
  type: string,
  init: { readonly pointerId: number; readonly clientX: number; readonly clientY: number },
): void {
  const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;

  Object.defineProperties(event, {
    pointerId: { value: init.pointerId },
    clientX: { value: init.clientX },
    clientY: { value: init.clientY },
    pointerType: { value: 'touch' },
  });

  target.dispatchEvent(event);
}
