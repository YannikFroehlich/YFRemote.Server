import {
  BUTTON_LAYOUT_VERSION,
  ButtonLayout,
  DEFAULT_BUTTON_LAYOUT,
  normalizeButtonLayout,
} from './button-layout';

export const BUTTON_LAYOUT_PROFILES_STORAGE_KEY = 'yfremote.buttonLayoutProfiles';
export const BUTTON_LAYOUT_PROFILES_VERSION = 1;
export const DEFAULT_PROFILE_ID = 'profile:standard';
export const MAX_LAYOUT_PROFILES = 20;
export const MAX_PROFILE_NAME_LENGTH = 40;

export interface ButtonLayoutProfile {
  readonly id: string;
  readonly name: string;
  readonly layout: ButtonLayout;
}

export interface ButtonLayoutProfileStore {
  readonly schemaVersion: number;
  readonly activeProfileId: string;
  readonly profiles: readonly ButtonLayoutProfile[];
}

export interface LayoutProfileState {
  readonly activeProfileId: string;
  readonly profiles: readonly ButtonLayoutProfile[];
}

export function createDefaultProfileState(
  layout: ButtonLayout = DEFAULT_BUTTON_LAYOUT,
): LayoutProfileState {
  return {
    activeProfileId: DEFAULT_PROFILE_ID,
    profiles: [{ id: DEFAULT_PROFILE_ID, name: 'Standard', layout }],
  };
}

export function normalizeProfileName(candidate: unknown): string | null {
  if (typeof candidate !== 'string') {
    return null;
  }

  const name = candidate.trim().replace(/\s+/g, ' ');
  return name.length > 0 && name.length <= MAX_PROFILE_NAME_LENGTH ? name : null;
}

export function parseStoredProfileState(
  rawValue: string | null,
  fallbackLayout: ButtonLayout,
): LayoutProfileState {
  if (rawValue === null) {
    return createDefaultProfileState(fallbackLayout);
  }

  try {
    return normalizeProfileStore(JSON.parse(rawValue)) ?? createDefaultProfileState(fallbackLayout);
  } catch {
    return createDefaultProfileState(fallbackLayout);
  }
}

export function importProfileState(rawValue: string): LayoutProfileState | null {
  try {
    return normalizeProfileStore(JSON.parse(rawValue));
  } catch {
    return null;
  }
}

export function serializeProfileState(state: LayoutProfileState): string {
  const store: ButtonLayoutProfileStore = {
    schemaVersion: BUTTON_LAYOUT_PROFILES_VERSION,
    activeProfileId: state.activeProfileId,
    profiles: state.profiles,
  };

  return JSON.stringify(store, null, 2);
}

function normalizeProfileStore(candidate: unknown): LayoutProfileState | null {
  if (typeof candidate !== 'object' || candidate === null) {
    return null;
  }

  const value = candidate as Partial<ButtonLayoutProfileStore>;
  if (
    value.schemaVersion !== BUTTON_LAYOUT_PROFILES_VERSION ||
    typeof value.activeProfileId !== 'string' ||
    !Array.isArray(value.profiles) ||
    value.profiles.length === 0 ||
    value.profiles.length > MAX_LAYOUT_PROFILES
  ) {
    return null;
  }

  const profiles: ButtonLayoutProfile[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();

  for (const candidateProfile of value.profiles) {
    const profile = normalizeProfile(candidateProfile);
    const normalizedName = profile?.name.toLocaleLowerCase('de-DE');

    if (
      profile === null ||
      ids.has(profile.id) ||
      normalizedName === undefined ||
      names.has(normalizedName)
    ) {
      return null;
    }

    ids.add(profile.id);
    names.add(normalizedName);
    profiles.push(profile);
  }

  if (!ids.has(value.activeProfileId)) {
    return null;
  }

  return { activeProfileId: value.activeProfileId, profiles };
}

function normalizeProfile(candidate: unknown): ButtonLayoutProfile | null {
  if (typeof candidate !== 'object' || candidate === null) {
    return null;
  }

  const value = candidate as Partial<ButtonLayoutProfile>;
  const name = normalizeProfileName(value.name);
  const layout = normalizeButtonLayout(value.layout);

  if (
    typeof value.id !== 'string' ||
    !/^profile:[a-z0-9_-]{1,64}$/i.test(value.id) ||
    name === null ||
    layout === null ||
    layout.version !== BUTTON_LAYOUT_VERSION
  ) {
    return null;
  }

  return { id: value.id, name, layout };
}
