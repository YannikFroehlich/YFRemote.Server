import {
  Component,
  computed,
  ElementRef,
  inject,
  input,
  OnDestroy,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { ButtonLayoutService } from './button-layout.service';
import {
  labelVisibleFor,
  LAYOUT_COLUMNS,
  LAYOUT_GAP_PX,
  LAYOUT_ROW_HEIGHT_PX,
  PlacedButton,
  resolveButtonSteps,
} from './button-layout';
import { REMOTE_ICON_PATHS } from './remote-icons';
import { RemoteButtonConfig } from './remote.models';
import { RemoteService } from './remote.service';

const DRAG_THRESHOLD_PX = 6;

interface DragState {
  readonly pointerId: number;
  readonly id: string;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly startCol: number;
  readonly startRow: number;
  readonly cellWidthPx: number;
  moved: boolean;
}

interface DragPosition {
  readonly col: number;
  readonly row: number;
}

@Component({
  selector: 'app-button-canvas',
  templateUrl: './button-canvas.component.html',
  styleUrl: './button-canvas.component.scss',
})
export class ButtonCanvasComponent implements OnDestroy {
  private readonly remote = inject(RemoteService);

  protected readonly layout = inject(ButtonLayoutService);
  protected readonly iconPaths = REMOTE_ICON_PATHS;
  protected readonly columns = LAYOUT_COLUMNS;
  protected readonly rowHeight = LAYOUT_ROW_HEIGHT_PX;
  protected readonly gap = LAYOUT_GAP_PX;

  readonly editMode = input.required<boolean>();
  readonly editButton = output<string>();

  protected readonly draggingId = signal<string | null>(null);
  protected readonly dragPreview = signal<DragPosition | null>(null);

  protected readonly renderItems = computed<readonly PlacedButton[]>(() => {
    const draggingId = this.draggingId();
    const preview = this.dragPreview();

    if (draggingId === null || preview === null) {
      return this.layout.visibleButtons();
    }

    return this.layout.visibleButtons().map((item) =>
      item.placement.id === draggingId
        ? { ...item, placement: { ...item.placement, col: preview.col, row: preview.row } }
        : item,
    );
  });

  private readonly canvasRef = viewChild<ElementRef<HTMLElement>>('canvas');

  private drag: DragState | null = null;
  private pendingPreview: DragPosition | null = null;
  private animationFrameId: number | null = null;

  protected labelVisible(button: RemoteButtonConfig): boolean {
    return labelVisibleFor(button);
  }

  protected activate(item: PlacedButton): void {
    if (this.editMode() || item.button.disabled === true) {
      return;
    }

    const steps = resolveButtonSteps(item.button);

    if (steps.length === 0) {
      return;
    }

    void this.remote.runSteps(steps);
  }

  protected remove(item: PlacedButton): void {
    this.layout.hideButton(item.placement.id);
  }

  protected slotPointerDown(event: PointerEvent, item: PlacedButton): void {
    if (!this.editMode() || event.button !== 0) {
      return;
    }

    const target = event.currentTarget;

    if (!(target instanceof HTMLElement)) {
      return;
    }

    event.preventDefault();
    this.capturePointer(target, event.pointerId);

    const canvasWidth = this.canvasRef()?.nativeElement.clientWidth ?? 0;
    const cellWidthPx = canvasWidth > 0 ? canvasWidth / this.columns : 1;

    this.drag = {
      pointerId: event.pointerId,
      id: item.placement.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startCol: item.placement.col,
      startRow: item.placement.row,
      cellWidthPx,
      moved: false,
    };
    this.draggingId.set(item.placement.id);
  }

  protected slotPointerMove(event: PointerEvent): void {
    if (this.drag === null || this.drag.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();

    const deltaX = event.clientX - this.drag.startClientX;
    const deltaY = event.clientY - this.drag.startClientY;

    if (!this.drag.moved && Math.hypot(deltaX, deltaY) > DRAG_THRESHOLD_PX) {
      this.drag.moved = true;
    }

    if (!this.drag.moved) {
      return;
    }

    this.pendingPreview = {
      col: this.drag.startCol + deltaX / this.drag.cellWidthPx,
      row: this.drag.startRow + deltaY / this.rowHeight,
    };
    this.scheduleFlush();
  }

  protected slotPointerUp(event: PointerEvent, item: PlacedButton): void {
    if (this.drag === null || this.drag.pointerId !== event.pointerId) {
      return;
    }

    const drag = this.drag;
    const finalPreview = this.pendingPreview ?? this.dragPreview();
    this.releasePointer(event);
    this.endDrag();

    if (drag.moved && finalPreview !== null) {
      this.layout.movePlacement(drag.id, finalPreview.col, finalPreview.row);
    } else if (!drag.moved) {
      this.editButton.emit(item.placement.id);
    }
  }

  protected slotPointerCancel(event: PointerEvent): void {
    if (this.drag === null || this.drag.pointerId !== event.pointerId) {
      return;
    }

    this.endDrag();
  }

  protected slotKeydown(event: KeyboardEvent, item: PlacedButton): void {
    if (!this.editMode()) {
      return;
    }

    const step = this.layout.snapToGrid() ? 1 : 0.25;

    switch (event.key) {
      case 'ArrowUp':
        this.layout.movePlacement(item.placement.id, item.placement.col, item.placement.row - step);
        break;
      case 'ArrowDown':
        this.layout.movePlacement(item.placement.id, item.placement.col, item.placement.row + step);
        break;
      case 'ArrowLeft':
        this.layout.movePlacement(item.placement.id, item.placement.col - step, item.placement.row);
        break;
      case 'ArrowRight':
        this.layout.movePlacement(item.placement.id, item.placement.col + step, item.placement.row);
        break;
      case 'Delete':
        this.layout.hideButton(item.placement.id);
        break;
      case 'Enter':
      case ' ':
        this.editButton.emit(item.placement.id);
        break;
      default:
        return;
    }

    event.preventDefault();
  }

  ngOnDestroy(): void {
    this.cancelScheduledFlush();
  }

  private endDrag(): void {
    this.drag = null;
    this.pendingPreview = null;
    this.cancelScheduledFlush();
    this.draggingId.set(null);
    this.dragPreview.set(null);
  }

  private scheduleFlush(): void {
    if (this.animationFrameId !== null) {
      return;
    }

    this.animationFrameId = requestAnimationFrame(() => {
      this.animationFrameId = null;

      if (this.pendingPreview !== null) {
        this.dragPreview.set(this.pendingPreview);
      }
    });
  }

  private cancelScheduledFlush(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private capturePointer(target: Element, pointerId: number): void {
    if (typeof target.setPointerCapture === 'function') {
      try {
        target.setPointerCapture(pointerId);
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
}
