import { TestBed } from '@angular/core/testing';
import { KeyboardPadComponent } from './keyboard-pad.component';
import {
  REMOTE_AUTO_CONNECT,
  REMOTE_STORAGE,
  REMOTE_WEBSOCKET_FACTORY,
  RemoteService,
  RemoteSocket,
} from './remote.service';

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

interface KeyboardPadHarness {
  readonly root: HTMLElement;
  readonly sockets: MockRemoteSocket[];
  readonly remote: RemoteService;
  readonly detectChanges: () => void;
}

describe('KeyboardPadComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('sends a plain key when tapping a letter with no modifier armed', async () => {
    const { root, sockets } = await setupKeyboardPad();

    keyChip(root, 'A').click();

    expect(sockets[0].sentMessages).toEqual(['{"type":"key","keys":["A"]}']);
  });

  it('arms CTRL then sends a hotkey when C is tapped, and clears the armed modifier afterward', async () => {
    const { root, sockets, detectChanges } = await setupKeyboardPad();

    const ctrl = keyChip(root, 'CTRL');
    ctrl.click();
    detectChanges();

    expect(ctrl.getAttribute('aria-pressed')).toBe('true');

    keyChip(root, 'C').click();
    detectChanges();

    expect(sockets[0].sentMessages).toEqual(['{"type":"hotkey","keys":["CTRL","C"]}']);
    expect(ctrl.getAttribute('aria-pressed')).toBe('false');
  });

  it('tapping an armed modifier again de-arms it', async () => {
    const { root, sockets, detectChanges } = await setupKeyboardPad();

    const ctrl = keyChip(root, 'CTRL');
    ctrl.click();
    detectChanges();
    ctrl.click();
    detectChanges();

    expect(ctrl.getAttribute('aria-pressed')).toBe('false');

    keyChip(root, 'A').click();

    expect(sockets[0].sentMessages).toEqual(['{"type":"key","keys":["A"]}']);
  });

  it('disables arming a 4th modifier once three are armed', async () => {
    const { root, detectChanges } = await setupKeyboardPad();

    keyChip(root, 'CTRL').click();
    detectChanges();
    keyChip(root, 'SHIFT').click();
    detectChanges();
    keyChip(root, 'ALT').click();
    detectChanges();

    expect(keyChip(root, 'WIN').disabled).toBe(true);
  });

  it('clears armed modifiers without sending anything on reset', async () => {
    const { root, sockets, detectChanges } = await setupKeyboardPad();

    const ctrl = keyChip(root, 'CTRL');
    ctrl.click();
    detectChanges();

    queryButtonByText(root, 'Zurücksetzen').click();
    detectChanges();

    expect(sockets[0].sentMessages).toEqual([]);
    expect(ctrl.getAttribute('aria-pressed')).toBe('false');
  });

  it('does not send while disconnected', async () => {
    const { root, sockets } = await setupKeyboardPad({ connect: false });

    keyChip(root, 'A').click();

    expect(sockets[0].sentMessages).toEqual([]);
  });
});

async function setupKeyboardPad(
  options: { readonly connect?: boolean } = {},
): Promise<KeyboardPadHarness> {
  const connect = options.connect ?? true;
  const sockets: MockRemoteSocket[] = [];
  const storage = new MemoryStorage();

  await TestBed.configureTestingModule({
    imports: [KeyboardPadComponent],
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

  if (connect) {
    remote.connect();
    sockets[0].open();
  } else {
    remote.connect();
  }

  const fixture = TestBed.createComponent(KeyboardPadComponent);
  fixture.detectChanges();
  await fixture.whenStable();

  return {
    root: fixture.nativeElement as HTMLElement,
    sockets,
    remote,
    detectChanges: () => fixture.detectChanges(),
  };
}

function keyChip(root: HTMLElement, key: string): HTMLButtonElement {
  const button = queryButtonByText(root, key);
  return button;
}

function queryButtonByText(root: HTMLElement, text: string): HTMLButtonElement {
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button'));
  const match = buttons.find((button) => button.textContent?.trim() === text);

  if (match === undefined) {
    throw new Error(`Button with text "${text}" not found`);
  }

  return match;
}
