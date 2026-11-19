import { normalizeProfileView, PROFILE_VIEWS, ProfileView } from './button-layout-profiles';

export const VIEW_TABS_STORAGE_KEY = 'yfremote.viewTabs';

// "Nur Medien": Eingaben ausser Medientasten, den Bildschirm und OBS lehnt der PC ab.
export const INPUT_VIEWS: ReadonlySet<ProfileView> = new Set([
  'touchpad',
  'screen',
  'keyboard',
  'presentation',
  'gamepad',
  'obs',
]);

/** label ist ein Key ins Uebersetzungs-Dictionary oder ein Name, der in jeder Sprache gleich ist. */
export const VIEW_TAB_DETAILS: Readonly<
  Record<ProfileView, { readonly label: string; readonly icon: string }>
> = {
  remote: {
    label: 'Remote',
    icon: 'M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-5l1.5 2H8.5l1.5-2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm0 2v8h14V7H5Z',
  },
  touchpad: {
    label: 'Touchpad',
    icon: 'M7 2h10a4 4 0 0 1 4 4v12a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4Zm0 2a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H7Zm5 2a1 1 0 0 1 1 1v3a1 1 0 1 1-2 0V7a1 1 0 0 1 1-1Z',
  },
  screen: {
    label: 'shell.tabScreen',
    icon: 'M3 4h18a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-7v2h3v2H7v-2h3v-2H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 2v9h16V6H4Z',
  },
  keyboard: {
    label: 'shell.tabKeyboard',
    icon: 'M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm0 2v10h16V7H4Zm2 2h2v2H6V9Zm4 0h2v2h-2V9Zm4 0h2v2h-2V9Zm4 0h1v2h-1V9ZM6 13h2v2H6v-2Zm4 0h8v2h-8v-2Z',
  },
  presentation: {
    label: 'shell.tabPresentation',
    icon: 'M3 3h18v2h-1v10a2 2 0 0 1-2 2h-5v2.6l2.7 1.8-1.1 1.6-2.6-1.7-2.6 1.7-1.1-1.6 2.7-1.8V17H6a2 2 0 0 1-2-2V5H3V3Zm3 2v10h12V5H6Zm2 7 3-3 2 2 3-3 1.4 1.4L13 13.8l-2-2-1.6 1.6L8 12Z',
  },
  gamepad: {
    label: 'shell.tabGamepad',
    icon: 'M7 7h10a5 5 0 0 1 4.9 6l-.8 4a3 3 0 0 1-5.1 1.5L14.6 17H9.4L8 18.5A3 3 0 0 1 2.9 17l-.8-4A5 5 0 0 1 7 7Zm0 3v1.5H5.5v1H7V14h1v-1.5h1.5v-1H8V10H7Zm9 .5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm2 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z',
  },
  system: {
    label: 'shell.tabSystem',
    icon: 'M4 19h16v2H4v-2Zm1-8h3v6H5v-6Zm5-6h3v12h-3V5Zm5 3h3v9h-3V8Z',
  },
  mixer: {
    label: 'shell.tabMixer',
    icon: 'M6 3h2v6h2v4H8v8H6v-8H4V9h2V3Zm5 0h2v10h2v4h-2v4h-2v-4H9v-4h2V3Zm5 0h2v2h2v4h-2v12h-2V9h-2V5h2V3Z',
  },
  obs: {
    label: 'OBS',
    icon: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 3a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  },
};

export interface ViewTabSettings {
  /** Alle Tabs in der gewaehlten Reihenfolge, auch die ausgeblendeten. */
  readonly order: readonly ProfileView[];
  readonly hidden: readonly ProfileView[];
}

// Selten gebraucht: Folien, Controller und OBS kommen erst nach dem Einschalten unter "Tabs" in die
// Leiste. Wer schon eigene Tab-Einstellungen gespeichert hat, behaelt sie.
export const DEFAULT_VIEW_TAB_SETTINGS: ViewTabSettings = {
  order: PROFILE_VIEWS,
  hidden: ['presentation', 'gamepad', 'obs'],
};

export function normalizeViewTabSettings(candidate: unknown): ViewTabSettings {
  if (typeof candidate !== 'object' || candidate === null) {
    return DEFAULT_VIEW_TAB_SETTINGS;
  }

  const value = candidate as { readonly order?: unknown; readonly hidden?: unknown };
  const order = uniqueViews(value.order);
  // Ein Tab aus einer neueren Version haengt sich hinten an, statt zu fehlen.
  order.push(...PROFILE_VIEWS.filter((view) => !order.includes(view)));
  // Remote bleibt immer: dorthin weicht die Leiste aus, wenn der offene Tab wegfaellt.
  const hidden = uniqueViews(value.hidden).filter((view) => view !== 'remote');
  return { order, hidden };
}

export function parseStoredViewTabSettings(rawValue: string | null): ViewTabSettings {
  if (rawValue === null) {
    return DEFAULT_VIEW_TAB_SETTINGS;
  }

  try {
    return normalizeViewTabSettings(JSON.parse(rawValue));
  } catch {
    return DEFAULT_VIEW_TAB_SETTINGS;
  }
}

function uniqueViews(candidate: unknown): ProfileView[] {
  const views: ProfileView[] = [];
  for (const entry of Array.isArray(candidate) ? candidate : []) {
    const view = normalizeProfileView(entry);
    if (view !== null && !views.includes(view)) {
      views.push(view);
    }
  }
  return views;
}
