import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { OpenWindow, ServerPlatform, SystemStatsMessage } from './remote.models';
import { RemoteService } from './remote.service';
import { SystemStatsComponent } from './system-stats.component';

describe('SystemStatsComponent', () => {
  async function setup(
    platform: ServerPlatform,
    windows: readonly OpenWindow[] | null,
    mediaOnly = false,
    stats: SystemStatsMessage | null = null,
  ) {
    const remote = {
      systemStats: signal(stats),
      serverPlatform: signal(platform),
      mediaOnly: signal(mediaOnly),
      watchSystemStats: vi.fn(),
      readWindows: vi.fn(() => Promise.resolve(windows)),
      sendAction: vi.fn(() => true),
    };
    TestBed.configureTestingModule({ providers: [{ provide: RemoteService, useValue: remote }] });
    const fixture = TestBed.createComponent(SystemStatsComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const titles = () =>
      [...element.querySelectorAll('.window-list__title')].map((title) => title.textContent?.trim());
    return { remote, fixture, element, titles };
  }

  it('lists the windows of a Windows PC and brings one to the front', async () => {
    const { remote, fixture, element, titles } = await setup('windows', [
      { id: '1', title: 'Dokument - Editor', app: 'Editor' },
      { id: '2', title: 'YouTube - Google Chrome', app: 'Google Chrome' },
    ]);

    expect(titles()).toEqual(['Dokument - Editor', 'YouTube - Google Chrome']);

    element.querySelectorAll<HTMLButtonElement>('.window-list__item')[1].click();
    fixture.detectChanges();

    expect(remote.sendAction).toHaveBeenCalledWith({ type: 'focusWindow', id: '2' });
    expect(titles()).toEqual(['YouTube - Google Chrome', 'Dokument - Editor']);
  });

  it('says so when the PC does not answer and hides the list on Linux', async () => {
    const windowsPc = await setup('windows', null);
    expect(windowsPc.element.textContent).toContain('Fensterliste nicht verfügbar');

    TestBed.resetTestingModule();
    const linuxPc = await setup('linux', []);
    expect(linuxPc.element.querySelector('.window-list')).toBeNull();
    expect(linuxPc.remote.readWindows).not.toHaveBeenCalled();

    TestBed.resetTestingModule();
    const mediaOnly = await setup('windows', [], true);
    expect(mediaOnly.element.querySelector('.window-list')).toBeNull();
    expect(mediaOnly.remote.readWindows).not.toHaveBeenCalled();
  });

  it('shows memory and battery instead of CPU and GPU on the Android server', async () => {
    const { element } = await setup('android', null, false, {
      type: 'systemStats',
      memoryUsedMb: 6144,
      memoryTotalMb: 12288,
      batteryLevel: 87,
      batteryCharging: true,
      batteryTemperature: 31,
    });

    const tiles = [...element.querySelectorAll('.stats-tile')].map((tile) =>
      [...tile.querySelectorAll('.stats-tile__head span, .stats-tile__detail')].map((part) =>
        part.textContent?.trim(),
      ),
    );
    expect(tiles).toEqual([
      ['Arbeitsspeicher', '50 %', '6.0 / 12.0 GB'],
      ['Akku', '87 %', 'lädt · 31 °C'],
    ]);
    expect(element.querySelector('.window-list')).toBeNull();
  });
});
