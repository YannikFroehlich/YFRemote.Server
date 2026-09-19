import { TestBed } from '@angular/core/testing';
import { REMOTE_AUTO_CONNECT, REMOTE_STORAGE } from './remote.service';
import { MAX_CUSTOM_THEMES } from './theme';
import { ThemeService } from './theme.service';
import { sampleCustomTheme } from './theme.fixtures';

function setup(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } as unknown as Storage;
  TestBed.configureTestingModule({
    providers: [
      { provide: REMOTE_STORAGE, useValue: storage },
      { provide: REMOTE_AUTO_CONNECT, useValue: false },
    ],
  });
  const root = document.documentElement;
  delete root.dataset['mode'];
  delete root.dataset['style'];
  root.removeAttribute('style');
  return { theme: TestBed.inject(ThemeService), values, root };
}

describe('ThemeService', () => {
  it('persists mode and style and writes the applied theme for the boot script', () => {
    const { theme, values, root } = setup();

    theme.saveMode('light');
    theme.saveStyle('futuristic');

    expect(values.get('yfremote.themeMode')).toBe('light');
    expect(values.get('yfremote.themeStyle')).toBe('futuristic');
    expect(root.dataset['mode']).toBe('light');
    expect(root.dataset['style']).toBe('futuristic');
    expect(JSON.parse(values.get('yfremote.appliedTheme') ?? '')).toEqual({
      mode: 'light',
      style: 'futuristic',
      props: {},
      themeColor: null,
    });
  });

  it('saves, activates and deletes custom themes', () => {
    const { theme, values, root } = setup();
    const custom = sampleCustomTheme();

    expect(theme.saveCustomTheme(custom)).toBe(true);
    theme.activateCustomTheme(custom.id);
    expect(theme.activeCustomTheme()?.name).toBe('Kino');
    expect(root.style.getPropertyValue('--accent')).toBe('#ff0000');
    expect(values.get('yfremote.activeCustomTheme')).toBe(custom.id);

    expect(theme.saveCustomTheme({ ...custom, name: 'Kino 2' })).toBe(true);
    expect(theme.customThemes()).toHaveLength(1);
    expect(theme.customThemes()[0].name).toBe('Kino 2');

    theme.deleteCustomTheme(custom.id);
    expect(theme.customThemes()).toEqual([]);
    expect(theme.activeCustomTheme()).toBeNull();
    expect(root.style.getPropertyValue('--accent')).toBe('');
    expect(values.has('yfremote.activeCustomTheme')).toBe(false);
  });

  it('restores stored custom themes and ignores invalid entries', () => {
    const custom = sampleCustomTheme();
    const { theme, root } = setup({
      'yfremote.customThemes': JSON.stringify([custom, { name: 'kaputt' }]),
      'yfremote.activeCustomTheme': custom.id,
    });

    expect(theme.customThemes()).toEqual([custom]);
    expect(root.dataset['style']).toBe('minimal');
    expect(root.style.getPropertyValue('--border-width')).toBe('2px');
  });

  it('previews without persisting and restores the saved theme', () => {
    const { theme, values, root } = setup();

    theme.preview(sampleCustomTheme());
    expect(root.style.getPropertyValue('--accent')).toBe('#ff0000');
    expect(values.has('yfremote.customThemes')).toBe(false);

    theme.preview(null);
    expect(root.style.getPropertyValue('--accent')).toBe('');
  });

  it('imports valid themes with fresh ids and respects the limit', () => {
    const { theme } = setup();
    const custom = sampleCustomTheme();

    expect(theme.importCustomThemes('nope')).toBeNull();
    expect(theme.importCustomThemes(JSON.stringify([custom, { bad: true }]))).toBe(1);
    expect(theme.customThemes()[0].id).not.toBe(custom.id);
    expect(JSON.parse(theme.exportCustomThemes())).toHaveLength(1);

    const many = Array.from({ length: MAX_CUSTOM_THEMES }, () => custom);
    expect(theme.importCustomThemes(JSON.stringify(many))).toBe(MAX_CUSTOM_THEMES - 1);
    expect(theme.saveCustomTheme({ ...custom, id: 'one-more' })).toBe(false);
  });
});
