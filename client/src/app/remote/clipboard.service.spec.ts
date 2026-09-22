import { TestBed } from '@angular/core/testing';
import { CLIPBOARD_FETCH, ClipboardService } from './clipboard.service';
import { PAIRING_TOKEN_STORAGE_KEY } from './pairing';
import { PAIRING_FETCH } from './pairing.service';
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
  readonly calls: { url: string; init?: RequestInit }[] = [];
  private readonly queue: Array<() => Promise<Response>> = [];

  queueJson(body: unknown, status = 200): void {
    this.queue.push(async () => new Response(JSON.stringify(body), { status }));
  }

  queueRejection(message = 'network error'): void {
    this.queue.push(async () => {
      throw new Error(message);
    });
  }

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    this.calls.push({ url: String(input), init });

    const next = this.queue.shift();
    if (!next) {
      throw new Error('FakeFetch: no queued response');
    }

    return next();
  };
}

interface ClipboardHarness {
  readonly clipboard: ClipboardService;
  readonly fakeFetch: FakeFetch;
}

function setupClipboardService(
  options: { storedToken?: string | null; serverUrl?: string } = {},
): ClipboardHarness {
  const storage = new MemoryStorage();

  if (options.storedToken !== undefined && options.storedToken !== null) {
    storage.setItem(PAIRING_TOKEN_STORAGE_KEY, options.storedToken);
  }

  const fakeFetch = new FakeFetch();

  TestBed.configureTestingModule({
    providers: [
      ClipboardService,
      { provide: REMOTE_STORAGE, useValue: storage },
      { provide: PAIRING_FETCH, useValue: async () => new Response(null, { status: 500 }) },
      { provide: CLIPBOARD_FETCH, useValue: fakeFetch.fetch },
      {
        provide: SERVER_LOCATION,
        useValue: createServerLocation(options.serverUrl ?? 'http://192.168.1.44:5050/'),
      },
    ],
  });

  return {
    clipboard: TestBed.inject(ClipboardService),
    fakeFetch,
  };
}

describe('ClipboardService', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('does not send a request when the device is not paired', async () => {
    const { clipboard, fakeFetch } = setupClipboardService();

    const result = await clipboard.sendText('hallo');

    expect(result.success).toBe(false);
    expect(fakeFetch.calls).toHaveLength(0);
  });

  it('sends text as JSON with a bearer token to /clipboard/text', async () => {
    const { clipboard, fakeFetch } = setupClipboardService({ storedToken: 'tok-123' });
    fakeFetch.queueJson({ success: true });

    const result = await clipboard.sendText('Hallo Welt');

    expect(result).toEqual({ success: true });
    expect(fakeFetch.calls[0].url).toBe('http://192.168.1.44:5050/clipboard/text');
    const headers = new Headers(fakeFetch.calls[0].init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer tok-123');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(fakeFetch.calls[0].init?.body).toBe(JSON.stringify({ text: 'Hallo Welt' }));
  });

  it('sends an image as multipart form data with a bearer token to /clipboard/image', async () => {
    const { clipboard, fakeFetch } = setupClipboardService({ storedToken: 'tok-123' });
    fakeFetch.queueJson({ success: true });

    const result = await clipboard.sendImage(new File(['x'], 'bild.png', { type: 'image/png' }));

    expect(result).toEqual({ success: true });
    expect(fakeFetch.calls[0].url).toBe('http://192.168.1.44:5050/clipboard/image');
    expect(new Headers(fakeFetch.calls[0].init?.headers).get('Authorization')).toBe(
      'Bearer tok-123',
    );
    expect(fakeFetch.calls[0].init?.body).toBeInstanceOf(FormData);
  });

  it('surfaces the server error when the request is rejected', async () => {
    const { clipboard, fakeFetch } = setupClipboardService({ storedToken: 'tok-123' });
    fakeFetch.queueJson({ success: false, error: 'Text must not be empty.' }, 400);

    const result = await clipboard.sendText('');

    expect(result).toEqual({ success: false, error: 'Text must not be empty.' });
  });

  it('reports failure without a server error when the request throws outright', async () => {
    const { clipboard, fakeFetch } = setupClipboardService({ storedToken: 'tok-123' });
    fakeFetch.queueRejection('boom');

    const result = await clipboard.sendText('hallo');

    expect(result).toEqual({ success: false });
  });
});
