import { Component, inject, InjectionToken } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { SwUpdate } from '@angular/service-worker';
import { EMPTY, filter, map } from 'rxjs';
import { RemoteControlComponent } from './remote/remote-control.component';
import { PairingGateComponent } from './remote/pairing-gate.component';
import { PairingService } from './remote/pairing.service';
import { ThemeService } from './remote/theme.service';
import { TranslationService } from './remote/translation.service';

/** Wie die Tokens in remote.service.ts: Browser-API austauschbar, damit Tests nicht neu laden. */
export const PAGE_RELOAD = new InjectionToken<() => void>('PAGE_RELOAD', {
  providedIn: 'root',
  factory: () => () => globalThis.location.reload(),
});

@Component({
  selector: 'app-root',
  imports: [RemoteControlComponent, PairingGateComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly pairing = inject(PairingService);
  protected readonly i18n = inject(TranslationService);
  // Früh erzeugen, damit Hell/Dunkel und Stil auch vor dem Koppeln gelten.
  private readonly theme = inject(ThemeService);
  private readonly reloadPage = inject(PAGE_RELOAD);
  // Nur mit aktivem Service Worker (Produktions-Build) gibt es SwUpdate. Er laedt eine neue
  // Version im Hintergrund, zeigt aber bis zum naechsten Laden weiter die alte - ohne diesen
  // Hinweis kam ein Update erst nach zweimal Neuladen an.
  private readonly swUpdate = inject(SwUpdate, { optional: true });
  protected readonly updateReady = toSignal(
    this.swUpdate?.isEnabled
      ? this.swUpdate.versionUpdates.pipe(
          filter((event) => event.type === 'VERSION_READY'),
          map(() => true),
        )
      : EMPTY,
    { initialValue: false },
  );

  protected reload(): void {
    this.reloadPage();
  }
}
