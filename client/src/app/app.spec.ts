import { TestBed } from '@angular/core/testing';
import { App } from './app';
import {
  REMOTE_AUTO_CONNECT,
  REMOTE_STORAGE,
  REMOTE_WEBSOCKET_FACTORY,
  RemoteSocket,
} from './remote/remote.service';
import { BUTTON_LAYOUT_STORAGE_KEY } from './remote/button-layout';
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

    queryButton(compiled, 'Nächster Tab').click();

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

    expect(sockets[0].sentMessages).toEqual([
      '{"type":"key","keys":["WIN"]}',
      '{"type":"text","text":"notepad"}',
    ]);
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

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        { provide: REMOTE_STORAGE, useValue: storage },
        { provide: REMOTE_AUTO_CONNECT, useValue: false },
        {
          provide: REMOTE_WEBSOCKET_FACTORY,
          useValue: (url: string) => new MockRemoteSocket(url),
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(App);
    expect(() => fixture.detectChanges()).not.toThrow();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(queryButton(compiled, 'Nächster Tab')).not.toBeNull();
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
