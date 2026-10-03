import { DOCUMENT } from '@angular/common';
import { computed, effect, inject, Injectable, untracked } from '@angular/core';
import {
  ClipboardService,
  DEVICE_CLIPBOARD_READER,
  DEVICE_CLIPBOARD_WRITER,
} from './clipboard.service';
import { RemoteService } from './remote.service';

/** Automatischer Zwischenablage-Abgleich. PC -> Gerät: der Server meldet jeden neu kopierten
 *  Text, er wird sofort (oder, ohne Fokus, beim Zurückkehren in die App) übernommen.
 *  Gerät -> PC: ein Browser meldet Kopiervorgänge anderer Apps nicht, deshalb wird beim
 *  Zurückkehren in die App nachgesehen, ob sich die Zwischenablage geändert hat. */
@Injectable({
  providedIn: 'root',
})
export class ClipboardSyncService {
  private readonly remote = inject(RemoteService);
  private readonly clipboard = inject(ClipboardService);
  private readonly writeDevice = inject(DEVICE_CLIPBOARD_WRITER);
  private readonly readDevice = inject(DEVICE_CLIPBOARD_READER);
  private readonly document = inject(DOCUMENT);

  /** Die Async-Clipboard-API gibt es nur im sicheren Kontext (HTTPS), dazu muss der Server mitmachen. */
  readonly secureContextAvailable = this.writeDevice !== null;
  readonly available = computed(
    () => this.secureContextAvailable && this.remote.clipboardSyncSupported(),
  );
  private readonly active = computed(
    () => this.available() && this.remote.clipboardSync() && this.remote.status() === 'connected',
  );

  // Der Text, den beide Seiten zuletzt hatten. Weicht die Gerätezwischenablage davon ab, wurde
  // dort neu kopiert; so schickt auch das Echo des PCs nichts zurück.
  private knownText: string | null = null;
  private pendingPcText: string | null = null;

  constructor() {
    effect(() => {
      const push = this.remote.pcClipboard();
      if (push !== null && untracked(this.active)) {
        void this.applyPcText(push.text);
      }
    });

    // Beim (Wieder-)Verbinden einmal nachsehen: das erste Lesen setzt nur den Ausgangsstand.
    effect(() => {
      if (this.active()) {
        void untracked(() => this.checkDeviceClipboard());
      }
    });

    const onReturn = () => void this.onReturn();
    this.document.addEventListener('visibilitychange', onReturn);
    this.document.defaultView?.addEventListener('focus', onReturn);
  }

  private async applyPcText(text: string): Promise<void> {
    // Das Echo eines eben vom Gerät gesendeten Texts.
    if (text === this.knownText) {
      return;
    }

    this.knownText = text;
    this.pendingPcText = text;

    // Ohne Fokus lehnt der Browser das Schreiben ab - dann beim Zurückkehren.
    if (this.document.hasFocus()) {
      await this.writePending();
    }
  }

  private async onReturn(): Promise<void> {
    if (!this.active() || this.document.visibilityState !== 'visible') {
      return;
    }

    if (this.pendingPcText !== null) {
      await this.writePending();
      return;
    }

    await this.checkDeviceClipboard();
  }

  private async writePending(): Promise<void> {
    const text = this.pendingPcText;
    if (text === null || this.writeDevice === null) {
      return;
    }

    // Vor dem Schreiben austragen: Fokus und Sichtbarkeit melden die Rückkehr beide.
    this.pendingPcText = null;
    try {
      await this.writeDevice(text);
    } catch {
      // Wieder vormerken fürs nächste Zurückkehren, außer es kam inzwischen Neueres.
      this.pendingPcText ??= text;
    }
  }

  private async checkDeviceClipboard(): Promise<void> {
    if (this.readDevice === null) {
      return;
    }

    let text: string;
    try {
      text = await this.readDevice();
    } catch {
      return;
    }

    if (!text || text === this.knownText) {
      return;
    }

    const baseline = this.knownText === null;
    this.knownText = text;
    if (!baseline) {
      await this.clipboard.sendText(text);
    }
  }
}
