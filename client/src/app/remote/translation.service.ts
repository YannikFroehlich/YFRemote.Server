import { inject, Injectable, signal } from '@angular/core';
import { REMOTE_STORAGE } from './remote.service';
import { Lang, LANGUAGE_STORAGE_KEY, parseStoredLang, translate } from './translation';

@Injectable({ providedIn: 'root' })
export class TranslationService {
  private readonly storage = inject(REMOTE_STORAGE);

  private readonly languageSignal = signal(
    parseStoredLang(this.storage?.getItem(LANGUAGE_STORAGE_KEY) ?? null),
  );

  readonly language = this.languageSignal.asReadonly();

  setLanguage(lang: Lang): void {
    this.languageSignal.set(lang);
    this.storage?.setItem(LANGUAGE_STORAGE_KEY, lang);
  }

  readonly t = (key: string, params?: Readonly<Record<string, string | number>>): string =>
    translate(this.languageSignal(), key, params);
}
