import { TestBed } from '@angular/core/testing';
import { App } from './app';
import {
  REMOTE_AUTO_CONNECT,
  REMOTE_STORAGE,
  REMOTE_WEBSOCKET_FACTORY,
  RemoteSocket,
} from './remote/remote.service';
import { PAIRING_FETCH } from './remote/pairing.service';
import { PAIRING_HISTORY, PAIRING_TOKEN_STORAGE_KEY, PairingHistory } from './remote/pairing';
import { BUTTON_LAYOUT_STORAGE_KEY } from './remote/button-layout';
import { BUTTON_LAYOUT_PROFILES_STORAGE_KEY } from './remote/button-layout-profiles';
import {
  MOUSE_SENSITIVITY_STORAGE_KEY,
  SERVER_LOCATION,
  ServerLocation,
} from './remote/server-config';

async function alwaysValidPairingFetch(): Promise<Response> {
  return new Response(JSON.stringify({ valid: true }), { status: 200 });
}

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

class FakeServerLocation implements ServerLocation {
  readonly assignments: string[] = [];
  readonly protocol: string;
  readonly hostname: string;
  readonly port: string;
  readonly origin: string;
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;

  constructor(url = 'http://localhost:5050/') {
    const parsedUrl = new URL(url);
    this.protocol = parsedUrl.protocol;
    this.hostname = parsedUrl.hostname;
    this.port = parsedUrl.port;
    this.origin = parsedUrl.origin;
    this.pathname = parsedUrl.pathname;
    this.search = parsedUrl.search;
    this.hash = parsedUrl.hash;
  }

  assign(url: string): void {
    this.assignments.push(url);
  }
}

class RecordingPairingHistory implements PairingHistory {
  readonly replacements: string[] = [];

  replaceState(_data: unknown, _unused: string, url?: string | URL | null): void {
    if (url !== undefined && url !== null) {
      this.replacements.push(String(url));
    }
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

  receive(message: string): void {
    this.onmessage?.(new MessageEvent<string>('message', { data: message }));
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
  readonly serverLocation: FakeServerLocation;
  readonly pairingHistory: RecordingPairingHistory;
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

    queryButton(compiled, 'Nächster Tab').click();

    expect(sockets[0].sentMessages).toEqual(['{"type":"hotkey","keys":["CTRL","TAB"]}']);
    expect(compiled.querySelector('.status-pill')?.textContent).toContain('Verbunden');
  });

  it('sends Windows media keys from the media controls', async () => {
    const { fixture, sockets } = await setupApp({ autoConnect: true });
    const compiled = fixture.nativeElement as HTMLElement;

    sockets[0].open();
    fixture.detectChanges();

    queryButton(compiled, 'Play Pause').click();
    queryButton(compiled, 'Leiser').click();
    queryButton(compiled, 'Lauter').click();
    queryButton(compiled, 'Stumm').click();

    expect(sockets[0].sentMessages).toEqual([
      '{"type":"key","keys":["MEDIA_PLAY_PAUSE"]}',
      '{"type":"key","keys":["VOLUME_DOWN"]}',
      '{"type":"key","keys":["VOLUME_UP"]}',
      '{"type":"key","keys":["VOLUME_MUTE"]}',
    ]);
  });

  it('switches to touchpad and sends mouse clicks through the existing socket', async () => {
    const { fixture, sockets } = await setupApp({ autoConnect: true });
    const compiled = fixture.nativeElement as HTMLElement;

    sockets[0].open();
    fixture.detectChanges();

    queryButtonByText(compiled, 'Touchpad').click();
    fixture.detectChanges();

    expect(queryButtonByText(compiled, 'Touchpad').getAttribute('aria-selected')).toBe('true');

    const rightClickButton = queryButton(compiled, 'Rechtsklick');
    stubPointerCapture(rightClickButton);

    dispatchPointer(rightClickButton, 'pointerdown', { pointerId: 1, clientX: 0, clientY: 0 });
    dispatchPointer(rightClickButton, 'pointerup', { pointerId: 1, clientX: 0, clientY: 0 });

    expect(sockets[0].sentMessages).toEqual([
      '{"type":"mouseDown","button":"right"}',
      '{"type":"mouseUp","button":"right"}',
    ]);
  });

  it('switches to the keyboard tab and sends a hotkey through the existing socket', async () => {
    const { fixture, sockets } = await setupApp({ autoConnect: true });
    const compiled = fixture.nativeElement as HTMLElement;

    sockets[0].open();
    fixture.detectChanges();

    queryButtonByText(compiled, 'Tastatur').click();
    fixture.detectChanges();

    expect(queryButtonByText(compiled, 'Tastatur').getAttribute('aria-selected')).toBe('true');

    keyChip(compiled, 'CTRL').click();
    fixture.detectChanges();
    keyChip(compiled, 'S').click();

    expect(sockets[0].sentMessages).toEqual(['{"type":"hotkey","keys":["CTRL","S"]}']);
  });

  it('switches to touchpad and sends typed text through the existing socket', async () => {
    const { fixture, sockets } = await setupApp({ autoConnect: true });
    const compiled = fixture.nativeElement as HTMLElement;

    sockets[0].open();
    fixture.detectChanges();

    queryButtonByText(compiled, 'Touchpad').click();
    fixture.detectChanges();

    const textInput = compiled.querySelector<HTMLInputElement>('.touchpad-text__input');
    const form = compiled.querySelector<HTMLFormElement>('.touchpad-text');

    expect(textInput).not.toBeNull();

    textInput!.value = 'Guten Tag';
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(sockets[0].sentMessages).toEqual(['{"type":"text","text":"Guten Tag"}']);
  });

  it('validates settings and navigates to a new server endpoint', async () => {
    const { fixture, sockets, storage, serverLocation } = await setupApp({ autoConnect: true });
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

    expect(storage.getItem(MOUSE_SENSITIVITY_STORAGE_KEY)).toBe('1.5');
    expect(serverLocation.assignments).toEqual(['http://192.168.1.20:5050/']);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].closed).toBe(false);
  });

  it('creates a named layout profile from the settings dialog', async () => {
    const { fixture, storage } = await setupApp();
    const compiled = fixture.nativeElement as HTMLElement;

    queryButton(compiled, 'Einstellungen').click();
    fixture.detectChanges();

    const nameInput = queryInput(compiled, '#profile-name');
    nameInput.value = 'Präsentation';
    nameInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    queryButtonByText(compiled, 'Erstellen').click();
    fixture.detectChanges();

    const profileNames = Array.from(
      compiled.querySelectorAll<HTMLOptionElement>('#layout-profile option'),
    ).map((option) => option.textContent?.trim());
    expect(profileNames).toEqual(['Standard', 'Präsentation']);
    expect(storage.getItem(BUTTON_LAYOUT_PROFILES_STORAGE_KEY)).toContain('Präsentation');
  });

  it('revokes and clears the current device from the settings dialog', async () => {
    const fetchCalls: { readonly url: string; readonly method: string }[] = [];
    const pairingFetch = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const method = init?.method ?? 'GET';
      fetchCalls.push({ url: String(input), method });
      return method === 'DELETE'
        ? new Response(null, { status: 204 })
        : new Response(JSON.stringify({ valid: true }), { status: 200 });
    };
    const { fixture, sockets, storage } = await setupApp({
      autoConnect: true,
      pairingFetch,
    });
    const compiled = fixture.nativeElement as HTMLElement;

    queryButton(compiled, 'Einstellungen').click();
    fixture.detectChanges();
    queryButtonByText(compiled, 'Dieses Gerät entkoppeln').click();
    fixture.detectChanges();
    queryButtonByText(compiled, 'Entkoppeln').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fetchCalls.some((call) => call.method === 'DELETE')).toBe(true);
    expect(storage.getItem(PAIRING_TOKEN_STORAGE_KEY)).toBeNull();
    expect(sockets[0].closed).toBe(true);
    expect(compiled.querySelector('#pairing-pin')).not.toBeNull();
  });

  it('creates a custom hotkey button through the editor and sends it exactly once done', async () => {
    const { fixture, sockets } = await setupApp({ autoConnect: true });
    const compiled = fixture.nativeElement as HTMLElement;

    sockets[0].open();
    fixture.detectChanges();

    queryButton(compiled, 'Layout bearbeiten').click();
    fixture.detectChanges();

    queryButtonByText(compiled, 'Hinzufügen').click();
    fixture.detectChanges();

    const labelInput = queryInput(compiled, '#button-label');
    labelInput.value = 'Speichern';
    labelInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    keyChip(compiled, 'CTRL').click();
    keyChip(compiled, 'S').click();
    fixture.detectChanges();

    queryButtonByText(compiled, 'Schritt hinzufügen').click();
    fixture.detectChanges();

    queryButtonByText(compiled, 'Speichern').click();
    fixture.detectChanges();

    queryButton(compiled, 'Layout bearbeiten').click();
    fixture.detectChanges();

    queryButton(compiled, 'Speichern').click();

    expect(sockets[0].sentMessages).toEqual(['{"type":"hotkey","keys":["CTRL","S"]}']);
  });

  it('creates a two-step macro button through the editor and runs both steps in order', async () => {
    const { fixture, sockets } = await setupApp({ autoConnect: true });
    const compiled = fixture.nativeElement as HTMLElement;

    sockets[0].open();
    fixture.detectChanges();

    queryButton(compiled, 'Layout bearbeiten').click();
    fixture.detectChanges();

    queryButtonByText(compiled, 'Hinzufügen').click();
    fixture.detectChanges();

    const labelInput = queryInput(compiled, '#button-label');
    labelInput.value = 'Makro';
    labelInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    keyChip(compiled, 'WIN').click();
    fixture.detectChanges();
    queryButtonByText(compiled, 'Schritt hinzufügen').click();
    fixture.detectChanges();

    queryButtonByText(compiled, 'Text').click();
    fixture.detectChanges();
    const textInput = compiled.querySelector<HTMLInputElement>('.macro-text-input');
    if (textInput === null) throw new Error('text input not found');
    textInput.value = 'notepad';
    textInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    queryButtonByText(compiled, 'Schritt hinzufügen').click();
    fixture.detectChanges();

    queryButtonByText(compiled, 'Speichern').click();
    fixture.detectChanges();

    queryButton(compiled, 'Layout bearbeiten').click();
    fixture.detectChanges();

    queryButton(compiled, 'Makro').click();

    expect(sockets[0].sentMessages).toEqual(['{"requestId":"1","type":"key","keys":["WIN"]}']);

    sockets[0].receive('{"requestId":"1","success":true}');
    await Promise.resolve();

    expect(sockets[0].sentMessages).toEqual([
      '{"requestId":"1","type":"key","keys":["WIN"]}',
      '{"requestId":"2","type":"text","text":"notepad"}',
    ]);

    sockets[0].receive('{"requestId":"2","success":true}');
    await Promise.resolve();
  });

  it('hides a built-in button and persists the change across a reload', async () => {
    const { fixture, storage } = await setupApp();
    const compiled = fixture.nativeElement as HTMLElement;

    queryButton(compiled, 'Layout bearbeiten').click();
    fixture.detectChanges();

    const muteSlot = queryButton(compiled, 'Stumm').closest('.layout-slot');
    const removeButton = muteSlot?.querySelector<HTMLButtonElement>('.slot-remove');

    expect(removeButton).not.toBeNull();
    removeButton?.click();
    fixture.detectChanges();

    expect(compiled.querySelector('button[aria-label="Stumm"]')).toBeNull();

    const persisted = JSON.parse(storage.getItem(BUTTON_LAYOUT_STORAGE_KEY) ?? '{}');
    expect(persisted.hiddenBuiltInIds).toEqual(['mute']);
  });

  it('falls back to the default layout when stored data is malformed', async () => {
    const storage = new MemoryStorage();
    storage.setItem(BUTTON_LAYOUT_STORAGE_KEY, '{not valid json');
    storage.setItem(PAIRING_TOKEN_STORAGE_KEY, 'test-token');

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        { provide: REMOTE_STORAGE, useValue: storage },
        { provide: REMOTE_AUTO_CONNECT, useValue: false },
        { provide: SERVER_LOCATION, useValue: new FakeServerLocation() },
        {
          provide: REMOTE_WEBSOCKET_FACTORY,
          useValue: (url: string) => new MockRemoteSocket(url),
        },
        { provide: PAIRING_FETCH, useValue: alwaysValidPairingFetch },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(App);
    expect(() => fixture.detectChanges()).not.toThrow();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(queryButton(compiled, 'Nächster Tab')).not.toBeNull();
  });

  it('shows the pairing gate when no device token is stored', async () => {
    const { fixture } = await setupApp({ paired: false });
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('#pairing-pin')).not.toBeNull();
    expect(compiled.querySelector('.status-pill')).toBeNull();
  });

  it('prefills the pairing PIN from a QR-code fragment', async () => {
    const { fixture, pairingHistory } = await setupApp({
      paired: false,
      serverUrl: 'http://localhost:5050/#pin=123456',
    });
    const compiled = fixture.nativeElement as HTMLElement;

    expect(queryInput(compiled, '#pairing-pin').value).toBe('123456');
    expect(pairingHistory.replacements).toEqual(['/']);
  });

  it('pairs successfully through the gate and reveals the remote control', async () => {
    const fetchCalls: string[] = [];
    const pairFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      fetchCalls.push(String(input));
      return new Response(JSON.stringify({ success: true, token: 'fresh-token' }), {
        status: 200,
      });
    };

    const { fixture, storage } = await setupApp({ paired: false, pairingFetch: pairFetch });
    const compiled = fixture.nativeElement as HTMLElement;

    const pinInput = queryInput(compiled, '#pairing-pin');
    pinInput.value = '123456';
    pinInput.dispatchEvent(new Event('input'));

    const deviceNameInput = queryInput(compiled, '#pairing-device-name');
    deviceNameInput.value = 'Test-Handy';
    deviceNameInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    compiled
      .querySelector<HTMLFormElement>('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fetchCalls).toEqual(['http://localhost:5050/pair']);
    expect(compiled.querySelector('#pairing-pin')).toBeNull();
    expect(queryButton(compiled, 'Nächster Tab')).not.toBeNull();
    expect(storage.getItem(PAIRING_TOKEN_STORAGE_KEY)).toBe('fresh-token');
  });

  it('shows an error and stays gated on a wrong PIN', async () => {
    const pairFetch = async (): Promise<Response> =>
      new Response(JSON.stringify({ success: false, error: 'PIN ungültig.' }), { status: 200 });

    const { fixture } = await setupApp({ paired: false, pairingFetch: pairFetch });
    const compiled = fixture.nativeElement as HTMLElement;

    const pinInput = queryInput(compiled, '#pairing-pin');
    pinInput.value = '000000';
    pinInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    compiled
      .querySelector<HTMLFormElement>('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(compiled.querySelector('.toast')?.textContent).toContain('PIN ungültig.');
    expect(compiled.querySelector('#pairing-pin')).not.toBeNull();
  });
});

interface SetupAppOptions {
  readonly autoConnect?: boolean;
  readonly paired?: boolean;
  readonly pairingFetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  readonly serverUrl?: string;
}

async function setupApp(options: SetupAppOptions = {}): Promise<AppHarness> {
  const sockets: MockRemoteSocket[] = [];
  const storage = new MemoryStorage();
  const serverLocation = new FakeServerLocation(options.serverUrl);
  const pairingHistory = new RecordingPairingHistory();

  if (options.paired ?? true) {
    storage.setItem(PAIRING_TOKEN_STORAGE_KEY, 'test-token');
  }

  await TestBed.configureTestingModule({
    imports: [App],
    providers: [
      { provide: REMOTE_STORAGE, useValue: storage },
      { provide: REMOTE_AUTO_CONNECT, useValue: options.autoConnect ?? false },
      { provide: SERVER_LOCATION, useValue: serverLocation },
      { provide: PAIRING_HISTORY, useValue: pairingHistory },
      {
        provide: REMOTE_WEBSOCKET_FACTORY,
        useValue: (url: string) => {
          const socket = new MockRemoteSocket(url);
          sockets.push(socket);
          return socket;
        },
      },
      { provide: PAIRING_FETCH, useValue: options.pairingFetch ?? alwaysValidPairingFetch },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(App);
  fixture.detectChanges();
  await fixture.whenStable();

  return {
    fixture,
    sockets,
    storage,
    serverLocation,
    pairingHistory,
  };
}

function queryButton(root: HTMLElement, ariaLabel: string): HTMLButtonElement {
  const button = root.querySelector<HTMLButtonElement>(`button[aria-label="${ariaLabel}"]`);

  if (button === null) {
    throw new Error(`Button not found: ${ariaLabel}`);
  }

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

function queryButtonByText(root: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) => candidate.textContent?.trim() === text,
  );

  if (button === undefined) {
    throw new Error(`Button not found: ${text}`);
  }

  return button;
}

function keyChip(root: HTMLElement, key: string): HTMLButtonElement {
  const chip = Array.from(root.querySelectorAll<HTMLButtonElement>('.key-chip')).find(
    (candidate) => candidate.textContent?.trim() === key,
  );

  if (chip === undefined) {
    throw new Error(`Key chip not found: ${key}`);
  }

  return chip;
}

function queryInput(root: HTMLElement, selector: string): HTMLInputElement {
  const input = root.querySelector<HTMLInputElement>(selector);

  if (input === null) {
    throw new Error(`Input not found: ${selector}`);
  }

  return input;
}
