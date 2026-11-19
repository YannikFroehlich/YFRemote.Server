import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ObsComponent } from './obs.component';
import { ObsMessage } from './remote.models';
import { RemoteService } from './remote.service';

describe('ObsComponent', () => {
  const connected: ObsMessage = {
    type: 'obs',
    state: 'connected',
    scenes: ['Live', 'Pause'],
    currentScene: 'Live',
    streaming: true,
    recording: false,
    recordPaused: false,
    inputs: [{ name: 'Mic/Aux', muted: true }],
  };

  afterEach(() => vi.unstubAllGlobals());

  function setup(status: ObsMessage | null = connected) {
    const remote = {
      obs: signal<ObsMessage | null>(status),
      watchObs: vi.fn(),
      sendAction: vi.fn(() => true),
      setObsScene: vi.fn(),
      toggleObsMute: vi.fn(),
    };
    TestBed.configureTestingModule({ providers: [{ provide: RemoteService, useValue: remote }] });
    const fixture = TestBed.createComponent(ObsComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const buttonWithText = (text: string) =>
      [...element.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent?.trim() === text,
      )!;
    return { remote, fixture, element, buttonWithText };
  }

  it('watches OBS while open and shows a hint instead of controls when it is not reachable', () => {
    const { remote, fixture, element } = setup({ ...connected, state: 'disabled' });

    expect(remote.watchObs).toHaveBeenCalledWith(true);
    expect(element.querySelector('.stats-waiting')?.textContent).toContain('WebSocket-Server');
    expect(element.querySelector('.obs-scene')).toBeNull();

    fixture.destroy();
    expect(remote.watchObs).toHaveBeenLastCalledWith(false);
  });

  it('marks the current scene and switches scenes', () => {
    const { remote, element, buttonWithText } = setup();
    const active = element.querySelector('.obs-scene--active');

    expect(active?.textContent?.trim()).toBe('Live');
    buttonWithText('Pause').click();

    expect(remote.setObsScene).toHaveBeenCalledWith('Pause');
  });

  it('stops a running stream only after confirmation and starts the recording explicitly', () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    const { remote, buttonWithText } = setup();

    buttonWithText('Stream beenden').click();
    expect(remote.sendAction).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    buttonWithText('Stream beenden').click();
    buttonWithText('Aufnahme starten').click();

    expect(remote.sendAction.mock.calls).toEqual([
      [{ type: 'obsStream', mode: 'stop' }],
      [{ type: 'obsRecord', mode: 'start' }],
    ]);
  });

  it('pauses a running recording and toggles an audio input', () => {
    const { remote, fixture, element, buttonWithText } = setup();
    remote.obs.set({ ...connected, recording: true });
    fixture.detectChanges();

    buttonWithText('Pausieren').click();
    element.querySelector<HTMLButtonElement>('button[aria-label="Mic/Aux stumm schalten"]')!.click();

    expect(remote.sendAction).toHaveBeenCalledWith({ type: 'obsRecord', mode: 'pause' });
    expect(remote.toggleObsMute).toHaveBeenCalledWith('Mic/Aux');
  });
});
