import { inject, Injectable, InjectionToken, signal } from '@angular/core';
import { PairingService } from './pairing.service';
import { FileOfferMessage } from './remote.models';
import { getServerHttpBaseUrl, SERVER_LOCATION } from './server-config';

export const FILE_TRANSFER_FETCH = new InjectionToken<typeof fetch>('FILE_TRANSFER_FETCH', {
  providedIn: 'root',
  factory: () => globalThis.fetch.bind(globalThis),
});

/** Legt die geladene Datei im Download-Ordner des Geraets ab; austauschbar fuer Tests. */
export const FILE_SAVER = new InjectionToken<(blob: Blob, fileName: string) => void>('FILE_SAVER', {
  providedIn: 'root',
  factory: () => saveBlobAsDownload,
});

/** Haengt die Android-App (Bereich "Steuern", remote/RemoteWebActivity.kt) als
 *  window.YFRemoteDownloads ein: Ihr WebView kann blob:-Downloads nicht speichern, deshalb laedt
 *  die App die Datei selbst (Android-DownloadManager, gestreamt, mit Fortschrittsanzeige). */
export interface DownloadBridge {
  download(url: string, token: string, fileName: string): boolean;
}

export const DOWNLOAD_BRIDGE = new InjectionToken<DownloadBridge | null>('DOWNLOAD_BRIDGE', {
  providedIn: 'root',
  factory: () => (globalThis as { YFRemoteDownloads?: DownloadBridge }).YFRemoteDownloads ?? null,
});

export interface FileSendResult {
  readonly success: boolean;
  readonly fileName?: string;
  readonly error?: string;
}

interface FileUploadResponseBody {
  readonly success: boolean;
  readonly fileName?: string | null;
  readonly error?: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class FileTransferService {
  private readonly pairing = inject(PairingService);
  private readonly fetchFn = inject(FILE_TRANSFER_FETCH);
  private readonly serverLocation = inject(SERVER_LOCATION);

  private readonly sendingSignal = signal(false);
  readonly sending = this.sendingSignal.asReadonly();
  private readonly saveFile = inject(FILE_SAVER);
  private readonly downloadBridge = inject(DOWNLOAD_BRIDGE);

  private readonly downloadingSignal = signal(false);
  readonly downloading = this.downloadingSignal.asReadonly();

  /** Laedt die vom PC angebotene Datei. Per fetch statt Link, weil das Token nicht in die URL
   *  (und damit in Verlauf und Server-Logs) gehoert. */
  async downloadFile(offer: FileOfferMessage): Promise<boolean> {
    const token = this.pairing.token();
    if (token === null) {
      return false;
    }

    const url = `${getServerHttpBaseUrl(this.serverLocation)}/files/${encodeURIComponent(offer.id)}`;
    if (this.downloadBridge !== null) {
      return this.downloadBridge.download(url, token, offer.name);
    }

    this.downloadingSignal.set(true);

    try {
      const response = await this.fetchFn(url, { headers: { Authorization: `Bearer ${token}` } });

      if (!response.ok) {
        return false;
      }

      this.saveFile(await response.blob(), offer.name);
      return true;
    } catch {
      return false;
    } finally {
      this.downloadingSignal.set(false);
    }
  }

  async sendFile(file: File): Promise<FileSendResult> {
    const token = this.pairing.token();
    if (token === null) {
      return { success: false };
    }

    this.sendingSignal.set(true);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await this.fetchFn(`${getServerHttpBaseUrl(this.serverLocation)}/files`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      let body: FileUploadResponseBody | null = null;
      try {
        body = (await response.json()) as FileUploadResponseBody;
      } catch {
        // Fehlerantworten ohne JSON (z. B. 401) verwenden den generischen Fallback unten.
      }

      if (!response.ok || !body?.success) {
        return { success: false, error: body?.error?.trim() || undefined };
      }

      return { success: true, fileName: body.fileName ?? file.name };
    } catch {
      return { success: false };
    } finally {
      this.sendingSignal.set(false);
    }
  }
}

function saveBlobAsDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  // Sofortiges Freigeben bricht den Download in manchen Browsern ab, bevor er begonnen hat.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
