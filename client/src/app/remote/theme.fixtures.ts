import { CustomTheme } from './theme';

/** Gültiger eigener Stil für Tests. */
export function sampleCustomTheme(overrides: Partial<CustomTheme> = {}): CustomTheme {
  return {
    id: 'theme-1',
    name: 'Kino',
    base: 'minimal',
    mode: 'dark',
    values: {
      accent: '#ff0000',
      background: '#000000',
      surface: '#101010',
      raised: '#202020',
      text: '#ffffff',
      muted: '#808080',
      line: '#ffffff',
      danger: '#ff8800',
      borderWidth: 2,
      radius: 0.5,
      pillCorners: false,
      shadow: 0,
      decor: 1,
      grid: 0,
      font: 'mono',
      displayFont: 'serif',
      fontScale: 1.1,
    },
    advanced: {},
    ...overrides,
  };
}
