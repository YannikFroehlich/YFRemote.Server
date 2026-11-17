import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { FileTransferService } from './file-transfer.service';
import {
  FolderFile,
  MonitorBrightness,
  ProcessInfo,
  OpenWindow,
  ServerPlatform,
  SystemStatsMessage,
} from './remote.models';
import { RemoteService } from './remote.service';
import { SystemStatsComponent } from './system-stats.component';

describe('SystemStatsComponent', () => {
  async function setup(
    platform: ServerPlatform,
    windows: readonly OpenWindow[] | null,
    mediaOnly = false,
    stats: SystemStatsMessage | null = null,
    brightness: readonly MonitorBrightness[] = [],
    folder: readonly FolderFile[] | null = null,
    processes: readonly ProcessInfo[] | null = null,
  ) {
    const remote = {
      systemStats: signal(stats),
      serverPlatform: signal(platform),
      mediaOnly: signal(mediaOnly),
      watchSystemStats: vi.fn(),
      readWindows: vi.fn(() => Promise.resolve(windows)),
      readBrightness: vi.fn(() => Promise.resolve(brightness)),
      sendAction: vi.fn(() => true),
      setPowerMode: vi.fn(),
      setDisplayMode: vi.fn(),
      setMicMuted: vi.fn(),
      readFolder: vi.fn(() => Promise.resolve(folder)),
      readProcesses: vi.fn(() => Promise.resolve(processes)),
    };
    const fileTransfer = { downloadFolderFile: vi.fn(() => Promise.resolve(true)) };
    TestBed.configureTestingModule({
      providers: [
        { provide: RemoteService, useValue: remote },
        { provide: FileTransferService, useValue: fileTransfer },
      ],
    });
    const fixture = TestBed.createComponent(SystemStatsComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const titles = () =>
      [...element.querySelectorAll('.window-list__title')].map((title) =>
        title.textContent?.trim(),
      );
    return { remote, fileTransfer, fixture, element, titles };
  }

  const stats: SystemStatsMessage = { type: 'systemStats', memoryUsedMb: 1, memoryTotalMb: 2 };

  it('ends the process of a window only after the confirmation', async () => {
    const { remote, fixture, element, titles } = await setup('windows', [
      { id: '1', title: 'Dokument - Editor', app: 'Editor' },
    ]);
    const kill = element.querySelector<HTMLButtonElement>(
      '.window-list__action[aria-label="Prozess von Dokument - Editor beenden"]',
    )!;
    const confirm = vi.spyOn(globalThis, 'confirm').mockReturnValueOnce(false);

    kill.click();
    expect(remote.sendAction).not.toHaveBeenCalled();

    confirm.mockReturnValueOnce(true);
    kill.click();
    fixture.detectChanges();

    expect(remote.sendAction).toHaveBeenCalledWith({ type: 'killWindow', id: '1' });
    expect(titles()).toEqual([]);
    confirm.mockRestore();
  });

  it('shows drives and the network rate, and ends a process after the confirmation', async () => {
    const { remote, fixture, element } = await setup(
      'windows',
      [],
      false,
      {
        ...stats,
        drives: [{ name: 'C:', freeMb: 25 * 1024, totalMb: 100 * 1024 }],
        netDownKbps: 12_340,
        netUpKbps: 850,
      },
      [],
      null,
      [{ id: 42, name: 'notepad', cpu: 3, memoryMb: 20 }],
    );
    const tiles = [...element.querySelectorAll('.stats-tile')].map((tile) =>
      tile.textContent?.replace(/\s+/g, ' ').trim(),
    );

    const drive = tiles.find((tile) => tile?.startsWith('C:'));
    const network = tiles.find((tile) => tile?.startsWith('Netzwerk'));

    expect(drive).toContain('75 %');
    expect(drive).toContain('25.0 GB frei von 100.0 GB');
    expect(network).toContain('↓ 12.3 Mbit/s');
    expect(network).toContain('↑ 850 kbit/s');
    const networkTile = [...element.querySelectorAll('.stats-tile')].find((tile) =>
      tile.textContent?.includes('Netzwerk'),
    );
    expect(networkTile?.querySelector('.stats-bar')).toBeNull();
    const driveTile = [...element.querySelectorAll('.stats-tile')].find((tile) =>
      tile.textContent?.includes('C:'),
    );
    expect(driveTile?.querySelector('.stats-bar')).not.toBeNull();
    expect(element.querySelector('.process-row')?.textContent).toContain('3 % · 20 MB');

    const confirm = vi.spyOn(globalThis, 'confirm').mockReturnValueOnce(true);
    element
      .querySelector<HTMLButtonElement>('.window-list__action[aria-label="notepad beenden"]')!
      .click();
    fixture.detectChanges();

    expect(remote.sendAction).toHaveBeenCalledWith({
      type: 'killProcess',
      id: '42',
      name: 'notepad',
    });
    expect(element.querySelector('.process-row')).toBeNull();
    confirm.mockRestore();
  });

  it('switches display mode and microphone when the PC reports them', async () => {
    const { remote, element } = await setup('windows', [], false, {
      ...stats,
      displayMode: 'extend',
      micMuted: false,
    });
    const select = element.querySelectorAll<HTMLSelectElement>('.power-mode select')[0];
    const mic = element.querySelector<HTMLButtonElement>('.mic-switch')!;

    expect(select.value).toBe('extend');
    select.value = 'clone';
    select.dispatchEvent(new Event('change'));
    expect(mic.getAttribute('aria-checked')).toBe('true');
    mic.click();

    expect(remote.setDisplayMode).toHaveBeenCalledWith('clone');
    expect(remote.setMicMuted).toHaveBeenCalledWith(true);

    TestBed.resetTestingModule();
    const mediaOnly = await setup('windows', [], true, {
      ...stats,
      displayMode: 'extend',
      micMuted: false,
    });
    expect(mediaOnly.element.querySelector('.mic-switch, .power-mode')).toBeNull();
  });

  it('lists the files of the PC folder and downloads one', async () => {
    const { remote, fileTransfer, element } = await setup(
      'linux',
      null,
      false,
      null,
      [],
      [{ name: 'bericht.pdf', size: 2 * 1024 * 1024 }],
    );
    const file = element.querySelector<HTMLButtonElement>('.folder-file')!;

    expect(file.textContent).toContain('bericht.pdf');
    expect(file.textContent).toContain('2.0 MB');
    file.click();

    expect(remote.readFolder).toHaveBeenCalled();
    expect(fileTransfer.downloadFolderFile).toHaveBeenCalledWith('bericht.pdf');

    TestBed.resetTestingModule();
    const android = await setup('android', null, false, null, [], [{ name: 'x', size: 1 }]);
    expect(android.element.querySelector('.folder-file')).toBeNull();
    TestBed.resetTestingModule();
    const oldServer = await setup('windows', [], false, null, [], null);
    expect(oldServer.element.querySelector('.folder-file')).toBeNull();
  });

  it('lists the windows of a Windows PC and brings one to the front', async () => {
    const { remote, fixture, element, titles } = await setup('windows', [
      { id: '1', title: 'Dokument - Editor', app: 'Editor' },
      { id: '2', title: 'YouTube - Google Chrome', app: 'Google Chrome' },
    ]);

    expect(titles()).toEqual(['Dokument - Editor', 'YouTube - Google Chrome']);

    element
      .querySelectorAll<HTMLButtonElement>('.window-list__item:not(.window-list__action)')[1]
      .click();
    fixture.detectChanges();

    expect(remote.sendAction).toHaveBeenCalledWith({ type: 'focusWindow', id: '2' });
    expect(titles()).toEqual(['YouTube - Google Chrome', 'Dokument - Editor']);
  });

  it('minimizes a window and closes another one', async () => {
    const { remote, fixture, element, titles } = await setup('windows', [
      { id: '1', title: 'Dokument - Editor', app: 'Editor' },
      { id: '2', title: 'YouTube - Google Chrome', app: 'Google Chrome' },
    ]);
    const action = (label: string) =>
      element.querySelector<HTMLButtonElement>(`.window-list__action[aria-label="${label}"]`)!;

    action('Dokument - Editor minimieren').click();
    action('YouTube - Google Chrome schließen').click();
    fixture.detectChanges();

    expect(remote.sendAction.mock.calls).toEqual([
      [{ type: 'minimizeWindow', id: '1' }],
      [{ type: 'closeWindow', id: '2' }],
    ]);
    expect(titles()).toEqual(['Dokument - Editor']);
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

  it('switches the power mode when the PC reports one, but not for a media-only device', async () => {
    const stats: SystemStatsMessage = {
      type: 'systemStats',
      memoryUsedMb: 4096,
      memoryTotalMb: 16384,
      powerMode: 'balanced',
    };
    const { remote, element } = await setup('windows', [], false, stats);
    const select = element.querySelector<HTMLSelectElement>('.power-mode select')!;

    expect(select.value).toBe('balanced');
    select.value = 'performance';
    select.dispatchEvent(new Event('change'));
    expect(remote.setPowerMode).toHaveBeenCalledWith('performance');

    TestBed.resetTestingModule();
    const mediaOnly = await setup('windows', [], true, stats);
    expect(mediaOnly.element.querySelector('.power-mode')).toBeNull();
  });

  it('sets the brightness of each display when the slider is let go', async () => {
    const { remote, fixture, element } = await setup('windows', [], false, null, [
      { id: 'internal', brightness: 80 },
      { id: '\\\\.\\DISPLAY2', brightness: 30 },
    ]);
    const labels = () =>
      [...element.querySelectorAll('.brightness span')].map((label) => label.textContent?.trim());
    expect(labels()).toEqual(['Eingebautes Display · 80 %', 'Bildschirm 1 · 30 %']);

    const slider = element.querySelectorAll<HTMLInputElement>('.brightness input')[1];
    slider.value = '55';
    slider.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(labels()[1]).toBe('Bildschirm 1 · 55 %');
    expect(remote.sendAction).not.toHaveBeenCalled();

    slider.dispatchEvent(new Event('change'));
    expect(remote.sendAction).toHaveBeenCalledWith({
      type: 'brightness',
      id: '\\\\.\\DISPLAY2',
      value: 55,
    });

    TestBed.resetTestingModule();
    const single = await setup('windows', [], false, null, [{ id: 'internal', brightness: 80 }]);
    expect(single.element.querySelector('.brightness span')?.textContent?.trim()).toBe(
      'Helligkeit · 80 %',
    );

    TestBed.resetTestingModule();
    const mediaOnly = await setup('windows', [], true, null, [{ id: 'internal', brightness: 80 }]);
    expect(mediaOnly.element.querySelector('.brightness')).toBeNull();
    expect(mediaOnly.remote.readBrightness).not.toHaveBeenCalled();
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
