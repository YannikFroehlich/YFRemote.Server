import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaBridgeService, VolumeKeyDirection } from './media-bridge.service';
import { PresentationComponent, TALK_TARGET_STORAGE_KEY } from './presentation.component';
import { RemoteAction } from './remote.models';
import { REMOTE_STORAGE, REMOTE_VIBRATE, RemoteService } from './remote.service';

describe('PresentationComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  function setup(stored: Record<string, string> = {}) {
    const sent: RemoteAction[] = [];
    const vibrations: VibratePattern[] = [];
    const storage = new Map(Object.entries(stored));
    let handler: ((direction: VolumeKeyDirection) => void) | null = null;
    TestBed.configureTestingModule({
      imports: [PresentationComponent],
      providers: [
        {
          provide: REMOTE_STORAGE,
          useValue: {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
          },
        },
        { provide: REMOTE_VIBRATE, useValue: (pattern: VibratePattern) => vibrations.push(pattern) },
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
    return {
      fixture,
      element,
      sent,
      click,
      vibrations,
      storage,
      volume: (d: VolumeKeyDirection) => handler?.(d),
      handler: () => handler,
    };
  }

  it('warns before and at the target time, even from another tab', () => {
    vi.useFakeTimers();
    try {
      const { click, element, fixture, vibrations, storage } = setup({
        [TALK_TARGET_STORAGE_KEY]: '5',
      });
      const timer = () => element.querySelector('.presentation__timer');
      expect(element.querySelector('select')!.value).toBe('5');

      click('Starten');
      fixture.detectChanges();
      expect(timer()?.textContent?.trim()).toBe('0:00 / 5:00');

      // Bei 5 Minuten warnt der Timer eine Minute vorher.
      vi.advanceTimersByTime(240_000);
      fixture.detectChanges();
      expect(timer()?.classList).toContain('presentation__timer--warning');

      fixture.destroy();
      vi.advanceTimersByTime(60_000);
      TestBed.tick();
      expect(vibrations).toEqual([
        [200, 100, 200],
        [600, 200, 600],
      ]);

      const again = TestBed.createComponent(PresentationComponent);
      again.detectChanges();
      const el = again.nativeElement as HTMLElement;
      expect(el.querySelector('.presentation__timer')?.classList).toContain(
        'presentation__timer--over',
      );

      const select = el.querySelector('select')!;
      select.value = '0';
      select.dispatchEvent(new Event('change'));
      again.detectChanges();
      expect(storage.get(TALK_TARGET_STORAGE_KEY)).toBe('0');
      expect(el.querySelector('.presentation__timer')?.textContent?.trim()).toBe('5:00');
    } finally {
      vi.useRealTimers();
    }
  });

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

  it('times the talk from start to end, across tab switches', () => {
    vi.useFakeTimers();
    try {
      const { click, element, fixture } = setup();
      const timer = () => element.querySelector('.presentation__timer')?.textContent?.trim();
      expect(timer()).toBeUndefined();

      click('Starten');
      fixture.detectChanges();
      vi.advanceTimersByTime(65_000);
      fixture.detectChanges();
      expect(timer()).toBe('1:05');

      // Tabwechsel: die Komponente entsteht neu, der Timer laeuft weiter.
      fixture.destroy();
      const again = TestBed.createComponent(PresentationComponent);
      again.detectChanges();
      const el = again.nativeElement as HTMLElement;
      expect(el.querySelector('.presentation__timer')?.textContent?.trim()).toBe('1:05');

      el.querySelector<HTMLButtonElement>('.presentation__timer')!.click();
      again.detectChanges();
      expect(el.querySelector('.presentation__timer')?.textContent?.trim()).toBe('0:00');

      [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Beenden')!.click();
      again.detectChanges();
      expect(el.querySelector('.presentation__timer')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
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
