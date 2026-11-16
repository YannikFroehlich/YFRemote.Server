import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { BUTTON_LAYOUT_STORAGE_KEY } from './button-layout';
import { ANDROID_PROFILE_ID, BUTTON_LAYOUT_PROFILES_STORAGE_KEY } from './button-layout-profiles';
import {
  BUTTON_ID_FACTORY,
  ButtonLayoutService,
  PROFILE_ID_FACTORY,
} from './button-layout.service';
import {
  ANDROID_BUILT_IN_BUTTONS,
  BUILT_IN_BUTTONS,
  DEFAULT_HIDDEN_BUILT_IN_IDS,
  LEGACY_DEFAULT_PLACEMENTS,
} from './remote-actions';

const DEFAULT_VISIBLE_COUNT = BUILT_IN_BUTTONS.length - DEFAULT_HIDDEN_BUILT_IN_IDS.length;
import { REMOTE_STORAGE } from './remote.service';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function setupService(storage: MemoryStorage = new MemoryStorage()): {
  readonly service: ButtonLayoutService;
  readonly storage: MemoryStorage;
} {
  TestBed.configureTestingModule({
    providers: [
      { provide: REMOTE_STORAGE, useValue: storage },
      { provide: BUTTON_ID_FACTORY, useValue: () => 'custom:test1' },
      { provide: PROFILE_ID_FACTORY, useValue: () => 'profile:test1' },
    ],
  });

  return { service: TestBed.inject(ButtonLayoutService), storage };
}

describe('ButtonLayoutService', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('starts with the default buttons placed, the duplicates hidden and snap enabled', () => {
    const { service } = setupService();

    expect(service.visibleButtons()).toHaveLength(DEFAULT_VISIBLE_COUNT);
    expect(service.snapToGrid()).toBe(true);
    expect(service.hiddenButtons().map((button) => button.id)).toEqual(DEFAULT_HIDDEN_BUILT_IN_IDS);
  });

  it('moves an untouched old default layout to the new one but keeps a customized one', () => {
    const custom = { id: 'custom:own', col: 0, row: 18, colSpan: 4, rowSpan: 2 };
    const stored = (placements: readonly object[]) =>
      JSON.stringify({
        version: 1,
        snapToGrid: true,
        placements,
        customButtons: [
          {
            id: 'custom:own',
            label: 'Eigen',
            icon: 'key',
            steps: [{ action: { type: 'key', keys: ['F5'] }, delayMs: 0 }],
          },
        ],
        hiddenBuiltInIds: [],
      });

    const untouched = new MemoryStorage();
    untouched.setItem(BUTTON_LAYOUT_STORAGE_KEY, stored([...LEGACY_DEFAULT_PLACEMENTS, custom]));
    const migrated = setupService(untouched).service;
    expect(migrated.hiddenButtons().map((button) => button.id)).toEqual(
      DEFAULT_HIDDEN_BUILT_IN_IDS,
    );
    expect(migrated.visibleButtons().some((item) => item.placement.id === 'power-menu')).toBe(true);
    expect(
      migrated.visibleButtons().find((item) => item.placement.id === 'custom:own')?.placement,
    ).toMatchObject({ col: 0, row: 18 });
    TestBed.resetTestingModule();

    // Eine verschobene Taste: das Layout gehoert dem Nutzer, nur "Energie" kommt dazu.
    const moved = LEGACY_DEFAULT_PLACEMENTS.map((placement) =>
      placement.id === 'mute' ? { ...placement, col: 0, row: 20 } : placement,
    );
    const customized = new MemoryStorage();
    customized.setItem(BUTTON_LAYOUT_STORAGE_KEY, stored([...moved, custom]));
    const kept = setupService(customized).service;
    expect(kept.hiddenButtons()).toEqual([]);
    expect(
      kept.visibleButtons().find((item) => item.placement.id === 'mute')?.placement,
    ).toMatchObject({ col: 0, row: 20 });
    expect(kept.visibleButtons().some((item) => item.placement.id === 'power-menu')).toBe(true);
  });

  it('switches to an Android profile for an Android server and back for a PC', () => {
    const { service } = setupService();

    service.applyServerPlatform('android');

    expect(service.activeProfileId()).toBe(ANDROID_PROFILE_ID);
    expect(
      service
        .visibleButtons()
        .map((placed) => placed.button.id)
        .sort(),
    ).toEqual(ANDROID_BUILT_IN_BUTTONS.map((button) => button.id).sort());
    // Genau die Buttons, die der Android-Server ablehnt, duerfen nicht auftauchen.
    for (const id of [
      'previous-tab',
      'next-tab',
      'close-tab',
      'restore-tab',
      'fullscreen',
      'restart',
      'shutdown',
    ]) {
      expect(service.visibleButtons().some((placed) => placed.button.id === id)).toBe(false);
    }

    service.applyServerPlatform('windows');

    expect(service.activeProfileId()).not.toBe(ANDROID_PROFILE_ID);
    expect(service.visibleButtons()).toHaveLength(DEFAULT_VISIBLE_COUNT);
  });

  it('keeps the Android-only buttons after a reload in the Android profile', () => {
    const storage = new MemoryStorage();
    setupService(storage).service.applyServerPlatform('android');
    TestBed.resetTestingModule();

    const { service } = setupService(storage);

    expect(service.activeProfileId()).toBe(ANDROID_PROFILE_ID);
    expect(
      service
        .visibleButtons()
        .map((placed) => placed.button.id)
        .sort(),
    ).toEqual(ANDROID_BUILT_IN_BUTTONS.map((button) => button.id).sort());
  });

  it('keeps the Android profile untouched while the platform is unknown', () => {
    const { service } = setupService();

    service.applyServerPlatform('android');
    const androidButtons = service.visibleButtons().length;
    service.applyServerPlatform(null);

    expect(service.activeProfileId()).toBe(ANDROID_PROFILE_ID);
    expect(service.visibleButtons()).toHaveLength(androidButtons);
  });

  it('switches to the profile of the app in front and back, and keeps the apps after a reload', () => {
    const storage = new MemoryStorage();
    const { service } = setupService(storage);
    service.createProfile('Medien');
    service.setProfileApps('profile:test1', [' VLC media player ', 'vlc MEDIA player', '']);
    service.setProfileView('profile:test1', 'gamepad');
    service.switchProfile('profile:standard');

    expect(service.applyForegroundApp('VLC Media Player')?.view).toBe('gamepad');
    expect(service.activeProfileId()).toBe('profile:test1');

    expect(service.applyForegroundApp('Explorer')).toBeUndefined();
    expect(service.activeProfileId()).toBe('profile:standard');

    // Von Hand gewaehlt: ohne zugeordnetes Programm vorne bleibt es dabei.
    service.applyForegroundApp('VLC media player');
    service.switchProfile('profile:test1');
    service.applyForegroundApp(null);
    expect(service.activeProfileId()).toBe('profile:test1');

    TestBed.resetTestingModule();
    const reloaded = setupService(storage).service;
    const stored = reloaded.profiles().find((profile) => profile.id === 'profile:test1');
    expect(stored?.apps).toEqual(['VLC media player']);
    expect(stored?.view).toBe('gamepad');
  });

  it('moves a placement and persists integer coordinates when snap is on', () => {
    const { service, storage } = setupService();

    service.movePlacement('up', 2.7, 1.2);

    const placement = service.visibleButtons().find((item) => item.placement.id === 'up');
    expect(placement?.placement).toMatchObject({ col: 3, row: 1 });
    expect(storage.getItem(BUTTON_LAYOUT_STORAGE_KEY)).toContain('"col":3');
  });

  it('keeps fractional coordinates when snap is off', () => {
    const { service } = setupService();

    service.setSnapToGrid(false);
    service.movePlacement('up', 2.7, 1.2);

    const placement = service.visibleButtons().find((item) => item.placement.id === 'up');
    expect(placement?.placement.col).toBeCloseTo(2.7);
    expect(placement?.placement.row).toBeCloseTo(1.2);
  });

  it('hides a built-in button and moves it into hiddenButtons', () => {
    const { service, storage } = setupService();

    service.hideButton('fullscreen');

    expect(service.visibleButtons().some((item) => item.placement.id === 'fullscreen')).toBe(false);
    expect(service.hiddenButtons().map((button) => button.id)).toContain('fullscreen');
    expect(JSON.parse(storage.getItem(BUTTON_LAYOUT_STORAGE_KEY)!).hiddenBuiltInIds).toContain(
      'fullscreen',
    );
  });

  it('restores a hidden button into a free slot', () => {
    const { service } = setupService();

    service.hideButton('fullscreen');
    service.restoreButton('fullscreen');
    service.restoreButton('mute');

    expect(service.visibleButtons().some((item) => item.placement.id === 'fullscreen')).toBe(true);
    expect(service.visibleButtons().some((item) => item.placement.id === 'mute')).toBe(true);
    expect(service.hiddenButtons().map((button) => button.id)).not.toContain('mute');
  });

  it('adds a custom button with a deterministic id and no leaked "type" duplication', () => {
    const { service, storage } = setupService();

    const added = service.addCustomButton({
      label: 'Speichern',
      icon: 'key',
      steps: [{ action: { type: 'hotkey', keys: ['CTRL', 'S'] }, delayMs: 0 }],
    });

    expect(added).toBe(true);
    expect(service.visibleButtons().some((item) => item.placement.id === 'custom:test1')).toBe(
      true,
    );

    const persisted = JSON.parse(storage.getItem(BUTTON_LAYOUT_STORAGE_KEY) ?? '{}');
    expect(persisted.customButtons).toEqual([
      {
        id: 'custom:test1',
        label: 'Speichern',
        icon: 'key',
        steps: [{ action: { type: 'hotkey', keys: ['CTRL', 'S'] }, delayMs: 0 }],
      },
    ]);
  });

  it('rejects an invalid custom button draft without persisting anything', () => {
    const { service, storage } = setupService();

    const added = service.addCustomButton({ label: 'Ungueltig', icon: null, steps: [] });

    expect(added).toBe(false);
    expect(storage.getItem(BUTTON_LAYOUT_STORAGE_KEY)).toBeNull();
  });

  it('deletes a custom button and its placement together', () => {
    const { service } = setupService();

    service.addCustomButton({
      label: 'Speichern',
      icon: 'key',
      steps: [{ action: { type: 'hotkey', keys: ['CTRL', 'S'] }, delayMs: 0 }],
    });
    service.deleteCustomButton('custom:test1');

    expect(service.visibleButtons().some((item) => item.placement.id === 'custom:test1')).toBe(
      false,
    );
    expect(service.layout().customButtons).toEqual([]);
  });

  it('resets to the default layout while keeping custom buttons placed at the bottom', () => {
    const { service } = setupService();

    service.hideButton('fullscreen');
    service.restoreButton('mute');
    service.addCustomButton({
      label: 'Speichern',
      icon: 'key',
      steps: [{ action: { type: 'hotkey', keys: ['CTRL', 'S'] }, delayMs: 0 }],
    });
    service.resetLayout();

    // Zurueck zum Standard heisst auch: Medien- und Energietasten wieder ausgeblendet.
    expect(service.hiddenButtons().map((button) => button.id)).toEqual(DEFAULT_HIDDEN_BUILT_IN_IDS);
    expect(service.visibleButtons().some((item) => item.placement.id === 'fullscreen')).toBe(true);
    expect(service.visibleButtons().some((item) => item.placement.id === 'mute')).toBe(false);
    expect(service.visibleButtons().some((item) => item.placement.id === 'custom:test1')).toBe(
      true,
    );
  });

  it('recovers from a corrupted stored layout without throwing', () => {
    const storage = new MemoryStorage();
    storage.setItem(BUTTON_LAYOUT_STORAGE_KEY, '{{{not json');

    const { service } = setupService(storage);

    expect(service.visibleButtons()).toHaveLength(DEFAULT_VISIBLE_COUNT);
  });

  it('migrates the existing browser layout into a Standard profile', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      BUTTON_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        snapToGrid: true,
        placements: [],
        customButtons: [],
        hiddenBuiltInIds: ['mute'],
      }),
    );

    const { service } = setupService(storage);

    expect(service.profiles().map((profile) => profile.name)).toEqual(['Standard']);
    expect(service.hiddenButtons().map((button) => button.id)).toContain('mute');

    service.setSnapToGrid(false);
    expect(storage.getItem(BUTTON_LAYOUT_PROFILES_STORAGE_KEY)).toContain('"name": "Standard"');
  });

  it('keeps edits isolated in named profiles and restores the active profile', () => {
    const { service, storage } = setupService();
    service.movePlacement('up', 3, 2);

    expect(service.createProfile('Medien')).toBe(true);
    service.hideButton('fullscreen');
    expect(service.activeProfileId()).toBe('profile:test1');

    const standard = service.profiles().find((profile) => profile.name === 'Standard');
    expect(standard).toBeDefined();
    expect(service.switchProfile(standard!.id)).toBe(true);
    expect(service.hiddenButtons().map((button) => button.id)).not.toContain('fullscreen');
    expect(
      service.visibleButtons().find((item) => item.placement.id === 'up')?.placement,
    ).toMatchObject({
      col: 3,
      row: 2,
    });

    TestBed.resetTestingModule();
    const restored = setupService(storage).service;
    expect(restored.profiles().map((profile) => profile.name)).toEqual(['Standard', 'Medien']);
    expect(restored.activeProfileId()).toBe(standard!.id);
  });

  it('exports and imports all profiles including custom buttons and macros', () => {
    const { service } = setupService();
    service.addCustomButton({
      label: 'Start',
      icon: 'key',
      steps: [
        { action: { type: 'hotkey', keys: ['WIN', 'R'] }, delayMs: 0 },
        { action: { type: 'text', text: 'notepad' }, delayMs: 250 },
      ],
    });
    expect(service.createProfile('Präsentation')).toBe(true);
    const exported = service.exportProfiles();

    TestBed.resetTestingModule();
    const imported = setupService().service;
    expect(imported.importProfiles(exported)).toBe(true);

    expect(imported.profiles().map((profile) => profile.name)).toEqual([
      'Standard',
      'Präsentation',
    ]);
    expect(imported.layout().customButtons[0]).toMatchObject({
      label: 'Start',
      steps: [
        { action: { type: 'hotkey', keys: ['WIN', 'R'] }, delayMs: 0 },
        { action: { type: 'text', text: 'notepad' }, delayMs: 250 },
      ],
    });
  });

  it('rejects an invalid profile import without replacing the current layout', () => {
    const { service } = setupService();
    service.hideButton('mute');

    expect(service.importProfiles('{"schemaVersion":99,"profiles":[]}')).toBe(false);
    expect(service.hiddenButtons().map((button) => button.id)).toContain('mute');
    expect(service.profileError()).toContain('keine gültigen');
  });

  it('works with a null storage (private browsing) without throwing', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: REMOTE_STORAGE, useValue: null },
        { provide: BUTTON_ID_FACTORY, useValue: () => 'custom:test1' },
        { provide: PROFILE_ID_FACTORY, useValue: () => 'profile:test1' },
      ],
    });

    const service = TestBed.inject(ButtonLayoutService);
    service.movePlacement('up', 1, 1);

    expect(service.visibleButtons().some((item) => item.placement.id === 'up')).toBe(true);
  });
});
