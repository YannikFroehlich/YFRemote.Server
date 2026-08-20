import { computed, inject, Injectable, InjectionToken, signal } from '@angular/core';
import {
  BUTTON_LAYOUT_STORAGE_KEY,
  ButtonLayout,
  ButtonPlacement,
  CUSTOM_BUTTON_ID_PREFIX,
  DEFAULT_BUTTON_LAYOUT,
  LAYOUT_MIN_ROWS,
  MAX_CUSTOM_BUTTONS,
  PlacedButton,
  customButtonToConfig,
  findFreeSlot,
  isCustomButtonId,
  normalizeCustomButtonDefinition,
  parseStoredButtonLayout,
  resolveButtonLayout,
  roundPlacementForStorage,
  snapPlacement,
} from './button-layout';
import { BUILT_IN_BUTTONS, DEFAULT_PLACEMENTS } from './remote-actions';
import { RemoteButtonConfig, RemoteIcon } from './remote.models';
import { REMOTE_STORAGE } from './remote.service';

export const BUTTON_ID_FACTORY = new InjectionToken<() => string>('BUTTON_ID_FACTORY', {
  providedIn: 'root',
  factory: () => () =>
    `${CUSTOM_BUTTON_ID_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
});

export interface CustomButtonDraft {
  readonly label: string;
  readonly icon: RemoteIcon | null;
  readonly keys: readonly string[];
}

const DEFAULT_CUSTOM_SPAN = { colSpan: 3, rowSpan: 2 } as const;

@Injectable({
  providedIn: 'root',
})
export class ButtonLayoutService {
  private readonly storage = inject(REMOTE_STORAGE);
  private readonly nextId = inject(BUTTON_ID_FACTORY);
  private readonly builtIns: readonly RemoteButtonConfig[] = BUILT_IN_BUTTONS;

  private readonly layoutSignal = signal<ButtonLayout>(this.load());

  readonly layout = this.layoutSignal.asReadonly();
  readonly snapToGrid = computed(() => this.layoutSignal().snapToGrid);

  private readonly buttonsById = computed<ReadonlyMap<string, RemoteButtonConfig>>(() => {
    const map = new Map<string, RemoteButtonConfig>(
      this.builtIns.map((button) => [button.id, button]),
    );

    for (const custom of this.layoutSignal().customButtons) {
      map.set(custom.id, customButtonToConfig(custom));
    }

    return map;
  });

  /** Sortiert nach (row, col), damit DOM-Reihenfolge = Lesereihenfolge = Tab-Reihenfolge. */
  readonly visibleButtons = computed<readonly PlacedButton[]>(() => {
    const buttons = this.buttonsById();

    return [...this.layoutSignal().placements]
      .sort((a, b) => a.row - b.row || a.col - b.col)
      .flatMap((placement) => {
        const button = buttons.get(placement.id);
        return button === undefined
          ? []
          : [{ placement, button, isCustom: isCustomButtonId(placement.id) }];
      });
  });

  readonly hiddenButtons = computed<readonly RemoteButtonConfig[]>(() => {
    const buttons = this.buttonsById();

    return this.layoutSignal()
      .hiddenBuiltInIds.map((id) => buttons.get(id))
      .filter((button): button is RemoteButtonConfig => button !== undefined);
  });

  readonly visibleRows = computed(() => computeVisibleRows(this.layoutSignal().placements));

  setSnapToGrid(enabled: boolean): void {
    this.commit({ ...this.layoutSignal(), snapToGrid: enabled });
  }

  movePlacement(id: string, col: number, row: number): void {
    const current = this.layoutSignal();
    const existing = current.placements.find((placement) => placement.id === id);

    if (existing === undefined) {
      return;
    }

    const candidate: ButtonPlacement = { ...existing, col, row };
    const next = current.snapToGrid
      ? snapPlacement(candidate)
      : roundPlacementForStorage(candidate);

    this.commit({
      ...current,
      placements: current.placements.map((placement) => (placement.id === id ? next : placement)),
    });
  }

  hideButton(id: string): void {
    const current = this.layoutSignal();

    this.commit({
      ...current,
      placements: current.placements.filter((placement) => placement.id !== id),
      hiddenBuiltInIds: current.hiddenBuiltInIds.includes(id)
        ? current.hiddenBuiltInIds
        : [...current.hiddenBuiltInIds, id],
    });
  }

  restoreButton(id: string): void {
    const current = this.layoutSignal();

    if (
      !current.hiddenBuiltInIds.includes(id) ||
      current.placements.some((placement) => placement.id === id)
    ) {
      return;
    }

    const defaultSpan = DEFAULT_PLACEMENTS.find((placement) => placement.id === id);
    const colSpan = defaultSpan?.colSpan ?? DEFAULT_CUSTOM_SPAN.colSpan;
    const rowSpan = defaultSpan?.rowSpan ?? DEFAULT_CUSTOM_SPAN.rowSpan;
    const slot = findFreeSlot(current.placements, colSpan, rowSpan);

    this.commit({
      ...current,
      placements: [...current.placements, { id, col: slot.col, row: slot.row, colSpan, rowSpan }],
      hiddenBuiltInIds: current.hiddenBuiltInIds.filter((hiddenId) => hiddenId !== id),
    });
  }

  addCustomButton(draft: CustomButtonDraft): boolean {
    const current = this.layoutSignal();

    if (current.customButtons.length >= MAX_CUSTOM_BUTTONS) {
      return false;
    }

    const definition = normalizeCustomButtonDefinition({
      id: this.nextId(),
      label: draft.label,
      icon: draft.icon,
      action: { keys: draft.keys },
    });

    if (definition === null) {
      return false;
    }

    const slot = findFreeSlot(current.placements, DEFAULT_CUSTOM_SPAN.colSpan, DEFAULT_CUSTOM_SPAN.rowSpan);
    const placement: ButtonPlacement = {
      id: definition.id,
      col: slot.col,
      row: slot.row,
      ...DEFAULT_CUSTOM_SPAN,
    };

    this.commit({
      ...current,
      customButtons: [...current.customButtons, definition],
      placements: [...current.placements, placement],
    });

    return true;
  }

  updateCustomButton(id: string, draft: CustomButtonDraft): boolean {
    const current = this.layoutSignal();

    if (!current.customButtons.some((definition) => definition.id === id)) {
      return false;
    }

    const definition = normalizeCustomButtonDefinition({
      id,
      label: draft.label,
      icon: draft.icon,
      action: { keys: draft.keys },
    });

    if (definition === null) {
      return false;
    }

    this.commit({
      ...current,
      customButtons: current.customButtons.map((existing) =>
        existing.id === id ? definition : existing,
      ),
    });

    return true;
  }

  deleteCustomButton(id: string): void {
    const current = this.layoutSignal();

    this.commit({
      ...current,
      customButtons: current.customButtons.filter((definition) => definition.id !== id),
      placements: current.placements.filter((placement) => placement.id !== id),
      hiddenBuiltInIds: current.hiddenBuiltInIds.filter((hiddenId) => hiddenId !== id),
    });
  }

  resetLayout(): void {
    const current = this.layoutSignal();
    const placements: ButtonPlacement[] = [...DEFAULT_PLACEMENTS];

    for (const custom of current.customButtons) {
      const slot = findFreeSlot(
        placements,
        DEFAULT_CUSTOM_SPAN.colSpan,
        DEFAULT_CUSTOM_SPAN.rowSpan,
      );
      placements.push({ id: custom.id, col: slot.col, row: slot.row, ...DEFAULT_CUSTOM_SPAN });
    }

    this.commit({
      version: DEFAULT_BUTTON_LAYOUT.version,
      snapToGrid: current.snapToGrid,
      placements,
      customButtons: current.customButtons,
      hiddenBuiltInIds: [],
    });
  }

  private commit(next: ButtonLayout): void {
    const resolved = resolveButtonLayout(next, this.builtIns);
    this.layoutSignal.set(resolved);
    this.storage?.setItem(BUTTON_LAYOUT_STORAGE_KEY, JSON.stringify(resolved));
  }

  private load(): ButtonLayout {
    return parseStoredButtonLayout(this.storage?.getItem(BUTTON_LAYOUT_STORAGE_KEY) ?? null);
  }
}

function computeVisibleRows(placements: readonly ButtonPlacement[]): number {
  const maxRow = placements.reduce(
    (max, placement) => Math.max(max, placement.row + placement.rowSpan),
    0,
  );
  return Math.max(LAYOUT_MIN_ROWS, maxRow);
}
