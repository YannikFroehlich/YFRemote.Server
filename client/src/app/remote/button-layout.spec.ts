import { describe, expect, it } from 'vitest';
import {
  BUTTON_LAYOUT_VERSION,
  clampPlacement,
  DEFAULT_BUTTON_LAYOUT,
  findFreeSlot,
  LAYOUT_COLUMNS,
  normalizeCustomButtonDefinition,
  overlaps,
  parseStoredButtonLayout,
  resolveButtonLayout,
  snapPlacement,
} from './button-layout';
import { BUILT_IN_BUTTONS } from './remote-actions';
import { RemoteButtonConfig } from './remote.models';

describe('button-layout', () => {
  it('contains every built-in button exactly once in the default layout', () => {
    const ids = DEFAULT_BUTTON_LAYOUT.placements.map((placement) => placement.id);
    const uniqueIds = new Set(ids);

    expect(uniqueIds.size).toBe(BUILT_IN_BUTTONS.length);

    for (const button of BUILT_IN_BUTTONS) {
      expect(ids).toContain(button.id);
    }
  });

  describe('parseStoredButtonLayout', () => {
    it('falls back to the default layout for null, malformed JSON, or the wrong version', () => {
      expect(parseStoredButtonLayout(null)).toEqual(DEFAULT_BUTTON_LAYOUT);
      expect(parseStoredButtonLayout('{')).toEqual(DEFAULT_BUTTON_LAYOUT);
      expect(parseStoredButtonLayout('"just a string"')).toEqual(DEFAULT_BUTTON_LAYOUT);
      expect(
        parseStoredButtonLayout(
          JSON.stringify({ ...DEFAULT_BUTTON_LAYOUT, version: 99 }),
        ),
      ).toEqual(DEFAULT_BUTTON_LAYOUT);
    });

    it('drops placements referencing unknown ids', () => {
      const stored = {
        version: BUTTON_LAYOUT_VERSION,
        snapToGrid: true,
        placements: [{ id: 'ghost', col: 0, row: 0, colSpan: 1, rowSpan: 1 }],
        customButtons: [],
        hiddenBuiltInIds: [],
      };

      const resolved = parseStoredButtonLayout(JSON.stringify(stored));

      expect(resolved.placements.some((placement) => placement.id === 'ghost')).toBe(false);
      // missing built-ins get auto-placed instead of silently disappearing
      expect(resolved.placements.length).toBe(BUILT_IN_BUTTONS.length);
    });

    it('drops placements with non-finite coordinates', () => {
      const stored = {
        version: BUTTON_LAYOUT_VERSION,
        snapToGrid: true,
        placements: [{ id: 'up', col: Number.NaN, row: 0, colSpan: 1, rowSpan: 1 }],
        customButtons: [],
        hiddenBuiltInIds: [],
      };

      const resolved = parseStoredButtonLayout(JSON.stringify(stored));
      const upPlacement = resolved.placements.find((placement) => placement.id === 'up');

      expect(upPlacement).toBeDefined();
      expect(Number.isFinite(upPlacement?.col)).toBe(true);
    });

    it('preserves fractional coordinates when snap is off', () => {
      const stored = {
        version: BUTTON_LAYOUT_VERSION,
        snapToGrid: false,
        placements: [{ id: 'up', col: 2.37, row: 1.5, colSpan: 1, rowSpan: 1 }],
        customButtons: [],
        hiddenBuiltInIds: [],
      };

      const resolved = parseStoredButtonLayout(JSON.stringify(stored));
      const upPlacement = resolved.placements.find((placement) => placement.id === 'up');

      expect(upPlacement?.col).toBeCloseTo(2.37);
      expect(upPlacement?.row).toBeCloseTo(1.5);
    });

    it('respects hiddenBuiltInIds instead of re-adding a hidden built-in', () => {
      const stored = {
        version: BUTTON_LAYOUT_VERSION,
        snapToGrid: true,
        placements: DEFAULT_BUTTON_LAYOUT.placements.filter((p) => p.id !== 'mute'),
        customButtons: [],
        hiddenBuiltInIds: ['mute'],
      };

      const resolved = parseStoredButtonLayout(JSON.stringify(stored));

      expect(resolved.placements.some((placement) => placement.id === 'mute')).toBe(false);
      expect(resolved.hiddenBuiltInIds).toContain('mute');
    });

    it('auto-places a built-in that is neither placed nor hidden (new app version)', () => {
      const stored = {
        version: BUTTON_LAYOUT_VERSION,
        snapToGrid: true,
        placements: DEFAULT_BUTTON_LAYOUT.placements.filter((p) => p.id !== 'mute'),
        customButtons: [],
        hiddenBuiltInIds: [],
      };

      const resolved = parseStoredButtonLayout(JSON.stringify(stored));

      expect(resolved.placements.some((placement) => placement.id === 'mute')).toBe(true);
    });

    it('drops a custom button with an unsupported key, keeping its placement out too', () => {
      const stored = {
        version: BUTTON_LAYOUT_VERSION,
        snapToGrid: true,
        placements: [{ id: 'custom:1', col: 0, row: 12, colSpan: 3, rowSpan: 2 }],
        customButtons: [
          { id: 'custom:1', label: 'Test', icon: null, action: { type: 'key', keys: ['HOME'] } },
        ],
        hiddenBuiltInIds: [],
      };

      const resolved = parseStoredButtonLayout(JSON.stringify(stored));

      expect(resolved.customButtons).toEqual([]);
      expect(resolved.placements.some((placement) => placement.id === 'custom:1')).toBe(false);
    });

    it('drops a custom button with an empty label', () => {
      const stored = {
        version: BUTTON_LAYOUT_VERSION,
        snapToGrid: true,
        placements: [],
        customButtons: [
          { id: 'custom:1', label: '  ', icon: null, action: { type: 'key', keys: ['A'] } },
        ],
        hiddenBuiltInIds: [],
      };

      expect(parseStoredButtonLayout(JSON.stringify(stored)).customButtons).toEqual([]);
    });

    it('keeps a valid custom button and its placement', () => {
      const stored = {
        version: BUTTON_LAYOUT_VERSION,
        snapToGrid: true,
        placements: [{ id: 'custom:1', col: 0, row: 12, colSpan: 3, rowSpan: 2 }],
        customButtons: [
          {
            id: 'custom:1',
            label: 'Speichern',
            icon: 'key',
            action: { type: 'hotkey', keys: ['CTRL', 'S'] },
          },
        ],
        hiddenBuiltInIds: [],
      };

      const resolved = parseStoredButtonLayout(JSON.stringify(stored));

      expect(resolved.customButtons).toHaveLength(1);
      expect(resolved.placements.some((placement) => placement.id === 'custom:1')).toBe(true);
    });
  });

  describe('clampPlacement', () => {
    it('clamps a placement that runs past the right edge back into the canvas', () => {
      const clamped = clampPlacement({ id: 'x', col: 99, row: 0, colSpan: 3, rowSpan: 1 });
      expect(clamped.col).toBe(LAYOUT_COLUMNS - 3);
    });

    it('clamps colSpan to at most the column count', () => {
      const clamped = clampPlacement({ id: 'x', col: 0, row: 0, colSpan: 99, rowSpan: 1 });
      expect(clamped.colSpan).toBe(LAYOUT_COLUMNS);
    });

    it('never returns a colSpan below 1', () => {
      const clamped = clampPlacement({ id: 'x', col: 0, row: 0, colSpan: 0, rowSpan: 0 });
      expect(clamped.colSpan).toBeGreaterThanOrEqual(1);
      expect(clamped.rowSpan).toBeGreaterThanOrEqual(1);
    });
  });

  describe('snapPlacement', () => {
    it('rounds fractional coordinates to whole cells', () => {
      expect(snapPlacement({ id: 'x', col: 2.6, row: 1.4, colSpan: 1, rowSpan: 1 })).toEqual({
        id: 'x',
        col: 3,
        row: 1,
        colSpan: 1,
        rowSpan: 1,
      });
    });
  });

  describe('overlaps / findFreeSlot', () => {
    it('detects overlapping rectangles', () => {
      const a = { id: 'a', col: 0, row: 0, colSpan: 2, rowSpan: 2 };
      const b = { id: 'b', col: 1, row: 1, colSpan: 2, rowSpan: 2 };
      const c = { id: 'c', col: 5, row: 5, colSpan: 1, rowSpan: 1 };

      expect(overlaps(a, b)).toBe(true);
      expect(overlaps(a, c)).toBe(false);
    });

    it('finds a slot that does not overlap existing placements', () => {
      const existing = [{ id: 'a', col: 0, row: 0, colSpan: LAYOUT_COLUMNS, rowSpan: 2 }];
      const slot = findFreeSlot(existing, 3, 2);

      const candidate = { id: '', col: slot.col, row: slot.row, colSpan: 3, rowSpan: 2 };
      expect(existing.some((placement) => overlaps(placement, candidate))).toBe(false);
    });
  });

  describe('normalizeCustomButtonDefinition', () => {
    it('accepts a valid candidate', () => {
      const result = normalizeCustomButtonDefinition({
        id: 'custom:1',
        label: 'Speichern',
        icon: 'key',
        action: { keys: ['ctrl', 's'] },
      });

      expect(result).toEqual({
        id: 'custom:1',
        label: 'Speichern',
        icon: 'key',
        action: { type: 'hotkey', keys: ['CTRL', 'S'] },
      });
    });

    it('rejects a candidate whose id is not a custom id', () => {
      expect(
        normalizeCustomButtonDefinition({
          id: 'up',
          label: 'X',
          icon: null,
          action: { keys: ['A'] },
        }),
      ).toBeNull();
    });

    it('rejects a label longer than the maximum length', () => {
      expect(
        normalizeCustomButtonDefinition({
          id: 'custom:1',
          label: 'A very long label indeed',
          icon: null,
          action: { keys: ['A'] },
        }),
      ).toBeNull();
    });
  });

  describe('resolveButtonLayout', () => {
    it('is idempotent: resolving an already-resolved layout changes nothing', () => {
      const once = resolveButtonLayout(DEFAULT_BUTTON_LAYOUT);
      const twice = resolveButtonLayout(once);
      expect(twice).toEqual(once);
    });

    it('drops duplicate placements for the same id, keeping the first', () => {
      const builtIns: readonly RemoteButtonConfig[] = [
        { id: 'a', label: 'A', ariaLabel: 'A', icon: 'key' },
      ];
      const stored = {
        version: BUTTON_LAYOUT_VERSION,
        snapToGrid: true,
        placements: [
          { id: 'a', col: 0, row: 0, colSpan: 1, rowSpan: 1 },
          { id: 'a', col: 5, row: 5, colSpan: 1, rowSpan: 1 },
        ],
        customButtons: [],
        hiddenBuiltInIds: [],
      };

      const resolved = resolveButtonLayout(stored, builtIns);
      expect(resolved.placements).toHaveLength(1);
      expect(resolved.placements[0]).toMatchObject({ col: 0, row: 0 });
    });
  });
});
