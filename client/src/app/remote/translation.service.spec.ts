import { TestBed } from '@angular/core/testing';
import { REMOTE_AUTO_CONNECT, REMOTE_STORAGE } from './remote.service';
import { LANGUAGE_STORAGE_KEY } from './translation';
import { TranslationService } from './translation.service';

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
  return { translation: TestBed.inject(TranslationService), values };
}

describe('TranslationService', () => {
  it('defaults to German when nothing is stored', () => {
    const { translation } = setup();

    expect(translation.language()).toBe('de');
    expect(translation.t('common.save')).toBe('Speichern');
  });

  it('restores a previously stored language', () => {
    const { translation } = setup({ [LANGUAGE_STORAGE_KEY]: 'en' });

    expect(translation.language()).toBe('en');
    expect(translation.t('common.save')).toBe('Save');
  });

  it('persists a language change and reflects it in t()', () => {
    const { translation, values } = setup();

    translation.setLanguage('en');

    expect(translation.language()).toBe('en');
    expect(values.get(LANGUAGE_STORAGE_KEY)).toBe('en');
    expect(translation.t('common.save')).toBe('Save');
  });
});
