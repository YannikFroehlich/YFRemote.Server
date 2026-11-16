import { preventEdgeSwipe, watchKeyboardInset } from './device';

describe('preventEdgeSwipe', () => {
  function touchStart(target: Element, clientX: number): Event {
    const event = new Event('touchstart', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'changedTouches', { value: [{ clientX }] });
    target.dispatchEvent(event);
    return event;
  }

  it('stops Safari swiping back from the edge of the touchpad, but nowhere else', () => {
    const surface = document.createElement('div');
    surface.className = 'touchpad-surface';
    const other = document.createElement('div');
    document.body.append(surface, other);
    const stop = preventEdgeSwipe(document);
    const width = window.innerWidth;

    try {
      expect(touchStart(surface, 5).defaultPrevented).toBe(true);
      expect(touchStart(surface, width - 5).defaultPrevented).toBe(true);
      expect(touchStart(surface, width / 2).defaultPrevented).toBe(false);
      expect(touchStart(other, 5).defaultPrevented).toBe(false);
    } finally {
      stop();
      surface.remove();
      other.remove();
    }

    expect(touchStart(document.body, 5).defaultPrevented).toBe(false);
  });
});

class FakeViewport extends EventTarget {
  height = 800;
  offsetTop = 0;
}

describe('watchKeyboardInset', () => {
  function setup() {
    const viewport = new FakeViewport();
    const body = document.createElement('body');
    const window = { innerHeight: 800, visualViewport: viewport, document: { body } };
    const stop = watchKeyboardInset(window as unknown as Window);
    const inset = () => body.style.getPropertyValue('--keyboard-inset');
    return { viewport, inset, stop };
  }

  it('reports the part of the layout the on-screen keyboard covers', () => {
    const { viewport, inset } = setup();
    expect(inset()).toBe('0px');

    // Safari: nur der sichtbare Ausschnitt schrumpft und rutscht zum fokussierten Feld.
    viewport.height = 450;
    viewport.offsetTop = 50;
    viewport.dispatchEvent(new Event('resize'));
    expect(inset()).toBe('300px');

    viewport.height = 800;
    viewport.offsetTop = 0;
    viewport.dispatchEvent(new Event('scroll'));
    expect(inset()).toBe('0px');
  });

  it('stops following the viewport once stopped', () => {
    const { viewport, inset, stop } = setup();
    stop();

    viewport.height = 400;
    viewport.dispatchEvent(new Event('resize'));
    expect(inset()).toBe('0px');
  });

  it('does nothing without visualViewport', () => {
    const window = { innerHeight: 800, document: { body: document.createElement('body') } };
    expect(() => watchKeyboardInset(window as unknown as Window)()).not.toThrow();
  });
});
