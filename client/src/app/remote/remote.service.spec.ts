import { TestBed } from '@angular/core/testing';
import {
  REMOTE_AUTO_CONNECT,
  REMOTE_STORAGE,
  REMOTE_WEBSOCKET_FACTORY,
  RemoteService,
  RemoteSocket,
} from './remote.service';
import { MOUSE_SENSITIVITY_STORAGE_KEY, SERVER_CONFIG_STORAGE_KEY } from './server-config';

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
  throwOnSend = false;

  constructor(readonly url: string) {}

  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  receive(message: string): void {
    this.onmessage?.(new MessageEvent<string>('message', { data: message }));
  }

  fail(): void {
    this.onerror?.(new Event('error'));
  }

  closeFromServer(): void {
    this.readyState = 3;
    this.onclose?.(new Event('close') as CloseEvent);
  }

  send(data: string): void {
    if (this.throwOnSend) {
      throw new Error('socket blocked');
    }

    this.sentMessages.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
  }
}

interface RemoteServiceHarness {
  readonly remote: RemoteService;
  readonly sockets: MockRemoteSocket[];
  readonly storage: MemoryStorage;
}

interface RemoteServiceSetup {
  readonly autoConnect?: boolean;
  readonly storedConfig?: string;
}

describe('RemoteService', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('loads the default config when nothing valid is stored', () => {
    const { remote } = setupRemoteService({
      storedConfig: '{"host":"http://192.168.1.4","port":5050}',
    });

    expect(remote.config()).toEqual({ host: 'localhost', port: 5050 });
    expect(remote.socketUrl()).toBe('ws://localhost:5050/ws');
  });

  it('loads a stored host and port', () => {
    const { remote } = setupRemoteService({
      storedConfig: '{"host":"192.168.1.44","port":5050}',
    });

    expect(remote.config()).toEqual({ host: '192.168.1.44', port: 5050 });
    expect(remote.socketUrl()).toBe('ws://192.168.1.44:5050/ws');
  });

  it('loads a stored mouse sensitivity', () => {
    const storage = new MemoryStorage();
    storage.setItem(MOUSE_SENSITIVITY_STORAGE_KEY, '1.5');
    vi.useFakeTimers();

    TestBed.configureTestingModule({
      providers: [
        RemoteService,
        { provide: REMOTE_STORAGE, useValue: storage },
        { provide: REMOTE_AUTO_CONNECT, useValue: false },
        {
          provide: REMOTE_WEBSOCKET_FACTORY,
          useValue: (url: string) => new MockRemoteSocket(url),
        },
      ],
    });

    const remote = TestBed.inject(RemoteService);

    expect(remote.mouseSensitivity()).toBe(1.5);
  });

  it('auto-connects and tracks open state', () => {
    const { remote, sockets } = setupRemoteService({ autoConnect: true });

    expect(remote.status()).toBe('connecting');
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toBe('ws://localhost:5050/ws');

    sockets[0].open();

    expect(remote.status()).toBe('connected');
    expect(remote.lastError()).toBeNull();
  });

  it('sends exact JSON for keys, hotkeys and mouse actions', () => {
    const { remote, sockets } = setupRemoteService();

    remote.connect();
    sockets[0].open();

    expect(remote.sendAction({ type: 'hotkey', keys: ['CTRL', 'TAB'] })).toBe(true);
    expect(remote.sendAction({ type: 'key', keys: ['F11'] })).toBe(true);
    expect(remote.sendAction({ type: 'mouseMove', deltaX: 15, deltaY: -6 })).toBe(true);
    expect(remote.sendAction({ type: 'mouseClick', button: 'right' })).toBe(true);
    expect(remote.sendAction({ type: 'mouseScroll', delta: -120 })).toBe(true);
    expect(sockets[0].sentMessages).toEqual([
      '{"type":"hotkey","keys":["CTRL","TAB"]}',
      '{"type":"key","keys":["F11"]}',
      '{"type":"mouseMove","deltaX":15,"deltaY":-6}',
      '{"type":"mouseClick","button":"right"}',
      '{"type":"mouseScroll","delta":-120}',
    ]);
  });

  it('shows a short error instead of sending while disconnected', () => {
    const { remote } = setupRemoteService();

    expect(remote.sendAction({ type: 'key', keys: ['ENTER'] })).toBe(false);
    expect(remote.lastError()).toBe('Keine Verbindung zum Server.');

    vi.advanceTimersByTime(4200);

    expect(remote.lastError()).toBeNull();
  });

  it('handles failed and invalid server responses without crashing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { remote, sockets } = setupRemoteService();

    remote.connect();
    sockets[0].open();
    sockets[0].receive('{"success":false,"error":"Taste nicht erlaubt"}');

    expect(remote.lastError()).toBe('Taste nicht erlaubt');

    sockets[0].receive('kein json');

    expect(remote.lastError()).toBe('Ungueltige Serverantwort.');
    expect(warnSpy).toHaveBeenCalledWith('YFRemote: invalid server response', 'kein json');

    sockets[0].receive('{"success":true}');

    expect(remote.lastError()).toBeNull();
  });

  it('reconnects with increasing capped delays', () => {
    const { remote, sockets } = setupRemoteService();

    remote.connect();
    sockets[0].closeFromServer();

    expect(remote.status()).toBe('disconnected');

    vi.advanceTimersByTime(1999);
    expect(sockets).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);

    sockets[1].closeFromServer();
    vi.advanceTimersByTime(3999);
    expect(sockets).toHaveLength(2);

    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);

    sockets[2].closeFromServer();
    vi.advanceTimersByTime(6000);
    expect(sockets).toHaveLength(4);

    sockets[3].closeFromServer();
    vi.advanceTimersByTime(8000);
    expect(sockets).toHaveLength(5);

    sockets[4].closeFromServer();
    vi.advanceTimersByTime(10000);
    expect(sockets).toHaveLength(6);

    sockets[5].closeFromServer();
    vi.advanceTimersByTime(10000);
    expect(sockets).toHaveLength(7);
  });

  it('does not auto-reconnect after a manual disconnect', () => {
    const { remote, sockets } = setupRemoteService();

    remote.connect();
    remote.disconnect();
    vi.advanceTimersByTime(20000);

    expect(remote.status()).toBe('disconnected');
    expect(remote.manuallyDisconnected()).toBe(true);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].closed).toBe(true);
  });

  it('persists settings and reconnects with the new endpoint', () => {
    const { remote, sockets, storage } = setupRemoteService();

    remote.connect();

    expect(remote.saveConfig({ host: '  laptop.local ', port: 5050 })).toBe(true);

    expect(remote.config()).toEqual({ host: 'laptop.local', port: 5050 });
    expect(storage.getItem(SERVER_CONFIG_STORAGE_KEY)).toBe(
      '{"host":"laptop.local","port":5050}',
    );
    expect(sockets[0].closed).toBe(true);
    expect(sockets[1].url).toBe('ws://laptop.local:5050/ws');
  });

  it('persists and rejects mouse sensitivity settings', () => {
    const { remote, storage } = setupRemoteService();

    expect(remote.saveMouseSensitivity(4)).toBe(true);
    expect(remote.mouseSensitivity()).toBe(4);
    expect(storage.getItem(MOUSE_SENSITIVITY_STORAGE_KEY)).toBe('4');

    expect(remote.saveMouseSensitivity(4.25)).toBe(false);
    expect(remote.mouseSensitivity()).toBe(4);
    expect(storage.getItem(MOUSE_SENSITIVITY_STORAGE_KEY)).toBe('4');
  });

  it('rejects invalid settings without changing the active config', () => {
    const { remote, sockets, storage } = setupRemoteService();

    expect(remote.saveConfig({ host: 'http://bad-host', port: 5050 })).toBe(false);

    expect(remote.config()).toEqual({ host: 'localhost', port: 5050 });
    expect(storage.getItem(SERVER_CONFIG_STORAGE_KEY)).toBeNull();
    expect(sockets).toHaveLength(0);
  });
});

function setupRemoteService(options: RemoteServiceSetup = {}): RemoteServiceHarness {
  vi.useFakeTimers();

  const sockets: MockRemoteSocket[] = [];
  const storage = new MemoryStorage();

  if (options.storedConfig !== undefined) {
    storage.setItem(SERVER_CONFIG_STORAGE_KEY, options.storedConfig);
  }

  TestBed.configureTestingModule({
    providers: [
      RemoteService,
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
  });

  return {
    remote: TestBed.inject(RemoteService),
    sockets,
    storage,
  };
}
