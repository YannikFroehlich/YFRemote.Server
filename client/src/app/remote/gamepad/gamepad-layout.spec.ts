import {
  DEFAULT_GAMEPAD_LAYOUT,
  GAMEPAD_PRESETS,
  parseStoredGamepadLayout,
  presetLayout,
} from './gamepad-layout';

describe('parseStoredGamepadLayout', () => {
  it('falls back to the Xbox preset for missing, broken or unknown data', () => {
    expect(parseStoredGamepadLayout(null)).toBe(DEFAULT_GAMEPAD_LAYOUT);
    expect(parseStoredGamepadLayout('{{{')).toBe(DEFAULT_GAMEPAD_LAYOUT);
    expect(parseStoredGamepadLayout('{"preset":"sega"}')).toBe(DEFAULT_GAMEPAD_LAYOUT);
  });

  it('keeps valid placements, clamps them and fills the rest from the preset', () => {
    const layout = parseStoredGamepadLayout(
      JSON.stringify({
        preset: 'retro',
        controls: {
          dpad: { x: 150, y: -5, scale: 9, hidden: false },
          face: { x: 'links', y: 1, scale: 1, hidden: false },
        },
      }),
    );

    expect(layout.preset).toBe('retro');
    expect(layout.controls.dpad).toEqual({ x: 100, y: 0, scale: 2, hidden: false });
    expect(layout.controls.face).toEqual(GAMEPAD_PRESETS.retro.controls.face);
    expect(layout.controls.leftStick.hidden).toBe(true);
  });

  it('round-trips a stored preset', () => {
    const layout = presetLayout('playstation');

    expect(parseStoredGamepadLayout(JSON.stringify(layout))).toEqual(layout);
  });
});
