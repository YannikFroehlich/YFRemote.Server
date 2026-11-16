import { DOCUMENT } from '@angular/common';
import { Component, DestroyRef, inject, ChangeDetectionStrategy } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { SwUpdate } from '@angular/service-worker';
import { EMPTY, filter, map } from 'rxjs';
import { RemoteControlComponent } from './remote/remote-control.component';
import { PairingGateComponent } from './remote/pairing-gate.component';
import { GamepadComponent } from './remote/gamepad/gamepad.component';
import { BLUETOOTH_GAMEPAD_BRIDGE } from './remote/gamepad/gamepad-transport';
import { IS_IOS, PAGE_RELOAD, preventEdgeSwipe, watchKeyboardInset } from './remote/device';
import { PairingService } from './remote/pairing.service';
import { ThemeService } from './remote/theme.service';
import { TranslationService } from './remote/translation.service';

@Component({
  selector: 'app-root',
  imports: [RemoteControlComponent, PairingGateComponent, GamepadComponent],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './app.scss',
})
export class App {
  // In der Android-App (Bereich "Controller") nur der Controller, per Bluetooth statt WebSocket.
  protected readonly bluetooth = inject(BLUETOOTH_GAMEPAD_BRIDGE);
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

  constructor() {
    const document = inject(DOCUMENT);
    const destroyRef = inject(DestroyRef);
    if (document.defaultView) {
      destroyRef.onDestroy(watchKeyboardInset(document.defaultView));
    }
    if (inject(IS_IOS)) {
      destroyRef.onDestroy(preventEdgeSwipe(document));
    }
  }

  protected reload(): void {
    this.reloadPage();
  }
}
