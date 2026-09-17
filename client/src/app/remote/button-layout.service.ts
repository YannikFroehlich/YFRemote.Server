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
import {
  BUTTON_LAYOUT_PROFILES_STORAGE_KEY,
  LayoutProfileState,
  MAX_LAYOUT_PROFILES,
  importProfileState,
  normalizeProfileName,
  parseStoredProfileState,
  serializeProfileState,
} from './button-layout-profiles';
import { BUILT_IN_BUTTONS, DEFAULT_PLACEMENTS } from './remote-actions';
import { MacroStep, RemoteButtonConfig, RemoteIcon } from './remote.models';
import { REMOTE_STORAGE } from './remote.service';

export const BUTTON_ID_FACTORY = new InjectionToken<() => string>('BUTTON_ID_FACTORY', {
  providedIn: 'root',
  factory: () => () =>
    `${CUSTOM_BUTTON_ID_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
});

export const PROFILE_ID_FACTORY = new InjectionToken<() => string>('PROFILE_ID_FACTORY', {
  providedIn: 'root',
  factory: () => () =>
    `profile:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
});

export interface CustomButtonDraft {
  readonly label: string;
  readonly icon: RemoteIcon | null;
  readonly steps: readonly MacroStep[];
}

const DEFAULT_CUSTOM_SPAN = { colSpan: 3, rowSpan: 2 } as const;

@Injectable({
  providedIn: 'root',
})
export class ButtonLayoutService {
  private readonly storage = inject(REMOTE_STORAGE);
  private readonly nextId = inject(BUTTON_ID_FACTORY);
  private readonly nextProfileId = inject(PROFILE_ID_FACTORY);
  private readonly builtIns: readonly RemoteButtonConfig[] = BUILT_IN_BUTTONS;

  private readonly initialProfileState = this.loadProfileState();
  private readonly profilesSignal = signal(this.initialProfileState.profiles);
  private readonly activeProfileIdSignal = signal(this.initialProfileState.activeProfileId);
  private readonly layoutSignal = signal<ButtonLayout>(
    this.getActiveLayout(this.initialProfileState),
  );
  private readonly profileErrorSignal = signal<string | null>(null);

  readonly layout = this.layoutSignal.asReadonly();
  readonly snapToGrid = computed(() => this.layoutSignal().snapToGrid);
  readonly profiles = this.profilesSignal.asReadonly();
  readonly activeProfileId = this.activeProfileIdSignal.asReadonly();
  readonly profileError = this.profileErrorSignal.asReadonly();

  private readonly buttonsById = computed<ReadonlyMap<string, RemoteButtonConfig>>(() => {
    const map = new Map<string, RemoteButtonConfig>(
      this.builtIns.map((button) => [button.id, button]),
    );

    for (const custom of this.layoutSignal().customButtons) {
      map.set(custom.id, customButtonToConfig(custom));
    }

    return map;
  });

  /** Liefert einen Button (eingebaut oder eigen) unabhängig von seiner Herkunft. */
  getButton(id: string): RemoteButtonConfig | undefined {
    return this.buttonsById().get(id);
  }

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

  createProfile(rawName: string): boolean {
    this.profileErrorSignal.set(null);
    const name = normalizeProfileName(rawName);
    const profiles = this.profilesSignal();

    if (name === null) {
      this.profileErrorSignal.set('Profilname darf 1 bis 40 Zeichen lang sein.');
      return false;
    }
    if (
      profiles.some(
        (profile) => profile.name.localeCompare(name, 'de-DE', { sensitivity: 'base' }) === 0,
      )
    ) {
      this.profileErrorSignal.set('Ein Profil mit diesem Namen ist bereits vorhanden.');
      return false;
    }
    if (profiles.length >= MAX_LAYOUT_PROFILES) {
      this.profileErrorSignal.set(`Es sind höchstens ${MAX_LAYOUT_PROFILES} Profile möglich.`);
      return false;
    }

    const id = this.createUniqueProfileId();
    const nextProfiles = [...profiles, { id, name, layout: this.layoutSignal() }];
    this.profilesSignal.set(nextProfiles);
    this.activeProfileIdSignal.set(id);
    this.persistProfileState();
    return true;
  }

  switchProfile(id: string): boolean {
    this.profileErrorSignal.set(null);
    const profile = this.profilesSignal().find((candidate) => candidate.id === id);
    if (profile === undefined) {
      this.profileErrorSignal.set('Das ausgewählte Profil ist nicht vorhanden.');
      return false;
    }

    this.activeProfileIdSignal.set(profile.id);
    this.layoutSignal.set(profile.layout);
    this.persistProfileState();
    return true;
  }

  deleteProfile(id: string): boolean {
    this.profileErrorSignal.set(null);
    const profiles = this.profilesSignal();
    if (profiles.length <= 1) {
      this.profileErrorSignal.set('Mindestens ein Profil muss erhalten bleiben.');
      return false;
    }
    if (!profiles.some((profile) => profile.id === id)) {
      this.profileErrorSignal.set('Das ausgewählte Profil ist nicht vorhanden.');
      return false;
    }

    const remainingProfiles = profiles.filter((profile) => profile.id !== id);
    const activeProfile =
      id === this.activeProfileIdSignal()
        ? remainingProfiles[0]
        : (remainingProfiles.find((profile) => profile.id === this.activeProfileIdSignal()) ??
          remainingProfiles[0]);

    this.profilesSignal.set(remainingProfiles);
    this.activeProfileIdSignal.set(activeProfile.id);
    this.layoutSignal.set(activeProfile.layout);
    this.persistProfileState();
    return true;
  }

  exportProfiles(): string {
    return serializeProfileState({
      activeProfileId: this.activeProfileIdSignal(),
      profiles: this.profilesSignal(),
    });
  }

  importProfiles(rawValue: string): boolean {
    this.profileErrorSignal.set(null);
    const imported = importProfileState(rawValue);
    if (imported === null) {
      this.profileErrorSignal.set('Die Datei enthält keine gültigen YFRemote-Layoutprofile.');
      return false;
    }

    this.profilesSignal.set(imported.profiles);
    this.activeProfileIdSignal.set(imported.activeProfileId);
    this.layoutSignal.set(this.getActiveLayout(imported));
    this.persistProfileState();
    return true;
  }

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
      steps: draft.steps,
    });

    if (definition === null) {
      return false;
    }

    const slot = findFreeSlot(
      current.placements,
      DEFAULT_CUSTOM_SPAN.colSpan,
      DEFAULT_CUSTOM_SPAN.rowSpan,
    );
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
      steps: draft.steps,
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
    this.profilesSignal.update((profiles) =>
      profiles.map((profile) =>
        profile.id === this.activeProfileIdSignal() ? { ...profile, layout: resolved } : profile,
      ),
    );
    this.persistProfileState();
  }

  private loadProfileState(): LayoutProfileState {
    const legacyLayout = parseStoredButtonLayout(
      this.storage?.getItem(BUTTON_LAYOUT_STORAGE_KEY) ?? null,
    );
    return parseStoredProfileState(
      this.storage?.getItem(BUTTON_LAYOUT_PROFILES_STORAGE_KEY) ?? null,
      legacyLayout,
    );
  }

  private getActiveLayout(state: LayoutProfileState): ButtonLayout {
    return (
      state.profiles.find((profile) => profile.id === state.activeProfileId)?.layout ??
      DEFAULT_BUTTON_LAYOUT
    );
  }

  private persistProfileState(): void {
    const state: LayoutProfileState = {
      activeProfileId: this.activeProfileIdSignal(),
      profiles: this.profilesSignal(),
    };

    this.storage?.setItem(BUTTON_LAYOUT_PROFILES_STORAGE_KEY, serializeProfileState(state));
    this.storage?.setItem(BUTTON_LAYOUT_STORAGE_KEY, JSON.stringify(this.layoutSignal()));
  }

  private createUniqueProfileId(): string {
    const existingIds = new Set(this.profilesSignal().map((profile) => profile.id));

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = this.nextProfileId();
      if (/^profile:[a-z0-9_-]{1,64}$/i.test(candidate) && !existingIds.has(candidate)) {
        return candidate;
      }
    }

    return `profile:${Date.now().toString(36)}-${this.profilesSignal().length}`;
  }
}

function computeVisibleRows(placements: readonly ButtonPlacement[]): number {
  const maxRow = placements.reduce(
    (max, placement) => Math.max(max, placement.row + placement.rowSpan),
    0,
  );
  return Math.max(LAYOUT_MIN_ROWS, maxRow);
}
