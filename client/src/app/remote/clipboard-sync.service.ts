import { DOCUMENT } from '@angular/common';
import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import {
  CLIPBOARD_AUTO_SYNC_PROBE,
  ClipboardService,
  DEVICE_CLIPBOARD_IMAGE_WRITER,
  DEVICE_CLIPBOARD_READER,
  DEVICE_CLIPBOARD_WRITER,
  DeviceClipboardContent,
} from './clipboard.service';
import { ClipboardPushMessage } from './remote.models';
import { RemoteService } from './remote.service';

// Ein haengender Abruf (WLAN weg) soll den Abgleich nicht fuer immer blockieren.
const TASK_TIMEOUT_MS = 15_000;

/** Automatischer Zwischenablage-Abgleich, Text und Bilder. PC -> Gerät: der Server meldet jeden
 *  neu kopierten Text oder die Kennung eines Bilds, es wird sofort (oder, ohne Fokus, beim
 *  Zurückkehren in die App) übernommen. Gerät -> PC: ein Browser meldet Kopiervorgänge anderer
 *  Apps nicht, deshalb wird beim Zurückkehren in die App und vor Strg+V im Bildschirm
 *  nachgesehen, ob sich die Zwischenablage geändert hat. */
@Injectable({
  providedIn: 'root',
})
export class ClipboardSyncService {
  private readonly remote = inject(RemoteService);
  private readonly clipboard = inject(ClipboardService);
  private readonly writeDevice = inject(DEVICE_CLIPBOARD_WRITER);
  private readonly writeDeviceImage = inject(DEVICE_CLIPBOARD_IMAGE_WRITER);
  private readonly readDevice = inject(DEVICE_CLIPBOARD_READER);
  private readonly document = inject(DOCUMENT);
  private readonly probeAutoSync = inject(CLIPBOARD_AUTO_SYNC_PROBE);

  /** Die Async-Clipboard-API gibt es nur im sicheren Kontext (HTTPS), dazu muss der Server mitmachen. */
  readonly secureContextAvailable = this.writeDevice !== null;
  private readonly browserAllowsAutoSyncSignal = signal(false);
  readonly browserAllowsAutoSync = this.browserAllowsAutoSyncSignal.asReadonly();
  readonly available = computed(
    () =>
      this.secureContextAvailable &&
      this.browserAllowsAutoSync() &&
      this.remote.clipboardSyncSupported(),
  );
  readonly active = computed(
    () => this.available() && this.remote.clipboardSync() && this.remote.status() === 'connected',
  );
  /** Strg+V im Tab "Bildschirm" nimmt den Inhalt aus dem paste-Ereignis: das geht auch ohne HTTPS
   *  und ohne Clipboard-API, nur die Richtung PC -> Gerät braucht sie. */
  readonly pasteActive = computed(
    () =>
      this.remote.clipboardSyncSupported() &&
      this.remote.clipboardSync() &&
      this.remote.status() === 'connected',
  );

  // Was jede Seite zuletzt hatte, als Schluessel (contentKey). Weicht die Gerätezwischenablage
  // davon ab, wurde dort neu kopiert; so schickt auch das Echo des PCs nichts zurück.
  private deviceKey: string | null = null;
  private pcKey: string | null = null;
  private pendingPc: DeviceClipboardContent | null = null;
  // Alles nacheinander: die Antwort auf ein gesendetes Bild nennt die Kennung, mit der der PC
  // es gleich wieder meldet - die muss bekannt sein, bevor diese Meldung geprüft wird.
  private queue: Promise<void> = Promise.resolve();

  constructor() {
    if (this.secureContextAvailable) {
      void this.probeAutoSync().then((allowed) => this.browserAllowsAutoSyncSignal.set(allowed));
    }

    effect(() => {
      const push = this.remote.pcClipboard();
      if (push !== null && untracked(this.active)) {
        void this.enqueue(() => this.applyPc(push));
      }
    });

    // Beim (Wieder-)Verbinden einmal nachsehen: das erste Lesen setzt nur den Ausgangsstand.
    effect(() => {
      if (this.active()) {
        void untracked(() => this.enqueue(() => this.checkDevice()));
      }
    });

    const onReturn = () => void this.enqueue(() => this.onReturn());
    this.document.addEventListener('visibilitychange', onReturn);
    this.document.defaultView?.addEventListener('focus', onReturn);
  }

  /** Vor Strg+V im Bildschirm: was der Browser beim Einfügen liefert, geht vorher an den PC,
   *  falls es neu ist. Wirkt nur bei eingeschaltetem Abgleich. */
  syncPasted(content: DeviceClipboardContent): Promise<void> {
    return this.enqueue(async () => {
      // Unverändert seit dem letzten Mal: dann hat der PC womöglich Neueres, etwa dort Kopiertes,
      // das ohne HTTPS nie hierher kam - das bleibt stehen.
      if (content !== '' && this.pasteActive()) {
        const key = await contentKey(content);
        if (key !== this.deviceKey) {
          this.deviceKey = key;
          await this.send(content);
          // Das paste-Ereignis kodiert ein Bild anders, als es spaeter ausgelesen wird; ohne den
          // ausgelesenen Schluessel ginge es beim naechsten Zurueckkehren noch einmal hoch.
          if (content instanceof Blob) {
            this.deviceKey = await contentKey((await this.tryReadDevice()) ?? content);
          }
        }
      }
    });
  }

  /** Eingefügte Dateien: erst gesendet gelten sie als bekannt, damit dasselbe Strg+V sie nicht
   *  noch einmal schickt. */
  deviceFilesChanged(files: readonly File[]): boolean {
    return filesKey(files) !== this.deviceKey;
  }

  noteDeviceFiles(files: readonly File[]): void {
    this.deviceKey = filesKey(files);
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = () =>
      Promise.race([
        task().catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, TASK_TIMEOUT_MS)),
      ]);
    this.queue = this.queue.then(run, run);
    return this.queue;
  }

  private async applyPc(push: ClipboardPushMessage): Promise<void> {
    const key = push.text !== undefined ? textKey(push.text) : `p:${push.imageId}`;
    // Das Echo eines eben vom Gerät gesendeten Inhalts.
    if (key === this.pcKey) {
      return;
    }

    this.pcKey = key;
    if (push.text !== undefined) {
      this.deviceKey = key;
      this.pendingPc = push.text;
    } else {
      // Ohne ClipboardItem (ältere Browser) kann das Gerät kein Bild aufnehmen.
      if (this.writeDeviceImage === null) {
        return;
      }
      const result = await this.clipboard.readImage();
      if (!result.image) {
        return;
      }
      this.pendingPc = result.image;
    }

    // Ohne Fokus lehnt der Browser das Schreiben ab - dann beim Zurückkehren.
    if (this.document.hasFocus()) {
      await this.writePending();
    }
  }

  private async onReturn(): Promise<void> {
    if (!this.active() || this.document.visibilityState !== 'visible') {
      return;
    }

    if (this.pendingPc !== null) {
      await this.writePending();
      return;
    }

    await this.checkDevice();
  }

  private async writePending(): Promise<void> {
    const content = this.pendingPc;
    if (content === null) {
      return;
    }

    // Vor dem Schreiben austragen: Fokus und Sichtbarkeit melden die Rückkehr beide.
    this.pendingPc = null;
    try {
      await (typeof content === 'string'
        ? this.writeDevice?.(content)
        : this.writeDeviceImage?.(content));
    } catch {
      // Wieder vormerken fürs nächste Zurückkehren, außer es kam inzwischen Neueres.
      this.pendingPc ??= content;
      return;
    }

    if (content instanceof Blob) {
      // Der Browser speichert das Bild in eigener Kodierung; ausgelesen kommt es anders zurück
      // als geschrieben. Der Schlüssel des ausgelesenen Bilds verhindert, dass es zurückgeht.
      this.deviceKey = await contentKey((await this.tryReadDevice()) ?? content);
    }
  }

  private async checkDevice(): Promise<void> {
    const content = await this.tryReadDevice();
    if (!content) {
      return;
    }

    const key = await contentKey(content);
    if (key === this.deviceKey) {
      return;
    }

    const baseline = this.deviceKey === null;
    this.deviceKey = key;
    if (!baseline) {
      await this.send(content);
    }
  }

  private async tryReadDevice(): Promise<DeviceClipboardContent | null> {
    try {
      return (await this.readDevice?.()) ?? null;
    } catch {
      return null;
    }
  }

  private async send(content: DeviceClipboardContent): Promise<void> {
    if (typeof content === 'string') {
      if ((await this.clipboard.sendText(content)).success) {
        this.pcKey = textKey(content);
      }
      return;
    }

    const result = await this.clipboard.sendImage(content);
    if (result.success && result.imageId) {
      this.pcKey = `p:${result.imageId}`;
    }
  }
}

function filesKey(files: readonly File[]): string {
  return 'f:' + files.map((file) => `${file.name}/${file.size}/${file.lastModified}`).join('|');
}

function textKey(text: string): string {
  return `t:${text}`;
}

async function contentKey(content: DeviceClipboardContent): Promise<string> {
  if (typeof content === 'string') {
    return textKey(content);
  }

  // crypto.subtle gibt es nur im sicheren Kontext; ohne HTTPS kommen Bilder nur per Strg+V.
  // ponytail: dort zaehlen Groesse und Typ, ein gleich grosses neues Bild ginge nicht noch einmal hoch.
  if (globalThis.crypto?.subtle === undefined) {
    return `i:${content.size}:${content.type}`;
  }

  const digest = await crypto.subtle.digest('SHA-256', await content.arrayBuffer());
  return 'i:' + Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
