import { TestBed } from '@angular/core/testing';
import {
  DOWNLOAD_BRIDGE,
  DownloadBridge,
  FILE_SAVER,
  FILE_TRANSFER_FETCH,
  FILE_UPLOADER,
  FileTransferService,
  FileUploader,
} from './file-transfer.service';
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

class FakeUploader {
  readonly calls: { url: string; token: string; body: FormData }[] = [];
  private readonly queue: Array<(onProgress: (fraction: number) => void) => Promise<unknown>> = [];

  queueJson(body: unknown, status = 200): void {
    this.queue.push(async () => ({ status, body: JSON.stringify(body) }));
  }

  queueStep(step: (onProgress: (fraction: number) => void) => Promise<unknown>): void {
    this.queue.push(step);
  }

  queueRejection(message = 'network error'): void {
    this.queue.push(async () => {
      throw new Error(message);
    });
  }

  readonly upload: FileUploader = async (url, token, body, onProgress) => {
    this.calls.push({ url, token, body });

    const next = this.queue.shift();
    if (!next) {
      throw new Error('FakeUploader: no queued response');
    }

    return (await next(onProgress)) as Awaited<ReturnType<FileUploader>>;
  };
}

interface FileTransferHarness {
  readonly fileTransfer: FileTransferService;
  readonly fakeFetch: FakeFetch;
  readonly fakeUploader: FakeUploader;
  readonly saved: { blob: Blob; fileName: string }[];
}

function setupFileTransferService(
  options: {
    storedToken?: string | null;
    serverUrl?: string;
    downloadBridge?: DownloadBridge;
  } = {},
): FileTransferHarness {
  const storage = new MemoryStorage();

  if (options.storedToken !== undefined && options.storedToken !== null) {
    storage.setItem(PAIRING_TOKEN_STORAGE_KEY, options.storedToken);
  }

  const fakeFetch = new FakeFetch();
  const fakeUploader = new FakeUploader();
  const saved: { blob: Blob; fileName: string }[] = [];

  TestBed.configureTestingModule({
    providers: [
      FileTransferService,
      { provide: REMOTE_STORAGE, useValue: storage },
      { provide: PAIRING_FETCH, useValue: async () => new Response(null, { status: 500 }) },
      { provide: FILE_TRANSFER_FETCH, useValue: fakeFetch.fetch },
      { provide: FILE_UPLOADER, useValue: fakeUploader.upload },
      {
        provide: FILE_SAVER,
        useValue: async (blob: Blob, fileName: string) => saved.push({ blob, fileName }) > 0,
      },
      { provide: DOWNLOAD_BRIDGE, useValue: options.downloadBridge ?? null },
      {
        provide: SERVER_LOCATION,
        useValue: createServerLocation(options.serverUrl ?? 'http://192.168.1.44:5050/'),
      },
    ],
  });

  return {
    fileTransfer: TestBed.inject(FileTransferService),
    fakeFetch,
    fakeUploader,
    saved,
  };
}

describe('FileTransferService', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('does not send a request when the device is not paired', async () => {
    const { fileTransfer, fakeUploader } = setupFileTransferService();

    const result = await fileTransfer.sendFile(new File(['x'], 'a.txt'));

    expect(result.success).toBe(false);
    expect(fakeUploader.calls).toHaveLength(0);
  });

  it('uploads the file with a bearer token to the same-origin /files endpoint', async () => {
    const { fileTransfer, fakeUploader } = setupFileTransferService({ storedToken: 'tok-123' });
    fakeUploader.queueJson({ success: true, fileName: 'a.txt' });

    const result = await fileTransfer.sendFile(new File(['hallo'], 'a.txt'));

    expect(result).toEqual({ success: true, fileName: 'a.txt' });
    expect(fakeUploader.calls[0].url).toBe('http://192.168.1.44:5050/files');
    expect(fakeUploader.calls[0].token).toBe('tok-123');
    expect((fakeUploader.calls[0].body.get('file') as File).name).toBe('a.txt');
  });

  it('surfaces the server error when the upload is rejected', async () => {
    const { fileTransfer, fakeUploader } = setupFileTransferService({ storedToken: 'tok-123' });
    fakeUploader.queueJson({ success: false, error: 'File is too large.' }, 413);

    const result = await fileTransfer.sendFile(new File(['x'], 'a.txt'));

    expect(result).toEqual({ success: false, error: 'File is too large.' });
  });

  it('reports failure without a server error when the request throws outright', async () => {
    const { fileTransfer, fakeUploader } = setupFileTransferService({ storedToken: 'tok-123' });
    fakeUploader.queueRejection('boom');

    const result = await fileTransfer.sendFile(new File(['x'], 'a.txt'));

    expect(result).toEqual({ success: false });
    expect(fileTransfer.uploadProgress()).toBeNull();
  });

  it('tracks the upload progress and resets it after the upload finishes', async () => {
    const { fileTransfer, fakeUploader } = setupFileTransferService({ storedToken: 'tok-123' });
    const seen: (number | null)[] = [];
    fakeUploader.queueStep(async (onProgress) => {
      seen.push(fileTransfer.uploadProgress());
      onProgress(0.25);
      seen.push(fileTransfer.uploadProgress());
      onProgress(1.5);
      seen.push(fileTransfer.uploadProgress());
      return { status: 200, body: JSON.stringify({ success: true, fileName: 'a.txt' }) };
    });

    expect(fileTransfer.uploadProgress()).toBeNull();
    await fileTransfer.sendFile(new File(['x'], 'a.txt'));

    expect(seen).toEqual([0, 0.25, 1]);
    expect(fileTransfer.sending()).toBe(false);
    expect(fileTransfer.uploadProgress()).toBeNull();
  });

  it('downloads an offered file with the bearer token and hands it to the saver', async () => {
    const { fileTransfer, fakeFetch, saved } = setupFileTransferService({ storedToken: 'tok-123' });
    fakeFetch.queueJson('Vom PC');

    const downloaded = await fileTransfer.downloadFile({
      type: 'fileOffer',
      id: 'o1',
      name: 'notiz.txt',
      size: 8,
    });

    expect(downloaded).toBe(true);
    expect(fakeFetch.calls[0].url).toBe('http://192.168.1.44:5050/files/o1');
    expect(fakeFetch.calls[0].init?.headers).toEqual({ Authorization: 'Bearer tok-123' });
    expect(saved[0].fileName).toBe('notiz.txt');
    expect(fileTransfer.downloading()).toBe(false);
  });

  it('downloads a file from the PC folder by its encoded name', async () => {
    const { fileTransfer, fakeFetch, saved } = setupFileTransferService({ storedToken: 'tok-123' });
    fakeFetch.queueJson('Vom PC');

    const downloaded = await fileTransfer.downloadFolderFile('Bericht 1/2.pdf');

    expect(downloaded).toBe(true);
    expect(fakeFetch.calls[0].url).toBe('http://192.168.1.44:5050/folder/Bericht%201%2F2.pdf');
    expect(fakeFetch.calls[0].init?.headers).toEqual({ Authorization: 'Bearer tok-123' });
    expect(saved[0].fileName).toBe('Bericht 1/2.pdf');
  });

  it('reports a failed download without saving anything', async () => {
    const { fileTransfer, fakeFetch, saved } = setupFileTransferService({ storedToken: 'tok-123' });
    fakeFetch.queueJson(null, 404);

    const downloaded = await fileTransfer.downloadFile({
      type: 'fileOffer',
      id: 'alt',
      name: 'weg.txt',
      size: 1,
    });

    expect(downloaded).toBe(false);
    expect(saved).toEqual([]);
  });

  it('hands the download to the Android app bridge instead of fetching it', async () => {
    const calls: string[][] = [];
    const { fileTransfer, fakeFetch, saved } = setupFileTransferService({
      storedToken: 'tok-123',
      downloadBridge: {
        download: (url, token, fileName) => calls.push([url, token, fileName]) > 0,
      },
    });

    const downloaded = await fileTransfer.downloadFile({
      type: 'fileOffer',
      id: 'o1',
      name: 'notiz.txt',
      size: 8,
    });

    expect(downloaded).toBe(true);
    expect(calls).toEqual([['http://192.168.1.44:5050/files/o1', 'tok-123', 'notiz.txt']]);
    expect(fakeFetch.calls).toHaveLength(0);
    expect(saved).toEqual([]);
  });
});

describe('FILE_SAVER', () => {
  it('hands files to the app bridge as base64, because its WebView cannot save blob: links', async () => {
    const calls: unknown[][] = [];
    TestBed.configureTestingModule({
      providers: [
        {
          provide: DOWNLOAD_BRIDGE,
          useValue: {
            download: () => false,
            save: (...args: unknown[]) => calls.push(args) > 0,
          } satisfies DownloadBridge,
        },
      ],
    });

    const saved = await TestBed.inject(FILE_SAVER)(
      new Blob(['{"a":1}'], { type: 'application/json' }),
      'yfremote-stile.json',
    );

    expect(saved).toBe(true);
    expect(calls).toEqual([['yfremote-stile.json', 'application/json', btoa('{"a":1}')]]);
  });
});
