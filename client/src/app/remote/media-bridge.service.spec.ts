import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MEDIA_BRIDGE, MediaBridgeService } from './media-bridge.service';
import { ConnectionStatus, MediaStatusMessage, RemoteAction } from './remote.models';
import { RemoteService } from './remote.service';

describe('MediaBridgeService', () => {
  afterEach(() => TestBed.resetTestingModule());

  function setup() {
    const remote = {
      status: signal<ConnectionStatus>('connected'),
      mediaStatus: signal<MediaStatusMessage | null>(null),
      mediaCover: signal<string | null>(null),
      sent: [] as RemoteAction[],
      sendAction(action: RemoteAction) {
        this.sent.push(action);
        return true;
      },
    };
    const calls: string[] = [];
    const bridge = {
      update: (json: string) => calls.push(`update ${json}`),
      cover: (dataUrl: string) => calls.push(`cover ${dataUrl}`),
      clear: () => calls.push('clear'),
      captureVolumeKeys: (enabled: boolean) => calls.push(`capture ${enabled}`),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: RemoteService, useValue: remote },
        { provide: MEDIA_BRIDGE, useValue: bridge },
      ],
    });
    const service = TestBed.inject(MediaBridgeService);
    TestBed.tick();
    return { remote, calls, service };
  }

  const send = (detail: unknown) =>
    window.dispatchEvent(new CustomEvent('yfremote-media', { detail }));

  it('forwards the playing title and clears without one', () => {
    const { remote, calls } = setup();
    expect(calls).toEqual(['clear', 'cover ', 'capture true']);

    remote.mediaStatus.set({ type: 'media', muted: false, playing: true, title: 'Song', position: 3 });
    remote.mediaCover.set('data:image/png;base64,AA==');
    TestBed.tick();
    remote.mediaStatus.set({ type: 'media', muted: false, playing: false });
    TestBed.tick();

    expect(calls.slice(3)).toEqual([
      'update {"title":"Song","playing":true,"position":3}',
      'cover data:image/png;base64,AA==',
      'clear',
    ]);
  });

  it('sends only media keys and seeks from the notification', () => {
    const { remote } = setup();

    send({ type: 'key', key: 'MEDIA_NEXT' });
    send({ type: 'key', key: 'F4' });
    send({ type: 'seek', position: 61.6 });
    send({ type: 'seek', position: Number.NaN });

    expect(remote.sent).toEqual([
      { type: 'key', keys: ['MEDIA_NEXT'] },
      { type: 'mediaSeek', position: 62 },
    ]);
  });

  it('turns volume keys into PC volume unless a handler takes them', () => {
    const { remote, calls, service } = setup();
    const handled: string[] = [];

    send({ type: 'volume', direction: 'up' });
    service.setVolumeKeyHandler((direction) => handled.push(direction));
    send({ type: 'volume', direction: 'down' });
    service.setVolumeKeyHandler(null);
    send({ type: 'volume', direction: 'sideways' });
    remote.status.set('disconnected');
    TestBed.tick();

    expect(remote.sent).toEqual([{ type: 'key', keys: ['VOLUME_UP'] }]);
    expect(handled).toEqual(['down']);
    expect(calls.at(-1)).toBe('capture false');
  });
});
