/** Ausschnitt des Bildes: Zoomfaktor und Verschiebung in CSS-Pixeln, von links oben aus. */
export interface ScreenViewport {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export const FULL_VIEW: ScreenViewport = { scale: 1, x: 0, y: 0 };
const MAX_SCALE = 6;
// Kurz vor 1 einrasten, sonst bleibt nach dem Zurueckzoomen ein kaum sichtbarer Zoom stehen.
const SNAP_SCALE = 1.05;

/** Zwei Finger: Die Stelle unter ihrer Mitte bleibt unter der Mitte, der Abstand gibt den Zoom. Das
 *  Bild verlaesst dabei nie die Flaeche `stage`. */
export function pinchViewport(
  start: ScreenViewport,
  from: readonly [Point, Point],
  to: readonly [Point, Point],
  stage: { readonly width: number; readonly height: number },
): ScreenViewport {
  const startDistance = distance(from[0], from[1]);
  const factor = startDistance > 0 ? distance(to[0], to[1]) / startDistance : 1;
  const scale = Math.min(MAX_SCALE, Math.max(1, start.scale * factor));
  if (scale < SNAP_SCALE) {
    return FULL_VIEW;
  }

  const fromCenter = center(from);
  const toCenter = center(to);
  const clamp = (value: number, size: number) => Math.min(0, Math.max(size * (1 - scale), value));
  return {
    scale,
    x: clamp(toCenter.x - ((fromCenter.x - start.x) / start.scale) * scale, stage.width),
    y: clamp(toCenter.y - ((fromCenter.y - start.y) / start.scale) * scale, stage.height),
  };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function center(points: readonly [Point, Point]): Point {
  return { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
}
