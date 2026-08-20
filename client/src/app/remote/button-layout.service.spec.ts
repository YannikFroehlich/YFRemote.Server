import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { BUTTON_LAYOUT_STORAGE_KEY } from './button-layout';
import { BUTTON_ID_FACTORY, ButtonLayoutService } from './button-layout.service';
import { BUILT_IN_BUTTONS } from './remote-actions';
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
    ],
  });

  return { service: TestBed.inject(ButtonLayoutService), storage };
}

describe('ButtonLayoutService', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('starts with every built-in button placed and snap enabled', () => {
    const { service } = setupService();

    expect(service.visibleButtons()).toHaveLength(BUILT_IN_BUTTONS.length);
    expect(service.snapToGrid()).toBe(true);
    expect(service.hiddenButtons()).toEqual([]);
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

    service.hideButton('mute');

    expect(service.visibleButtons().some((item) => item.placement.id === 'mute')).toBe(false);
    expect(service.hiddenButtons().map((button) => button.id)).toContain('mute');
    expect(storage.getItem(BUTTON_LAYOUT_STORAGE_KEY)).toContain('"hiddenBuiltInIds":["mute"]');
  });

  it('restores a hidden button into a free slot', () => {
    const { service } = setupService();

    service.hideButton('mute');
    service.restoreButton('mute');

    expect(service.visibleButtons().some((item) => item.placement.id === 'mute')).toBe(true);
    expect(service.hiddenButtons()).toEqual([]);
  });

  it('adds a custom button with a deterministic id and no leaked "type" duplication', () => {
    const { service, storage } = setupService();

    const added = service.addCustomButton({ label: 'Speichern', icon: 'key', keys: ['CTRL', 'S'] });

    expect(added).toBe(true);
    expect(service.visibleButtons().some((item) => item.placement.id === 'custom:test1')).toBe(
      true,
    );

    const persisted = JSON.parse(storage.getItem(BUTTON_LAYOUT_STORAGE_KEY) ?? '{}');
    expect(persisted.customButtons).toEqual([
      { id: 'custom:test1', label: 'Speichern', icon: 'key', action: { type: 'hotkey', keys: ['CTRL', 'S'] } },
    ]);
  });

  it('rejects an invalid custom button draft without persisting anything', () => {
    const { service, storage } = setupService();

    const added = service.addCustomButton({ label: 'Ungueltig', icon: null, keys: [] });

    expect(added).toBe(false);
    expect(storage.getItem(BUTTON_LAYOUT_STORAGE_KEY)).toBeNull();
  });

  it('deletes a custom button and its placement together', () => {
    const { service } = setupService();

    service.addCustomButton({ label: 'Speichern', icon: 'key', keys: ['CTRL', 'S'] });
    service.deleteCustomButton('custom:test1');

    expect(service.visibleButtons().some((item) => item.placement.id === 'custom:test1')).toBe(
      false,
    );
    expect(service.layout().customButtons).toEqual([]);
  });

  it('resets to the default layout while keeping custom buttons placed at the bottom', () => {
    const { service } = setupService();

    service.hideButton('mute');
    service.addCustomButton({ label: 'Speichern', icon: 'key', keys: ['CTRL', 'S'] });
    service.resetLayout();

    expect(service.hiddenButtons()).toEqual([]);
    expect(service.visibleButtons().some((item) => item.placement.id === 'mute')).toBe(true);
    expect(service.visibleButtons().some((item) => item.placement.id === 'custom:test1')).toBe(
      true,
    );
  });

  it('recovers from a corrupted stored layout without throwing', () => {
    const storage = new MemoryStorage();
    storage.setItem(BUTTON_LAYOUT_STORAGE_KEY, '{{{not json');

    const { service } = setupService(storage);

    expect(service.visibleButtons()).toHaveLength(BUILT_IN_BUTTONS.length);
  });

  it('works with a null storage (private browsing) without throwing', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: REMOTE_STORAGE, useValue: null },
        { provide: BUTTON_ID_FACTORY, useValue: () => 'custom:test1' },
      ],
    });

    const service = TestBed.inject(ButtonLayoutService);
    service.movePlacement('up', 1, 1);

    expect(service.visibleButtons().some((item) => item.placement.id === 'up')).toBe(true);
  });
});
