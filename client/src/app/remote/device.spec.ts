import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  keepScreenAwake,
  preventEdgeSwipe,
  SCREEN_WAKE_LOCK,
  ScreenWakeLock,
  watchKeyboardInset,
} from './device';

describe('keepScreenAwake', () => {
  @Component({ template: '' })
  class AwakeComponent {
    constructor() {
      keepScreenAwake();
    }
  }

  let visibility: DocumentVisibilityState;
  let release: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let request: ReturnType<typeof vi.fn<() => Promise<ScreenWakeLock>>>;

  beforeEach(() => {
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    release = vi.fn<() => Promise<void>>(() => Promise.resolve());
    request = vi.fn<() => Promise<ScreenWakeLock>>(() => Promise.resolve({ release }));
    TestBed.configureTestingModule({ providers: [{ provide: SCREEN_WAKE_LOCK, useValue: request }] });
  });

  afterEach(() => vi.restoreAllMocks());

  const settle = () => new Promise((resolve) => setTimeout(resolve));

  it('holds the lock while the component lives and releases it on destroy', async () => {
    const fixture = TestBed.createComponent(AwakeComponent);
    await settle();
    expect(request).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new Event('pointerdown'));
    expect(request).toHaveBeenCalledTimes(1);

    fixture.destroy();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('takes the lock again after the page was hidden, and retries a refusal on the next tap', async () => {
    request.mockRejectedValueOnce(new Error('NotAllowedError'));
    const fixture = TestBed.createComponent(AwakeComponent);
    await settle();

    document.dispatchEvent(new Event('pointerdown'));
    await settle();
    expect(request).toHaveBeenCalledTimes(2);

    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(request).toHaveBeenCalledTimes(3);

    fixture.destroy();
  });

  it('does nothing without the Wake Lock API', () => {
    TestBed.overrideProvider(SCREEN_WAKE_LOCK, { useValue: null });
    expect(() => TestBed.createComponent(AwakeComponent).destroy()).not.toThrow();
  });
});

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
