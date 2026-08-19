import { TestBed } from '@angular/core/testing';
import { App } from './app';
import {
  REMOTE_AUTO_CONNECT,
  REMOTE_STORAGE,
  REMOTE_WEBSOCKET_FACTORY,
  RemoteSocket,
} from './remote/remote.service';
import { MOUSE_SENSITIVITY_STORAGE_KEY, SERVER_CONFIG_STORAGE_KEY } from './remote/server-config';

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

interface AppHarness {
  readonly fixture: ReturnType<typeof TestBed.createComponent<App>>;
  readonly sockets: MockRemoteSocket[];
  readonly storage: MemoryStorage;
}

describe('App', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('creates the remote shell', async () => {
    const { fixture } = await setupApp();
    const app = fixture.componentInstance;
    const compiled = fixture.nativeElement as HTMLElement;

    expect(app).toBeTruthy();
    expect(compiled.querySelector('.brand-name')?.textContent?.trim()).toBe('Remote');
    expect(compiled.textContent).toContain('localhost:5050');
  });

  it('sends the next-tab hotkey from the UI', async () => {
    const { fixture, sockets } = await setupApp({ autoConnect: true });
    const compiled = fixture.nativeElement as HTMLElement;

    sockets[0].open();
    fixture.detectChanges();

    queryButton(compiled, 'Naechster Tab').click();

    expect(sockets[0].sentMessages).toEqual(['{"type":"hotkey","keys":["CTRL","TAB"]}']);
    expect(compiled.querySelector('.status-pill')?.textContent).toContain('Verbunden');
  });

  it('keeps media controls visible but disabled', async () => {
    const { fixture } = await setupApp();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(queryButton(compiled, 'Play Pause').disabled).toBe(true);
    expect(queryButton(compiled, 'Leiser').disabled).toBe(true);
    expect(queryButton(compiled, 'Lauter').disabled).toBe(true);
    expect(queryButton(compiled, 'Stumm').disabled).toBe(true);
  });

  it('switches to touchpad and sends mouse clicks through the existing socket', async () => {
    const { fixture, sockets } = await setupApp({ autoConnect: true });
    const compiled = fixture.nativeElement as HTMLElement;

    sockets[0].open();
    fixture.detectChanges();

    queryButtonByText(compiled, 'Touchpad').click();
    fixture.detectChanges();

    expect(queryButtonByText(compiled, 'Touchpad').getAttribute('aria-selected')).toBe('true');

    queryButton(compiled, 'Rechtsklick').click();

    expect(sockets[0].sentMessages).toEqual(['{"type":"mouseClick","button":"right"}']);
  });

  it('validates settings and persists a new endpoint', async () => {
    const { fixture, sockets, storage } = await setupApp({ autoConnect: true });
    const compiled = fixture.nativeElement as HTMLElement;

    queryButton(compiled, 'Einstellungen').click();
    fixture.detectChanges();

    const hostInput = queryInput(compiled, '#server-host');
    const portInput = queryInput(compiled, '#server-port');
    const sensitivityInput = queryInput(compiled, '#mouse-sensitivity');
    const saveButton = compiled.querySelector<HTMLButtonElement>('button[type="submit"]');

    expect(saveButton).not.toBeNull();

    hostInput.value = 'http://192.168.1.20';
    hostInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(saveButton?.disabled).toBe(true);

    hostInput.value = '192.168.1.20';
    hostInput.dispatchEvent(new Event('input'));
    portInput.value = '5050';
    portInput.dispatchEvent(new Event('input'));
    sensitivityInput.value = '1.5';
    sensitivityInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    saveButton?.click();
    fixture.detectChanges();

    expect(storage.getItem(SERVER_CONFIG_STORAGE_KEY)).toBe(
      '{"host":"192.168.1.20","port":5050}',
    );
    expect(storage.getItem(MOUSE_SENSITIVITY_STORAGE_KEY)).toBe('1.5');
    expect(sockets).toHaveLength(2);
    expect(sockets[0].closed).toBe(true);
    expect(sockets[1].url).toBe('ws://192.168.1.20:5050/ws');
  });
});

async function setupApp(options: { readonly autoConnect?: boolean } = {}): Promise<AppHarness> {
  const sockets: MockRemoteSocket[] = [];
  const storage = new MemoryStorage();

  await TestBed.configureTestingModule({
    imports: [App],
    providers: [
      { provide: REMOTE_STORAGE, useValue: storage },
      { provide: REMOTE_AUTO_CONNECT, useValue: options.autoConnect ?? false },
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

  const fixture = TestBed.createComponent(App);
  fixture.detectChanges();
  await fixture.whenStable();

  return {
    fixture,
    sockets,
    storage,
  };
}

function queryButton(root: HTMLElement, ariaLabel: string): HTMLButtonElement {
  const button = root.querySelector<HTMLButtonElement>(`button[aria-label="${ariaLabel}"]`);

  if (button === null) {
    throw new Error(`Button not found: ${ariaLabel}`);
  }

  return button;
}

function queryButtonByText(root: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) => candidate.textContent?.trim() === text,
  );

  if (button === undefined) {
    throw new Error(`Button not found: ${text}`);
  }

  return button;
}

function queryInput(root: HTMLElement, selector: string): HTMLInputElement {
  const input = root.querySelector<HTMLInputElement>(selector);

  if (input === null) {
    throw new Error(`Input not found: ${selector}`);
  }

  return input;
}
