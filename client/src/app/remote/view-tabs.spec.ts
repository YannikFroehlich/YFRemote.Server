import { PROFILE_VIEWS } from './button-layout-profiles';
import {
  DEFAULT_VIEW_TAB_SETTINGS,
  normalizeViewTabSettings,
  parseStoredViewTabSettings,
} from './view-tabs';

describe('view tab settings', () => {
  it('falls back to the default order for missing or broken storage', () => {
    expect(parseStoredViewTabSettings(null)).toBe(DEFAULT_VIEW_TAB_SETTINGS);
    expect(parseStoredViewTabSettings('{kaputt')).toBe(DEFAULT_VIEW_TAB_SETTINGS);
    expect(parseStoredViewTabSettings('"text"')).toEqual(DEFAULT_VIEW_TAB_SETTINGS);
  });

  it('keeps the stored order, drops unknown and duplicate tabs and appends missing ones', () => {
    const settings = normalizeViewTabSettings({
      order: ['obs', 'remote', 'obs', 'unbekannt', 7],
      hidden: ['mixer', 'mixer', 'unbekannt'],
    });

    expect(settings.order.slice(0, 2)).toEqual(['obs', 'remote']);
    expect([...settings.order].sort()).toEqual([...PROFILE_VIEWS].sort());
    expect(settings.hidden).toEqual(['mixer']);
  });

  it('never hides the remote tab', () => {
    expect(normalizeViewTabSettings({ hidden: ['remote', 'touchpad'] }).hidden).toEqual([
      'touchpad',
    ]);
  });
});
