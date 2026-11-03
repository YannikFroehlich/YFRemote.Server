import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { MediaBridgeService, VolumeKeyDirection } from './media-bridge.service';
import { PresentationComponent } from './presentation.component';
import { RemoteAction } from './remote.models';
import { RemoteService } from './remote.service';

describe('PresentationComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  function setup() {
    const sent: RemoteAction[] = [];
    let handler: ((direction: VolumeKeyDirection) => void) | null = null;
    TestBed.configureTestingModule({
      imports: [PresentationComponent],
      providers: [
        {
          provide: RemoteService,
          useValue: { mouseSensitivity: () => 1, sendAction: (action: RemoteAction) => sent.push(action) },
        },
        {
          provide: MediaBridgeService,
          useValue: {
            volumeKeysAvailable: true,
            setVolumeKeyHandler: (next: typeof handler) => (handler = next),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(PresentationComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const click = (label: string) =>
      [...element.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!.click();
    return { fixture, element, sent, click, volume: (d: VolumeKeyDirection) => handler?.(d), handler: () => handler };
  }

  it('turns slides with buttons and volume keys', () => {
    const { sent, click, volume, fixture, handler } = setup();

    click('Weiter');
    click('Zurück');
    click('Ab hier');
    click('Beenden');
    volume('up');
    volume('down');

    expect(sent).toEqual([
      { type: 'key', keys: ['RIGHT'] },
      { type: 'key', keys: ['LEFT'] },
      { type: 'hotkey', keys: ['SHIFT', 'F5'] },
      { type: 'key', keys: ['ESC'] },
      { type: 'key', keys: ['RIGHT'] },
      { type: 'key', keys: ['LEFT'] },
    ]);

    fixture.destroy();
    expect(handler()).toBeNull();
  });

  it('switches the laser pointer and shows the pad only while it is on', () => {
    const { sent, element, fixture } = setup();
    const laser = element.querySelector<HTMLButtonElement>('[role="switch"]')!;

    laser.click();
    fixture.detectChanges();
    expect(element.querySelector('.presentation__pad')).not.toBeNull();
    laser.click();
    fixture.detectChanges();

    expect(element.querySelector('.presentation__pad')).toBeNull();
    expect(sent).toEqual([
      { type: 'hotkey', keys: ['CTRL', 'L'] },
      { type: 'hotkey', keys: ['CTRL', 'A'] },
    ]);
  });
});
