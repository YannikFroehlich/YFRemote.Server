import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ButtonCanvasComponent } from './button-canvas.component';
import { BUTTON_ID_FACTORY, ButtonLayoutService } from './button-layout.service';
import {
  REMOTE_AUTO_CONNECT,
  REMOTE_STORAGE,
  REMOTE_WEBSOCKET_FACTORY,
  RemoteService,
  RemoteSocket,
} from './remote.service';

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

class MockRemoteSocket implements RemoteSocket {
  readonly sentMessages: string[] = [];

  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  closed = false;

  constructor(readonly url: string) {}

  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
  }
}

interface CanvasHarness {
  readonly fixture: ReturnType<typeof TestBed.createComponent<ButtonCanvasComponent>>;
  readonly layout: ButtonLayoutService;
  readonly sockets: MockRemoteSocket[];
  readonly flushRaf: () => void;
  slot(id: string): HTMLElement;
  button(ariaLabel: string): HTMLButtonElement;
}

describe('ButtonCanvasComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });

  it('sends the action for a plain click in view mode', async () => {
    const { sockets, button } = await setupCanvas(false);

    button('Nach oben').click();

    expect(sockets[0].sentMessages).toEqual(['{"type":"key","keys":["UP"]}']);
  });

  it('does not send an action when clicked in edit mode', async () => {
    const { sockets, button } = await setupCanvas(true);

    button('Nach oben').click();

    expect(sockets[0].sentMessages).toEqual([]);
  });

  it('drags a button to a new cell and does not fire its action', async () => {
    const { sockets, layout, slot, flushRaf } = await setupCanvas(true);
    const upSlot = slot('up');

    dispatchPointer(upSlot, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
    dispatchPointer(upSlot, 'pointermove', { pointerId: 1, clientX: 180, clientY: 100 });
    flushRaf();
    dispatchPointer(upSlot, 'pointerup', { pointerId: 1, clientX: 180, clientY: 100 });

    const moved = layout.visibleButtons().find((item) => item.placement.id === 'up');
    expect(moved?.placement.col).toBe(5); // startCol 3 + 80px / (480/12=40px per cell) = +2
    expect(sockets[0].sentMessages).toEqual([]);
  });

  it('treats a small movement below the drag threshold as a tap', async () => {
    const { layout, slot } = await setupCanvas(true);
    const upSlot = slot('up');
    const before = layout.visibleButtons().find((item) => item.placement.id === 'up')?.placement;

    dispatchPointer(upSlot, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
    dispatchPointer(upSlot, 'pointermove', { pointerId: 1, clientX: 103, clientY: 100 });
    dispatchPointer(upSlot, 'pointerup', { pointerId: 1, clientX: 103, clientY: 100 });

    const after = layout.visibleButtons().find((item) => item.placement.id === 'up')?.placement;
    expect(after).toEqual(before);
  });

  it('emits editButton on a tap (no movement) in edit mode', async () => {
    const { fixture, slot } = await setupCanvas(true);
    const upSlot = slot('up');
    let emitted: string | null = null;
    fixture.componentInstance.editButton.subscribe((id) => (emitted = id));

    dispatchPointer(upSlot, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
    dispatchPointer(upSlot, 'pointerup', { pointerId: 1, clientX: 100, clientY: 100 });

    expect(emitted).toBe('up');
  });

  it('keeps fractional coordinates after a drag when snap is off', async () => {
    const { layout, slot, flushRaf } = await setupCanvas(true);
    layout.setSnapToGrid(false);
    const upSlot = slot('up');

    dispatchPointer(upSlot, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
    dispatchPointer(upSlot, 'pointermove', { pointerId: 1, clientX: 120, clientY: 100 });
    flushRaf();
    dispatchPointer(upSlot, 'pointerup', { pointerId: 1, clientX: 120, clientY: 100 });

    const moved = layout.visibleButtons().find((item) => item.placement.id === 'up');
    expect(moved?.placement.col).toBeCloseTo(3.5); // 20px / 40px-per-cell = 0.5 cells
  });

  it('reverts a drag on pointercancel without persisting anything', async () => {
    const { layout, slot, flushRaf } = await setupCanvas(true);
    const upSlot = slot('up');
    const before = layout.visibleButtons().find((item) => item.placement.id === 'up')?.placement;

    dispatchPointer(upSlot, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
    dispatchPointer(upSlot, 'pointermove', { pointerId: 1, clientX: 200, clientY: 100 });
    flushRaf();
    dispatchPointer(upSlot, 'pointercancel', { pointerId: 1, clientX: 200, clientY: 100 });

    const after = layout.visibleButtons().find((item) => item.placement.id === 'up')?.placement;
    expect(after).toEqual(before);
  });

  it('shows the grid overlay in edit mode while snap is enabled', async () => {
    const editing = await setupCanvas(true);
    expect(editing.fixture.nativeElement.querySelector('.layout-grid')).not.toBeNull();

    editing.layout.setSnapToGrid(false);
    editing.fixture.detectChanges();
    expect(editing.fixture.nativeElement.querySelector('.layout-grid')).toBeNull();
  });

  it('hides the grid overlay outside edit mode', async () => {
    const viewing = await setupCanvas(false);
    expect(viewing.fixture.nativeElement.querySelector('.layout-grid')).toBeNull();
  });

  it('makes a disabled media button enabled (draggable) in edit mode', async () => {
    const edit = await setupCanvas(true);
    expect(edit.button('Stumm').disabled).toBe(false);
  });

  it('keeps a disabled media button non-interactive in view mode', async () => {
    const view = await setupCanvas(false);
    expect(view.button('Stumm').disabled).toBe(true);
  });
});

async function setupCanvas(editMode: boolean): Promise<CanvasHarness> {
  const sockets: MockRemoteSocket[] = [];
  const storage = new MemoryStorage();
  const rafCallbacks: FrameRequestCallback[] = [];

  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    rafCallbacks.push(callback);
    return rafCallbacks.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);

  await TestBed.configureTestingModule({
    imports: [ButtonCanvasComponent],
    providers: [
      { provide: REMOTE_STORAGE, useValue: storage },
      { provide: REMOTE_AUTO_CONNECT, useValue: false },
      { provide: BUTTON_ID_FACTORY, useValue: () => 'custom:test1' },
      {
        provide: REMOTE_WEBSOCKET_FACTORY,
        useValue: (url: string) => {
          const socket = new MockRemoteSocket(url);
          sockets.push(socket);
          return socket;
        },
      },
    ],
  }).compileComponents();

  const remote = TestBed.inject(RemoteService);
  remote.connect();
  sockets[0].open();
  const layout = TestBed.inject(ButtonLayoutService);

  const fixture = TestBed.createComponent(ButtonCanvasComponent);
  fixture.componentRef.setInput('editMode', editMode);
  fixture.detectChanges();
  await fixture.whenStable();

  const root = fixture.nativeElement as HTMLElement;
  const canvas = root.querySelector('.layout-canvas') as HTMLElement | null;

  if (canvas === null) {
    throw new Error('Canvas not found');
  }

  Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 480 });

  return {
    fixture,
    layout,
    sockets,
    flushRaf: () => {
      const callbacks = rafCallbacks.splice(0, rafCallbacks.length);

      for (const callback of callbacks) {
        callback(performance.now());
      }

      fixture.detectChanges();
    },
    slot: (id: string): HTMLElement => {
      const element = root.querySelector<HTMLElement>(`[data-button-id="${id}"]`);

      if (element === null) {
        throw new Error(`Slot not found: ${id}`);
      }

      stubPointerCapture(element);
      return element;
    },
    button: (ariaLabel: string): HTMLButtonElement => {
      const element = root.querySelector<HTMLButtonElement>(`button[aria-label="${ariaLabel}"]`);

      if (element === null) {
        throw new Error(`Button not found: ${ariaLabel}`);
      }

      return element;
    },
  };
}

function stubPointerCapture(element: HTMLElement): void {
  Object.defineProperty(element, 'setPointerCapture', {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(element, 'releasePointerCapture', {
    configurable: true,
    value: () => undefined,
  });
}

function dispatchPointer(
  target: HTMLElement,
  type: string,
  init: { readonly pointerId: number; readonly clientX: number; readonly clientY: number },
): void {
  const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;

  Object.defineProperties(event, {
    pointerId: { value: init.pointerId },
    clientX: { value: init.clientX },
    clientY: { value: init.clientY },
    button: { value: 0 },
    pointerType: { value: 'touch' },
  });

  target.dispatchEvent(event);
}
