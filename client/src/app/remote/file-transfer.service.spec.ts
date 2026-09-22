import { TestBed } from '@angular/core/testing';
import { FILE_TRANSFER_FETCH, FileTransferService } from './file-transfer.service';
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

interface FileTransferHarness {
  readonly fileTransfer: FileTransferService;
  readonly fakeFetch: FakeFetch;
}

function setupFileTransferService(
  options: { storedToken?: string | null; serverUrl?: string } = {},
): FileTransferHarness {
  const storage = new MemoryStorage();

  if (options.storedToken !== undefined && options.storedToken !== null) {
    storage.setItem(PAIRING_TOKEN_STORAGE_KEY, options.storedToken);
  }

  const fakeFetch = new FakeFetch();

  TestBed.configureTestingModule({
    providers: [
      FileTransferService,
      { provide: REMOTE_STORAGE, useValue: storage },
      { provide: PAIRING_FETCH, useValue: async () => new Response(null, { status: 500 }) },
      { provide: FILE_TRANSFER_FETCH, useValue: fakeFetch.fetch },
      {
        provide: SERVER_LOCATION,
        useValue: createServerLocation(options.serverUrl ?? 'http://192.168.1.44:5050/'),
      },
    ],
  });

  return {
    fileTransfer: TestBed.inject(FileTransferService),
    fakeFetch,
  };
}

describe('FileTransferService', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('does not send a request when the device is not paired', async () => {
    const { fileTransfer, fakeFetch } = setupFileTransferService();

    const result = await fileTransfer.sendFile(new File(['x'], 'a.txt'));

    expect(result.success).toBe(false);
    expect(fakeFetch.calls).toHaveLength(0);
  });

  it('uploads the file with a bearer token to the same-origin /files endpoint', async () => {
    const { fileTransfer, fakeFetch } = setupFileTransferService({ storedToken: 'tok-123' });
    fakeFetch.queueJson({ success: true, fileName: 'a.txt' });

    const result = await fileTransfer.sendFile(new File(['hallo'], 'a.txt'));

    expect(result).toEqual({ success: true, fileName: 'a.txt' });
    expect(fakeFetch.calls[0].url).toBe('http://192.168.1.44:5050/files');
    expect(fakeFetch.calls[0].init?.method).toBe('POST');
    expect(new Headers(fakeFetch.calls[0].init?.headers).get('Authorization')).toBe(
      'Bearer tok-123',
    );
    expect(fakeFetch.calls[0].init?.body).toBeInstanceOf(FormData);
  });

  it('surfaces the server error when the upload is rejected', async () => {
    const { fileTransfer, fakeFetch } = setupFileTransferService({ storedToken: 'tok-123' });
    fakeFetch.queueJson({ success: false, error: 'File is too large.' }, 413);

    const result = await fileTransfer.sendFile(new File(['x'], 'a.txt'));

    expect(result).toEqual({ success: false, error: 'File is too large.' });
  });

  it('reports failure without a server error when the request throws outright', async () => {
    const { fileTransfer, fakeFetch } = setupFileTransferService({ storedToken: 'tok-123' });
    fakeFetch.queueRejection('boom');

    const result = await fileTransfer.sendFile(new File(['x'], 'a.txt'));

    expect(result).toEqual({ success: false });
  });

  it('resets sending back to false after the upload finishes', async () => {
    const { fileTransfer, fakeFetch } = setupFileTransferService({ storedToken: 'tok-123' });
    fakeFetch.queueJson({ success: true, fileName: 'a.txt' });

    expect(fileTransfer.sending()).toBe(false);
    await fileTransfer.sendFile(new File(['x'], 'a.txt'));

    expect(fileTransfer.sending()).toBe(false);
  });
});
