import { Component, inject, OnDestroy } from '@angular/core';
import { RemoteAction } from '../remote.models';
import { RemoteService } from '../remote.service';

interface PointerPosition {
  x: number;
  y: number;
  startX: number;
  startY: number;
  totalMovement: number;
  startedAt: number;
  canTap: boolean;
}

type PointerMode = 'idle' | 'move' | 'scroll' | 'ignore';
type MouseButtonName = 'left' | 'right' | 'middle';

const TAP_MAX_DURATION_MS = 260;
const TAP_MAX_MOVEMENT_PX = 8;
const SCROLL_SCALE = 6;
const MAX_SCROLL_DELTA = 1200;

@Component({
  selector: 'app-touchpad',
  templateUrl: './touchpad.component.html',
  styleUrl: './touchpad.component.scss',
})
export class TouchpadComponent implements OnDestroy {
  private readonly remote = inject(RemoteService);
  private readonly pointers = new Map<number, PointerPosition>();
  private readonly heldButtons = new Map<MouseButtonName, number>();

  private pointerMode: PointerMode = 'idle';
  private lastScrollCenterX: number | null = null;
  private lastScrollCenterY: number | null = null;
  private pendingMoveX = 0;
  private pendingMoveY = 0;
  private pendingScrollDeltaX = 0;
  private pendingScrollDeltaY = 0;
  private animationFrameId: number | null = null;

  protected pointerDown(event: PointerEvent): void {
    this.preventBrowserGesture(event);
    this.capturePointer(event);

    this.pointers.set(event.pointerId, this.createPointerPosition(event));
    this.resolveModeAfterPointerChange();
  }

  protected pointerMove(event: PointerEvent): void {
    const pointer = this.pointers.get(event.pointerId);

    if (pointer === undefined) {
      return;
    }

    this.preventBrowserGesture(event);

    if (this.pointerMode === 'move' && this.pointers.size === 1) {
      this.collectMove(pointer, event);
      return;
    }

    this.updatePointerPosition(pointer, event);

    if (this.pointerMode === 'scroll' && this.pointers.size === 2) {
      this.collectScroll();
    }
  }

  protected pointerUp(event: PointerEvent): void {
    const pointer = this.pointers.get(event.pointerId);

    if (pointer === undefined) {
      return;
    }

    this.preventBrowserGesture(event);
    this.releasePointer(event);
    this.updatePointerPosition(pointer, event);

    const shouldClick = this.shouldClick(pointer);

    this.flushPendingActions();
    this.pointers.delete(event.pointerId);

    if (shouldClick) {
      this.sendAction({ type: 'mouseClick', button: 'left' });
    }

    this.resolveModeAfterPointerChange();
  }

  protected pointerCancel(event: PointerEvent): void {
    this.preventBrowserGesture(event);
    this.releasePointer(event);
    this.resetPointers();
  }

  protected lostPointerCapture(event: PointerEvent): void {
    this.pointers.delete(event.pointerId);
    this.resolveModeAfterPointerChange();
  }

  protected preventContextMenu(event: Event): void {
    event.preventDefault();
  }

  /** Antippen und Halten hält die Maustaste gedrückt (wie eine echte Maustaste), sodass
   *  parallel auf der Touchpad-Fläche gezogen werden kann; Loslassen gibt sie wieder frei. */
  protected mouseButtonDown(button: MouseButtonName, event: PointerEvent): void {
    event.preventDefault();

    if (this.heldButtons.has(button)) {
      return;
    }

    this.capturePointer(event);
    this.heldButtons.set(button, event.pointerId);
    this.sendAction({ type: 'mouseDown', button });
  }

  protected mouseButtonRelease(button: MouseButtonName, event: PointerEvent): void {
    if (this.heldButtons.get(button) !== event.pointerId) {
      return;
    }

    event.preventDefault();
    this.releasePointer(event);
    this.heldButtons.delete(button);
    this.sendAction({ type: 'mouseUp', button });
  }

  /** Sicherheitsnetz: eine unterbrochene Geste (z. B. Browser übernimmt den Pointer) darf
   *  die Maustaste auf dem PC nicht für immer gedrückt lassen. */
  protected mouseButtonCancel(button: MouseButtonName, event: PointerEvent): void {
    if (this.heldButtons.get(button) !== event.pointerId) {
      return;
    }

    this.heldButtons.delete(button);
    this.sendAction({ type: 'mouseUp', button });
  }

  protected isButtonHeld(button: MouseButtonName): boolean {
    return this.heldButtons.has(button);
  }

  protected submitText(event: Event, input: HTMLInputElement): void {
    event.preventDefault();

    const text = input.value;

    if (text.length === 0) {
      return;
    }

    this.sendAction({ type: 'text', text });
    input.value = '';
  }

  ngOnDestroy(): void {
    this.resetPointers();
    this.releaseAllHeldButtons();
  }

  private collectMove(pointer: PointerPosition, event: PointerEvent): void {
    const deltaX = event.clientX - pointer.x;
    const deltaY = event.clientY - pointer.y;

    this.updatePointerPosition(pointer, event);

    if (deltaX === 0 && deltaY === 0) {
      return;
    }

    this.pendingMoveX += deltaX * this.remote.mouseSensitivity();
    this.pendingMoveY += deltaY * this.remote.mouseSensitivity();
    this.scheduleFlush();
  }

  private collectScroll(): void {
    const scrollCenterX = this.getAverageX();
    const scrollCenterY = this.getAverageY();

    if (scrollCenterX === null || scrollCenterY === null) {
      return;
    }

    if (this.lastScrollCenterX === null || this.lastScrollCenterY === null) {
      this.lastScrollCenterX = scrollCenterX;
      this.lastScrollCenterY = scrollCenterY;
      return;
    }

    const deltaX = scrollCenterX - this.lastScrollCenterX;
    const deltaY = scrollCenterY - this.lastScrollCenterY;
    this.lastScrollCenterX = scrollCenterX;
    this.lastScrollCenterY = scrollCenterY;

    if (deltaX === 0 && deltaY === 0) {
      return;
    }

    this.pendingScrollDeltaX += deltaX * SCROLL_SCALE;
    this.pendingScrollDeltaY += deltaY * SCROLL_SCALE;
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.animationFrameId !== null) {
      return;
    }

    this.animationFrameId = requestAnimationFrame(() => {
      this.animationFrameId = null;
      this.flushPendingActions();

      if (
        Math.abs(this.pendingMoveX) >= 1 ||
        Math.abs(this.pendingMoveY) >= 1 ||
        Math.abs(this.pendingScrollDeltaX) >= 1 ||
        Math.abs(this.pendingScrollDeltaY) >= 1
      ) {
        this.scheduleFlush();
      }
    });
  }

  private flushPendingActions(): void {
    this.flushPendingMove();
    this.flushPendingScroll();
  }

  private flushPendingMove(): void {
    const deltaX = Math.round(this.pendingMoveX);
    const deltaY = Math.round(this.pendingMoveY);

    if (deltaX === 0 && deltaY === 0) {
      return;
    }

    this.pendingMoveX -= deltaX;
    this.pendingMoveY -= deltaY;
    this.sendAction({ type: 'mouseMove', deltaX, deltaY });
  }

  private flushPendingScroll(): void {
    const deltaX = this.clampScrollDelta(Math.round(this.pendingScrollDeltaX));
    const deltaY = this.clampScrollDelta(Math.round(this.pendingScrollDeltaY));

    if (deltaX === 0 && deltaY === 0) {
      return;
    }

    this.pendingScrollDeltaX -= deltaX;
    this.pendingScrollDeltaY -= deltaY;

    this.sendAction({
      type: 'mouseScroll',
      ...(deltaY !== 0 ? { delta: deltaY } : {}),
      ...(deltaX !== 0 ? { deltaX } : {}),
    });
  }

  private resolveModeAfterPointerChange(): void {
    const pointerCount = this.pointers.size;

    if (pointerCount === 0) {
      this.pointerMode = 'idle';
      this.lastScrollCenterX = null;
      this.lastScrollCenterY = null;
      return;
    }

    if (pointerCount === 1) {
      this.pointerMode = 'move';
      this.lastScrollCenterX = null;
      this.lastScrollCenterY = null;
      this.resetRemainingPointerBaseline();
      return;
    }

    this.flushPendingActions();
    this.markAllPointersAsNonTap();

    if (pointerCount === 2) {
      this.pointerMode = 'scroll';
      this.lastScrollCenterX = this.getAverageX();
      this.lastScrollCenterY = this.getAverageY();
      return;
    }

    this.pointerMode = 'ignore';
    this.lastScrollCenterX = null;
    this.lastScrollCenterY = null;
  }

  private shouldClick(pointer: PointerPosition): boolean {
    return (
      this.pointerMode === 'move' &&
      this.pointers.size === 1 &&
      pointer.canTap &&
      pointer.totalMovement <= TAP_MAX_MOVEMENT_PX &&
      performance.now() - pointer.startedAt <= TAP_MAX_DURATION_MS
    );
  }

  private resetRemainingPointerBaseline(): void {
    const remainingPointer = Array.from(this.pointers.values())[0];

    if (remainingPointer === undefined) {
      return;
    }

    remainingPointer.startX = remainingPointer.x;
    remainingPointer.startY = remainingPointer.y;
    remainingPointer.totalMovement = 0;
  }

  private markAllPointersAsNonTap(): void {
    for (const pointer of this.pointers.values()) {
      pointer.canTap = false;
    }
  }

  private updatePointerPosition(pointer: PointerPosition, event: PointerEvent): void {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.totalMovement = Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY);

    if (pointer.totalMovement > TAP_MAX_MOVEMENT_PX) {
      pointer.canTap = false;
    }
  }

  private createPointerPosition(event: PointerEvent): PointerPosition {
    return {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      totalMovement: 0,
      startedAt: performance.now(),
      canTap: true,
    };
  }

  private getAverageX(): number | null {
    if (this.pointers.size === 0) {
      return null;
    }

    let totalX = 0;

    for (const pointer of this.pointers.values()) {
      totalX += pointer.x;
    }

    return totalX / this.pointers.size;
  }

  private getAverageY(): number | null {
    if (this.pointers.size === 0) {
      return null;
    }

    let totalY = 0;

    for (const pointer of this.pointers.values()) {
      totalY += pointer.y;
    }

    return totalY / this.pointers.size;
  }

  private clampScrollDelta(delta: number): number {
    return Math.max(-MAX_SCROLL_DELTA, Math.min(MAX_SCROLL_DELTA, delta));
  }

  private sendAction(action: RemoteAction): void {
    this.remote.sendAction(action);
  }

  private resetPointers(): void {
    this.pointers.clear();
    this.pointerMode = 'idle';
    this.lastScrollCenterX = null;
    this.lastScrollCenterY = null;
    this.pendingMoveX = 0;
    this.pendingMoveY = 0;
    this.pendingScrollDeltaX = 0;
    this.pendingScrollDeltaY = 0;

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private releaseAllHeldButtons(): void {
    for (const button of this.heldButtons.keys()) {
      this.sendAction({ type: 'mouseUp', button });
    }

    this.heldButtons.clear();
  }

  private capturePointer(event: PointerEvent): void {
    const target = event.currentTarget;

    if (target instanceof Element && typeof target.setPointerCapture === 'function') {
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        return;
      }
    }
  }

  private releasePointer(event: PointerEvent): void {
    const target = event.currentTarget;

    if (target instanceof Element && typeof target.releasePointerCapture === 'function') {
      try {
        target.releasePointerCapture(event.pointerId);
      } catch {
        return;
      }
    }
  }

  private preventBrowserGesture(event: PointerEvent): void {
    event.preventDefault();
  }
}
