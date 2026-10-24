import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { MixerComponent } from './mixer.component';
import { AppVolumesMessage, VoicemeeterMessage } from './remote.models';
import { RemoteService } from './remote.service';

describe('MixerComponent', () => {
  function setup(voicemeeterAvailable = true) {
    const remote = {
      apps: signal<AppVolumesMessage | null>({
        type: 'apps',
        apps: [
          { id: '4711', name: 'Spotify', volume: 80, muted: false },
          { id: 'system', name: 'System', volume: 100, muted: true },
        ],
      }),
      voicemeeterAvailable: signal(voicemeeterAvailable),
      voicemeeter: signal<VoicemeeterMessage | null>({
        type: 'voicemeeter',
        channels: [
          { id: 'Strip[3]', name: 'Voicemeeter VAIO', muted: false, gain: -6 },
          { id: 'Strip[4]', name: 'AUX', muted: true, gain: 0 },
          { id: 'Bus[0]', name: 'A1', muted: false, gain: -3 },
        ],
        routes: ['A1'],
      }),
      watchApps: vi.fn(),
      watchVoicemeeter: vi.fn(),
      setApp: vi.fn(),
      setAudioOutput: vi.fn(),
      setVoicemeeterParameter: vi.fn(),
    };
    TestBed.configureTestingModule({ providers: [{ provide: RemoteService, useValue: remote }] });
    const fixture = TestBed.createComponent(MixerComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const names = () =>
      [...element.querySelectorAll('.mixer-channel__name')].map((name) => name.textContent?.trim());
    const tabs = () => [...element.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const button = (label: string) =>
      element.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
    return { remote, fixture, names, tabs, button };
  }

  it('starts with the apps and switches to the Voicemeeter groups', () => {
    const { remote, fixture, names, tabs } = setup();

    expect(remote.watchApps).toHaveBeenCalledWith(true);
    expect(names()).toEqual(['Spotify', 'Systemklänge']);

    tabs()[1].click();
    fixture.detectChanges();
    expect(names()).toEqual(['Voicemeeter VAIO', 'AUX']);

    tabs()[2].click();
    fixture.detectChanges();
    expect(names()).toEqual(['A1']);
  });

  it('shows only the apps without Voicemeeter', () => {
    const { names, tabs } = setup(false);

    expect(tabs()).toEqual([]);
    expect(names()).toEqual(['Spotify', 'Systemklänge']);
  });

  it('mutes an app with its id', () => {
    const { remote, button } = setup();

    button('Spotify stumm schalten').click();

    expect(remote.setApp).toHaveBeenCalledWith('4711', { muted: true });
  });

  it('switches the output device, but only offers it with more than one', () => {
    const { remote, fixture } = setup();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('select')).toBeNull();

    remote.apps.set({
      type: 'apps',
      apps: [],
      outputs: [
        { id: 'speakers', name: 'Lautsprecher', default: true },
        { id: 'headset', name: 'Headset', default: false },
      ],
    });
    fixture.detectChanges();
    const select = element.querySelector('select')!;
    expect(select.value).toBe('speakers');

    select.value = 'headset';
    select.dispatchEvent(new Event('change'));

    expect(remote.setAudioOutput).toHaveBeenCalledWith('headset');
  });

  it('toggles a Voicemeeter channel and resets its fader to 0 dB', () => {
    const { remote, fixture, tabs, button } = setup();
    tabs()[1].click();
    fixture.detectChanges();

    button('Voicemeeter VAIO stumm schalten').click();
    button('Voicemeeter VAIO auf 0 dB zurücksetzen').click();

    expect(remote.setVoicemeeterParameter.mock.calls).toEqual([
      ['Strip[3].Mute'],
      ['Strip[3].Gain', 0],
    ]);
    expect(button('AUX auf 0 dB zurücksetzen').disabled).toBe(true);
  });
});
