import { TestBed } from '@angular/core/testing';
import { PAIRING_FETCH, PairingService } from './pairing.service';
import { PAIRING_TOKEN_STORAGE_KEY } from './pairing';
import { REMOTE_STORAGE } from './remote.service';
import { SERVER_LOCATION, ServerLocation } from './server-config';

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

function createServerLocation(url: string): ServerLocation {
  const parsedUrl = new URL(url);
  return {
    protocol: parsedUrl.protocol,
    hostname: parsedUrl.hostname,
    port: parsedUrl.port,
    origin: parsedUrl.origin,
    assign: () => undefined,
  };
}

class FakeFetch {
  readonly calls: { url: string }[] = [];
  private readonly queue: Array<() => Promise<Response>> = [];

  queueJson(body: unknown, status = 200): void {
    this.queue.push(async () => new Response(JSON.stringify(body), { status }));
  }

  queueRejection(message = 'network error'): void {
    this.queue.push(async () => {
      throw new Error(message);
    });
  }

  readonly fetch = async (input: RequestInfo | URL): Promise<Response> => {
    this.calls.push({ url: String(input) });

    const next = this.queue.shift();
    if (!next) {
      throw new Error('FakeFetch: no queued response');
    }

    return next();
  };
}

interface PairingServiceHarness {
  readonly pairing: PairingService;
  readonly storage: MemoryStorage;
  readonly fakeFetch: FakeFetch;
}

function setupPairingService(
  options: { storedToken?: string; serverUrl?: string } = {},
): PairingServiceHarness {
  const storage = new MemoryStorage();

  if (options.storedToken !== undefined) {
    storage.setItem(PAIRING_TOKEN_STORAGE_KEY, options.storedToken);
  }

  const fakeFetch = new FakeFetch();

  TestBed.configureTestingModule({
    providers: [
      PairingService,
      { provide: REMOTE_STORAGE, useValue: storage },
      { provide: PAIRING_FETCH, useValue: fakeFetch.fetch },
      {
        provide: SERVER_LOCATION,
        useValue: createServerLocation(options.serverUrl ?? 'http://192.168.1.44:5050/'),
      },
    ],
  });

  return {
    pairing: TestBed.inject(PairingService),
    storage,
    fakeFetch,
  };
}

describe('PairingService', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('is not paired and makes no request when nothing is stored', () => {
    const { pairing, fakeFetch } = setupPairingService();

    expect(pairing.isPaired()).toBe(false);
    expect(pairing.token()).toBeNull();
    expect(fakeFetch.calls).toHaveLength(0);
  });

  it('pairs successfully and persists the token when remembered', async () => {
    const { pairing, storage, fakeFetch } = setupPairingService();
    fakeFetch.queueJson({ success: true, token: 'tok-123' });

    const result = await pairing.pair('123456', 'iPhone von Max', true);

    expect(result).toBe(true);
    expect(pairing.token()).toBe('tok-123');
    expect(pairing.isPaired()).toBe(true);
    expect(storage.getItem(PAIRING_TOKEN_STORAGE_KEY)).toBe('tok-123');
    expect(fakeFetch.calls[0].url).toBe('http://192.168.1.44:5050/pair');
  });

  it('pairs successfully but keeps the token in memory only when not remembered', async () => {
    const { pairing, storage, fakeFetch } = setupPairingService();
    fakeFetch.queueJson({ success: true, token: 'tok-456' });

    const result = await pairing.pair('123456', 'iPhone von Max', false);

    expect(result).toBe(true);
    expect(pairing.token()).toBe('tok-456');
    expect(storage.getItem(PAIRING_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it('uses the exact HTTPS page origin for pairing requests', async () => {
    const { pairing, fakeFetch } = setupPairingService({
      serverUrl: 'https://remote.example:7443/',
    });
    fakeFetch.queueJson({ success: true, token: 'secure-token' });

    await pairing.pair('123456', 'Tablet', false);

    expect(fakeFetch.calls[0].url).toBe('https://remote.example:7443/pair');
  });

  it('surfaces the server error and does not set a token on a wrong PIN', async () => {
    const { pairing, fakeFetch } = setupPairingService();
    fakeFetch.queueJson({ success: false, error: 'PIN ungültig.' });

    const result = await pairing.pair('000000', 'iPhone', true);

    expect(result).toBe(false);
    expect(pairing.token()).toBeNull();
    expect(pairing.lastError()).toBe('PIN ungültig.');
  });

  it('surfaces a generic error when the pairing request fails outright', async () => {
    const { pairing, fakeFetch } = setupPairingService();
    fakeFetch.queueRejection('boom');

    const result = await pairing.pair('123456', 'iPhone', true);

    expect(result).toBe(false);
    expect(pairing.token()).toBeNull();
    expect(pairing.lastError()).toContain('boom');
  });

  it('clears a stored token when the server explicitly rejects it', async () => {
    const { pairing, storage, fakeFetch } = setupPairingService({ storedToken: 'stale-token' });
    fakeFetch.queueJson({ valid: false });

    const result = await pairing.verify();

    expect(result).toBe(false);
    expect(pairing.token()).toBeNull();
    expect(storage.getItem(PAIRING_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it('keeps a stored token when verify fails due to a network error', async () => {
    const { pairing, storage, fakeFetch } = setupPairingService({ storedToken: 'good-token' });
    fakeFetch.queueRejection();

    const result = await pairing.verify();

    expect(result).toBe(true);
    expect(pairing.token()).toBe('good-token');
    expect(storage.getItem(PAIRING_TOKEN_STORAGE_KEY)).toBe('good-token');
  });
});
