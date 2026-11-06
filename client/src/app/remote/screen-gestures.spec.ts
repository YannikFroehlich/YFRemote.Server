import { describe, expect, it } from 'vitest';
import { FULL_VIEW, pinchViewport } from './screen-gestures';

const stage = { width: 400, height: 200 };

describe('pinchViewport', () => {
  it('keeps the spot under the fingers in place while zooming', () => {
    const view = pinchViewport(
      FULL_VIEW,
      [
        { x: 90, y: 100 },
        { x: 110, y: 100 },
      ],
      [
        { x: 80, y: 100 },
        { x: 120, y: 100 },
      ],
      stage,
    );

    expect(view).toEqual({ scale: 2, x: -100, y: -100 });
  });

  it('moves the zoomed picture with both fingers', () => {
    const view = pinchViewport(
      { scale: 2, x: -100, y: -100 },
      [
        { x: 100, y: 50 },
        { x: 200, y: 50 },
      ],
      [
        { x: 130, y: 60 },
        { x: 230, y: 60 },
      ],
      stage,
    );

    expect(view).toEqual({ scale: 2, x: -70, y: -90 });
  });

  it('never shows anything beside the picture', () => {
    const view = pinchViewport(
      { scale: 2, x: -100, y: -100 },
      [
        { x: 100, y: 50 },
        { x: 200, y: 50 },
      ],
      [
        { x: 900, y: -900 },
        { x: 1000, y: -900 },
      ],
      stage,
    );

    expect(view).toEqual({ scale: 2, x: 0, y: -200 });
  });

  it('limits the zoom and snaps back to the full picture', () => {
    const fingers = [
      { x: 100, y: 100 },
      { x: 110, y: 100 },
    ] as const;

    expect(
      pinchViewport(
        FULL_VIEW,
        fingers,
        [
          { x: 0, y: 100 },
          { x: 400, y: 100 },
        ],
        stage,
      ).scale,
    ).toBe(6);
    expect(
      pinchViewport(
        { scale: 2, x: -100, y: -50 },
        fingers,
        [
          { x: 100, y: 100 },
          { x: 105, y: 100 },
        ],
        stage,
      ),
    ).toEqual(FULL_VIEW);
  });
});
