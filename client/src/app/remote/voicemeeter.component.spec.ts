import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { VoicemeeterMessage } from './remote.models';
import { RemoteService } from './remote.service';
import { VoicemeeterComponent } from './voicemeeter.component';

describe('VoicemeeterComponent', () => {
  function setup() {
    const remote = {
      voicemeeter: signal<VoicemeeterMessage | null>({
        type: 'voicemeeter',
        channels: [
          { id: 'Strip[3]', name: 'Voicemeeter VAIO', muted: false, gain: -6 },
          { id: 'Strip[4]', name: 'AUX', muted: true, gain: 0 },
          { id: 'Bus[0]', name: 'A1', muted: false, gain: -3 },
        ],
        routes: ['A1'],
      }),
      watchVoicemeeter: vi.fn(),
      setVoicemeeterParameter: vi.fn(),
    };
    TestBed.configureTestingModule({ providers: [{ provide: RemoteService, useValue: remote }] });
    const fixture = TestBed.createComponent(VoicemeeterComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const names = () =>
      [...element.querySelectorAll('.mixer-channel__name')].map((name) => name.textContent?.trim());
    const button = (label: string) =>
      element.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
    return { remote, fixture, element, names, button };
  }

  it('shows inputs first and switches to the buses', () => {
    const { remote, fixture, element, names } = setup();

    expect(remote.watchVoicemeeter).toHaveBeenCalledWith(true);
    expect(names()).toEqual(['Voicemeeter VAIO', 'AUX']);

    element.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1].click();
    fixture.detectChanges();

    expect(names()).toEqual(['A1']);
  });

  it('toggles mute and resets the fader to 0 dB', () => {
    const { remote, button } = setup();

    button('Voicemeeter VAIO stumm schalten').click();
    button('Voicemeeter VAIO auf 0 dB zurücksetzen').click();

    expect(remote.setVoicemeeterParameter.mock.calls).toEqual([
      ['Strip[3].Mute'],
      ['Strip[3].Gain', 0],
    ]);
    expect(button('AUX auf 0 dB zurücksetzen').disabled).toBe(true);
  });
});
