import { TestBed } from '@angular/core/testing';
import {
  REMOTE_AUTO_CONNECT,
  REMOTE_STORAGE,
  REMOTE_WEBSOCKET_FACTORY,
  RemoteService,
  RemoteSocket,
} from './remote.service';
import { PAIRING_FETCH, PairingService } from './pairing.service';
import { PAIRING_TOKEN_STORAGE_KEY } from './pairing';
import { MOUSE_SENSITIVITY_STORAGE_KEY, SERVER_LOCATION, ServerLocation } from './server-config';

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

  constructor(url = 'http://localhost:5050/') {
    const parsedUrl = new URL(url);
    this.protocol = parsedUrl.protocol;
    this.hostname = parsedUrl.hostname;
    this.port = parsedUrl.port;
    this.origin = parsedUrl.origin;
  }

  assign(url: string): void {
    this.assignments.push(url);
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
  readonly serverLocation: FakeServerLocation;
}

interface RemoteServiceSetup {
  readonly autoConnect?: boolean;
  readonly storedPairingToken?: string;
  readonly serverUrl?: string;
}

/** `RemoteService`-Tests testen kein Pairing-HTTP-Verhalten; falls ein gespeichertes
 *  Token `PairingService` beim Start zu einem Verify-Aufruf veranlasst, wird dessen
 *  Fehlschlag von `PairingService.verify()` ohnehin abgefangen und ignoriert. */
const unusedPairingFetch = async (): Promise<Response> => {
  throw new Error('PAIRING_FETCH is not exercised by RemoteService tests.');
};

describe('RemoteService', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('derives the active config and socket URL from the page origin', () => {
    const { remote } = setupRemoteService();
    expect(remote.config()).toEqual({ host: 'localhost', port: 5050 });
    expect(remote.socketUrl()).toBe('ws://localhost:5050/ws');
  });

  it('uses the page protocol and configured page port for secure sockets', () => {
    const { remote } = setupRemoteService({ serverUrl: 'https://remote.example:7443/' });

    expect(remote.config()).toEqual({ host: 'remote.example', port: 7443 });
    expect(remote.socketUrl()).toBe('wss://remote.example:7443/ws');
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
        { provide: SERVER_LOCATION, useValue: new FakeServerLocation() },
        {
          provide: REMOTE_WEBSOCKET_FACTORY,
          useValue: (url: string) => new MockRemoteSocket(url),
        },
        { provide: PAIRING_FETCH, useValue: unusedPairingFetch },
      ],
    });

    const remote = TestBed.inject(RemoteService);

    expect(remote.mouseSensitivity()).toBe(1.5);
  });

  it('appends the pairing token to the socket URL when one is stored', () => {
    const { remote } = setupRemoteService({
      storedPairingToken: 'abc 123',
    });

    expect(remote.socketUrl()).toBe('ws://localhost:5050/ws?token=abc%20123');
  });

  it('re-verifies pairing on a socket close and clears a token the server has revoked', async () => {
    const storage = new MemoryStorage();
    storage.setItem(PAIRING_TOKEN_STORAGE_KEY, 'revoked-token');
    vi.useFakeTimers();

    const sockets: MockRemoteSocket[] = [];
    let verifyCallCount = 0;
    const verifyFetch = async (): Promise<Response> => {
      verifyCallCount += 1;
      // Erster Aufruf: PairingServices eigener Start-Check, der noch erfolgreich
      // ist. Erst der zweite Aufruf (ausgeloest durch den Socket-Close unten)
      // simuliert die Ablehnung durch den Server.
      return new Response(JSON.stringify({ valid: verifyCallCount === 1 }), { status: 200 });
    };

    TestBed.configureTestingModule({
      providers: [
        RemoteService,
        { provide: REMOTE_STORAGE, useValue: storage },
        { provide: REMOTE_AUTO_CONNECT, useValue: false },
        { provide: SERVER_LOCATION, useValue: new FakeServerLocation() },
        {
          provide: REMOTE_WEBSOCKET_FACTORY,
          useValue: (url: string) => {
            const socket = new MockRemoteSocket(url);
            sockets.push(socket);
            return socket;
          },
        },
        { provide: PAIRING_FETCH, useValue: verifyFetch },
      ],
    });

    const remote = TestBed.inject(RemoteService);
    const pairing = TestBed.inject(PairingService);

    // Den Start-Check des Konstruktors abwarten, bevor wir den eigentlichen Fall
    // (Ablehnung nach einem Verbindungsabbruch) provozieren.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(pairing.isPaired()).toBe(true);
    expect(remote.socketUrl()).toBe('ws://localhost:5050/ws?token=revoked-token');

    // Ab hier auf die konkrete, vom Socket-Close ausgeloeste verify()-Promise warten,
    // statt Microtask-Ticks zu erraten (Response.json() kann intern mehrere brauchen).
    const verifySpy = vi.spyOn(pairing, 'verify');

    remote.connect();
    expect(sockets).toHaveLength(1);

    sockets[0].closeFromServer();

    expect(verifySpy).toHaveBeenCalledTimes(1);
    await verifySpy.mock.results[0].value;

    expect(pairing.isPaired()).toBe(false);
    expect(pairing.token()).toBeNull();
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

  it('waits for each correlated macro response and stops after a rejection', async () => {
    const { remote, sockets } = setupRemoteService();
    remote.connect();
    sockets[0].open();

    const macro = remote.runSteps([
      { action: { type: 'key', keys: ['F5'] }, delayMs: 0 },
      { action: { type: 'key', keys: ['F11'] }, delayMs: 0 },
      { action: { type: 'key', keys: ['ESC'] }, delayMs: 0 },
    ]);

    expect(sockets[0].sentMessages).toHaveLength(1);
    const firstRequest = JSON.parse(sockets[0].sentMessages[0]) as { requestId: string };

    sockets[0].receive('{"requestId":"unrelated","success":true}');
    await Promise.resolve();
    expect(sockets[0].sentMessages).toHaveLength(1);

    sockets[0].receive(JSON.stringify({ requestId: firstRequest.requestId, success: true }));
    await Promise.resolve();
    expect(sockets[0].sentMessages).toHaveLength(2);

    const secondRequest = JSON.parse(sockets[0].sentMessages[1]) as { requestId: string };
    sockets[0].receive(
      JSON.stringify({
        requestId: secondRequest.requestId,
        success: false,
        error: 'Taste nicht erlaubt',
      }),
    );
    await macro;

    expect(sockets[0].sentMessages).toHaveLength(2);
    expect(remote.lastError()).toBe('Taste nicht erlaubt');
  });

  it('stops a macro when the server confirmation times out', async () => {
    const { remote, sockets } = setupRemoteService();
    remote.connect();
    sockets[0].open();

    const macro = remote.runSteps([
      { action: { type: 'key', keys: ['F5'] }, delayMs: 0 },
      { action: { type: 'key', keys: ['F11'] }, delayMs: 0 },
    ]);

    expect(sockets[0].sentMessages).toHaveLength(1);
    vi.advanceTimersByTime(4999);
    expect(sockets[0].sentMessages).toHaveLength(1);

    vi.advanceTimersByTime(1);
    await macro;

    expect(sockets[0].sentMessages).toHaveLength(1);
    expect(remote.lastError()).toBe('Keine Bestätigung vom Server erhalten.');
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

    expect(remote.lastError()).toBe('Ungültige Serverantwort.');
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

  it('navigates the page when switching to a different server', () => {
    const { remote, sockets, serverLocation } = setupRemoteService();

    remote.connect();

    expect(remote.saveConfig({ host: '  laptop.local ', port: 5050 })).toBe(true);

    expect(remote.config()).toEqual({ host: 'localhost', port: 5050 });
    expect(serverLocation.assignments).toEqual(['http://laptop.local:5050/']);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].closed).toBe(false);
  });

  it('reconnects in place when the active server address is unchanged', () => {
    const { remote, sockets, serverLocation } = setupRemoteService();

    remote.connect();

    expect(remote.saveConfig({ host: '  localhost ', port: 5050 })).toBe(true);

    expect(serverLocation.assignments).toEqual([]);
    expect(sockets[0].closed).toBe(true);
    expect(sockets[1].url).toBe('ws://localhost:5050/ws');
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
    const { remote, sockets, serverLocation } = setupRemoteService();

    expect(remote.saveConfig({ host: 'http://bad-host', port: 5050 })).toBe(false);

    expect(remote.config()).toEqual({ host: 'localhost', port: 5050 });
    expect(serverLocation.assignments).toEqual([]);
    expect(sockets).toHaveLength(0);
  });
});

function setupRemoteService(options: RemoteServiceSetup = {}): RemoteServiceHarness {
  vi.useFakeTimers();

  const sockets: MockRemoteSocket[] = [];
  const storage = new MemoryStorage();
  const serverLocation = new FakeServerLocation(options.serverUrl);

  if (options.storedPairingToken !== undefined) {
    storage.setItem(PAIRING_TOKEN_STORAGE_KEY, options.storedPairingToken);
  }

  TestBed.configureTestingModule({
    providers: [
      RemoteService,
      { provide: REMOTE_STORAGE, useValue: storage },
      { provide: REMOTE_AUTO_CONNECT, useValue: options.autoConnect ?? false },
      { provide: SERVER_LOCATION, useValue: serverLocation },
      {
        provide: REMOTE_WEBSOCKET_FACTORY,
        useValue: (url: string) => {
          const socket = new MockRemoteSocket(url);
          sockets.push(socket);
          return socket;
        },
      },
      { provide: PAIRING_FETCH, useValue: unusedPairingFetch },
    ],
  });

  return {
    remote: TestBed.inject(RemoteService),
    sockets,
    storage,
    serverLocation,
  };
}
