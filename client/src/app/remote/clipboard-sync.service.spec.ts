import { DOCUMENT } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ClipboardSyncService } from './clipboard-sync.service';
import {
  CLIPBOARD_AUTO_SYNC_PROBE,
  ClipboardService,
  DEVICE_CLIPBOARD_IMAGE_WRITER,
  DEVICE_CLIPBOARD_READER,
  DEVICE_CLIPBOARD_WRITER,
} from './clipboard.service';
import { ClipboardPushMessage, ConnectionStatus } from './remote.models';
import { RemoteService } from './remote.service';

class FakeDocument {
  focused = true;
  visibilityState: DocumentVisibilityState = 'visible';
  private readonly listeners: (() => void)[] = [];
  readonly defaultView = { addEventListener: (_: string, listener: () => void) => this.listeners.push(listener) };

  hasFocus(): boolean {
    return this.focused;
  }

  addEventListener(_: string, listener: () => void): void {
    this.listeners.push(listener);
  }

  /** Wie das Zurückkehren in die App: Fokus und Sichtbarkeit lösen beide aus. */
  returnToApp(): void {
    this.focused = true;
    this.listeners.forEach((listener) => listener());
  }
}

describe('ClipboardSyncService', () => {
  afterEach(() => TestBed.resetTestingModule());

  async function setup(autoSync = true) {
    const remote = {
      clipboardSync: signal(true),
      clipboardSyncSupported: signal(true),
      status: signal<ConnectionStatus>('connected'),
      pcClipboard: signal<ClipboardPushMessage | null>(null),
    };
    const sent: (string | Blob)[] = [];
    const written: (string | Blob)[] = [];
    const device: { text: string | Blob } = { text: 'alt' };
    const pcImage = { blob: new Blob(['png vom PC'], { type: 'image/png' }), reads: 0 };
    const document = new FakeDocument();

    TestBed.configureTestingModule({
      providers: [
        { provide: RemoteService, useValue: remote },
        {
          provide: ClipboardService,
          useValue: {
            sendText: async (text: string) => sent.push(text) && { success: true },
            sendImage: async (image: Blob) => sent.push(image) && { success: true, imageId: '9' },
            readImage: async () => {
              pcImage.reads++;
              return { success: true, image: pcImage.blob };
            },
          },
        },
        {
          provide: DEVICE_CLIPBOARD_IMAGE_WRITER,
          useValue: async (image: Blob) => {
            written.push(image);
            // Der Browser kodiert das Bild beim Ablegen neu.
            device.text = new Blob(['neu kodiert'], { type: 'image/png' });
          },
        },
        {
          provide: DEVICE_CLIPBOARD_WRITER,
          useValue: async (text: string) => {
            if (!document.focused) {
              throw new Error('Document is not focused.');
            }
            written.push(text);
            device.text = text;
          },
        },
        { provide: DEVICE_CLIPBOARD_READER, useValue: async () => device.text },
        { provide: CLIPBOARD_AUTO_SYNC_PROBE, useValue: async () => autoSync },
        { provide: DOCUMENT, useValue: document },
      ],
    });

    const service = TestBed.inject(ClipboardSyncService);
    TestBed.tick();
    await settle();
    TestBed.tick();
    return { remote, sent, written, device, document, service, pcImage };
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve));

  it('sends text copied on the device when returning to the app, but not the old content', async () => {
    const { sent, device, document } = await setup();
    await settle();

    document.returnToApp();
    await settle();
    expect(sent).toEqual([]);

    device.text = 'neu kopiert';
    document.returnToApp();
    await settle();

    expect(sent).toEqual(['neu kopiert']);
  });

  it('does not write the PC echo of text the device just sent', async () => {
    const { remote, sent, written, device, document } = await setup();
    await settle();
    device.text = 'vom Gerät';
    document.returnToApp();
    await settle();

    remote.pcClipboard.set({ type: 'clipboard', text: 'vom Gerät' });
    TestBed.tick();
    await settle();

    expect(sent).toEqual(['vom Gerät']);
    expect(written).toEqual([]);
  });

  it('writes PC text to the device and does not echo it back', async () => {
    const { remote, sent, written, document } = await setup();
    await settle();

    remote.pcClipboard.set({ type: 'clipboard', text: 'vom PC' });
    TestBed.tick();
    await settle();
    document.returnToApp();
    await settle();

    expect(written).toEqual(['vom PC']);
    expect(sent).toEqual([]);
  });

  it('keeps PC text until the app has focus again', async () => {
    const { remote, written, document } = await setup();
    await settle();
    document.focused = false;

    remote.pcClipboard.set({ type: 'clipboard', text: 'später' });
    TestBed.tick();
    await settle();
    expect(written).toEqual([]);

    document.returnToApp();
    await settle();

    expect(written).toEqual(['später']);
  });

  it('writes a PC image to the device and does not send it back', async () => {
    const { remote, sent, written, document, pcImage } = await setup();
    await settle();

    remote.pcClipboard.set({ type: 'clipboard', imageId: '7' });
    TestBed.tick();
    await settle();
    document.returnToApp();
    await settle();

    expect(written).toEqual([pcImage.blob]);
    expect(sent).toEqual([]);
  });

  it('sends an image copied on the device and skips the PC echo of it', async () => {
    const { remote, sent, device, document, pcImage } = await setup();
    await settle();
    const image = new Blob(['bildschirmfoto'], { type: 'image/png' });
    device.text = image;
    document.returnToApp();
    // Die Meldung des PCs kommt, bevor die Antwort auf das Senden da ist.
    remote.pcClipboard.set({ type: 'clipboard', imageId: '9' });
    TestBed.tick();
    await settle();

    expect(sent).toEqual([image]);
    expect(pcImage.reads).toBe(0);
  });

  it('sends pasted content once, also right after connecting', async () => {
    const { sent, service } = await setup();
    await settle();

    await service.syncPasted('eingefügt');
    await service.syncPasted('eingefügt');

    expect(sent).toEqual(['eingefügt']);
  });

  it('does nothing while sync is switched off', async () => {
    const { remote, sent, written, device, document } = await setup();
    await settle();
    remote.clipboardSync.set(false);
    TestBed.tick();

    remote.pcClipboard.set({ type: 'clipboard', text: 'vom PC' });
    TestBed.tick();
    device.text = 'neu';
    document.returnToApp();
    await settle();

    expect(written).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('stays off in a browser that only allows clipboard access on a tap (Safari)', async () => {
    const { remote, sent, written, device, document, service } = await setup(false);

    expect(service.available()).toBe(false);
    remote.pcClipboard.set({ type: 'clipboard', text: 'vom PC' });
    TestBed.tick();
    device.text = 'neu';
    document.returnToApp();
    await settle();

    expect(written).toEqual([]);
    expect(sent).toEqual([]);
  });
});
