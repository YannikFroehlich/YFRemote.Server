import { DOCUMENT } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ClipboardSyncService } from './clipboard-sync.service';
import {
  ClipboardService,
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

  function setup() {
    const remote = {
      clipboardSync: signal(true),
      clipboardSyncSupported: signal(true),
      status: signal<ConnectionStatus>('connected'),
      pcClipboard: signal<ClipboardPushMessage | null>(null),
    };
    const sent: string[] = [];
    const written: string[] = [];
    const device = { text: 'alt' };
    const document = new FakeDocument();

    TestBed.configureTestingModule({
      providers: [
        { provide: RemoteService, useValue: remote },
        {
          provide: ClipboardService,
          useValue: { sendText: async (text: string) => sent.push(text) && { success: true } },
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
        { provide: DOCUMENT, useValue: document },
      ],
    });

    TestBed.inject(ClipboardSyncService);
    TestBed.tick();
    return { remote, sent, written, device, document };
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve));

  it('sends text copied on the device when returning to the app, but not the old content', async () => {
    const { sent, device, document } = setup();
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
    const { remote, sent, written, device, document } = setup();
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
    const { remote, sent, written, document } = setup();
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
    const { remote, written, document } = setup();
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

  it('does nothing while sync is switched off', async () => {
    const { remote, sent, written, device, document } = setup();
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
});
