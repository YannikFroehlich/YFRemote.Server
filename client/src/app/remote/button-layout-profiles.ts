import {
  BUTTON_LAYOUT_VERSION,
  ButtonLayout,
  DEFAULT_BUTTON_LAYOUT,
  normalizeButtonLayout,
} from './button-layout';
import { ANDROID_BUILT_IN_BUTTONS, ANDROID_DEFAULT_PLACEMENTS } from './remote-actions';

export const BUTTON_LAYOUT_PROFILES_STORAGE_KEY = 'yfremote.buttonLayoutProfiles';
export const BUTTON_LAYOUT_PROFILES_VERSION = 1;
export const DEFAULT_PROFILE_ID = 'profile:standard';
/** Profil fuer einen Android-Server; wird bei der ersten Android-Verbindung angelegt. */
export const ANDROID_PROFILE_ID = 'profile:android';
export const MAX_LAYOUT_PROFILES = 20;
export const MAX_PROFILE_NAME_LENGTH = 40;
export const MAX_PROFILE_APPS = 20;
/** Wie `MaxAppNameLength` am Server. */
export const MAX_PROFILE_APP_LENGTH = 100;

export interface ButtonLayoutProfile {
  readonly id: string;
  readonly name: string;
  readonly layout: ButtonLayout;
  /** Programme (Name wie im Mixer), bei denen der automatische Profilwechsel dieses Profil nimmt. */
  readonly apps?: readonly string[];
  /** Tab, auf den der automatische Wechsel dazu geht; ohne bleibt der Tab, wie er ist. */
  readonly view?: ProfileView;
}

/** Tabs, die ein Profil beim automatischen Wechsel oeffnen kann (Werte wie `RemoteView`). */
export const PROFILE_VIEWS = [
  'remote',
  'touchpad',
  'screen',
  'keyboard',
  'presentation',
  'gamepad',
  'system',
  'mixer',
] as const;
export type ProfileView = (typeof PROFILE_VIEWS)[number];

export function normalizeProfileView(candidate: unknown): ProfileView | null {
  return PROFILE_VIEWS.find((view) => view === candidate) ?? null;
}

/** Ein Profil mit neuen Programmen und neuem Tab; leere Werte fallen ganz weg. */
export function withProfileExtras(
  profile: ButtonLayoutProfile,
  apps: readonly string[] | undefined,
  view: ProfileView | null | undefined,
): ButtonLayoutProfile {
  const base: { -readonly [K in keyof ButtonLayoutProfile]: ButtonLayoutProfile[K] } = {
    id: profile.id,
    name: profile.name,
    layout: profile.layout,
  };
  if (apps !== undefined && apps.length > 0) {
    base.apps = apps;
  }
  if (view != null) {
    base.view = view;
  }
  return base;
}

/** Bereinigt die Programmliste eines Profils: getrimmt, ohne Doppelte, begrenzt. */
export function normalizeProfileApps(candidate: unknown): readonly string[] {
  if (!Array.isArray(candidate)) {
    return [];
  }

  const apps: string[] = [];
  for (const entry of candidate) {
    const name = typeof entry === 'string' ? entry.trim() : '';
    if (
      name.length > 0 &&
      name.length <= MAX_PROFILE_APP_LENGTH &&
      !apps.some((app) => sameApp(app, name)) &&
      apps.length < MAX_PROFILE_APPS
    ) {
      apps.push(name);
    }
  }

  return apps;
}

export function sameApp(a: string, b: string): boolean {
  return a.localeCompare(b, 'de-DE', { sensitivity: 'base' }) === 0;
}

/** Das Profil, das zum Programm vorne passt; Android hat keine Programme. */
export function findProfileForApp(
  profiles: readonly ButtonLayoutProfile[],
  app: string | null,
): ButtonLayoutProfile | undefined {
  return app === null
    ? undefined
    : profiles.find(
        (profile) =>
          profile.id !== ANDROID_PROFILE_ID && profile.apps?.some((name) => sameApp(name, app)),
      );
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
  // Gegen die eigenen eingebauten Buttons pruefen - sonst verliert das Android-Profil bei jedem
  // Laden Home/Uebersicht/Sperren als "unbekannte Id" (ButtonLayoutService.builtIns).
  const layout =
    value.id === ANDROID_PROFILE_ID
      ? normalizeButtonLayout(value.layout, ANDROID_BUILT_IN_BUTTONS, ANDROID_DEFAULT_PLACEMENTS)
      : normalizeButtonLayout(value.layout);

  if (
    typeof value.id !== 'string' ||
    !/^profile:[a-z0-9_-]{1,64}$/i.test(value.id) ||
    name === null ||
    layout === null ||
    layout.version !== BUTTON_LAYOUT_VERSION
  ) {
    return null;
  }

  return withProfileExtras(
    { id: value.id, name, layout },
    normalizeProfileApps(value.apps),
    normalizeProfileView(value.view),
  );
}
