import { inject, Injectable, InjectionToken, signal } from '@angular/core';
import { PairingService } from './pairing.service';
import { FileOfferMessage } from './remote.models';
import { getServerHttpBaseUrl, SERVER_LOCATION } from './server-config';

export const FILE_TRANSFER_FETCH = new InjectionToken<typeof fetch>('FILE_TRANSFER_FETCH', {
  providedIn: 'root',
  factory: () => globalThis.fetch.bind(globalThis),
});

export interface FileUploadResponse {
  readonly status: number;
  readonly body: string;
}

export type FileUploader = (
  url: string,
  token: string,
  body: FormData,
  onProgress: (fraction: number) => void,
) => Promise<FileUploadResponse>;

/** Upload per XMLHttpRequest statt fetch: Nur XHR meldet den Upload-Fortschritt. */
export const FILE_UPLOADER = new InjectionToken<FileUploader>('FILE_UPLOADER', {
  providedIn: 'root',
  factory: () => uploadWithXhr,
});

/** Haengt die Android-App (Bereich "Steuern", remote/RemoteWebActivity.kt) als
 *  window.YFRemoteDownloads ein: Ihr WebView kann blob:-Downloads nicht speichern, deshalb laedt
 *  die App die Datei selbst (Android-DownloadManager, gestreamt, mit Fortschrittsanzeige). */
export interface DownloadBridge {
  download(url: string, token: string, fileName: string): boolean;
  /** Erst im Web-Client entstandene Dateien (Exporte, Bild aus der PC-Zwischenablage); fehlt in
   *  aelteren App-Versionen. */
  save?(fileName: string, mimeType: string, base64: string): boolean;
}

export const DOWNLOAD_BRIDGE = new InjectionToken<DownloadBridge | null>('DOWNLOAD_BRIDGE', {
  providedIn: 'root',
  factory: () => (globalThis as { YFRemoteDownloads?: DownloadBridge }).YFRemoteDownloads ?? null,
});

/** Legt eine Datei im Download-Ordner des Geraets ab; austauschbar fuer Tests. */
export const FILE_SAVER = new InjectionToken<(blob: Blob, fileName: string) => Promise<boolean>>(
  'FILE_SAVER',
  {
    providedIn: 'root',
    factory: () => {
      const bridge = inject(DOWNLOAD_BRIDGE);
      if (bridge === null) {
        return saveBlobAsDownload;
      }
      // Eine aeltere App ohne save(): ein blob:-Link taete dort nichts, also ehrlich scheitern.
      return async (blob, fileName) =>
        bridge.save?.(fileName, blob.type || 'application/octet-stream', await toBase64(blob)) ??
        false;
    },
  },
);

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

  private readonly uploader = inject(FILE_UPLOADER);

  private readonly sendingSignal = signal(false);
  readonly sending = this.sendingSignal.asReadonly();
  /** Anteil 0..1 des laufenden Uploads, `null` ohne Upload. */
  private readonly uploadProgressSignal = signal<number | null>(null);
  readonly uploadProgress = this.uploadProgressSignal.asReadonly();
  private readonly saveFile = inject(FILE_SAVER);
  private readonly downloadBridge = inject(DOWNLOAD_BRIDGE);

  private readonly downloadingSignal = signal(false);
  readonly downloading = this.downloadingSignal.asReadonly();

  /** Laedt die vom PC angebotene Datei. Per fetch statt Link, weil das Token nicht in die URL
   *  (und damit in Verlauf und Server-Logs) gehoert. */
  downloadFile(offer: FileOfferMessage): Promise<boolean> {
    return this.download(`/files/${encodeURIComponent(offer.id)}`, offer.name);
  }

  /** Laedt eine Datei aus dem Empfangsordner des PCs (`GET /folder`). */
  downloadFolderFile(name: string): Promise<boolean> {
    return this.download(`/folder/${encodeURIComponent(name)}`, name);
  }

  private async download(path: string, name: string): Promise<boolean> {
    const token = this.pairing.token();
    if (token === null) {
      return false;
    }

    const url = `${getServerHttpBaseUrl(this.serverLocation)}${path}`;
    if (this.downloadBridge !== null) {
      return this.downloadBridge.download(url, token, name);
    }

    this.downloadingSignal.set(true);

    try {
      const response = await this.fetchFn(url, { headers: { Authorization: `Bearer ${token}` } });

      if (!response.ok) {
        return false;
      }

      return await this.saveFile(await response.blob(), name);
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
    this.uploadProgressSignal.set(0);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await this.uploader(
        `${getServerHttpBaseUrl(this.serverLocation)}/files`,
        token,
        formData,
        (fraction) => this.uploadProgressSignal.set(Math.min(Math.max(fraction, 0), 1)),
      );

      let body: FileUploadResponseBody | null = null;
      try {
        body = JSON.parse(response.body) as FileUploadResponseBody;
      } catch {
        // Fehlerantworten ohne JSON (z. B. 401) verwenden den generischen Fallback unten.
      }

      const ok = response.status >= 200 && response.status < 300;
      if (!ok || !body?.success) {
        return { success: false, error: body?.error?.trim() || undefined };
      }

      return { success: true, fileName: body.fileName ?? file.name };
    } catch {
      return { success: false };
    } finally {
      this.sendingSignal.set(false);
      this.uploadProgressSignal.set(null);
    }
  }
}

function uploadWithXhr(
  url: string,
  token: string,
  body: FormData,
  onProgress: (fraction: number) => void,
): Promise<FileUploadResponse> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', url);
    request.setRequestHeader('Authorization', `Bearer ${token}`);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(event.loaded / event.total);
      }
    };
    request.onload = () => resolve({ status: request.status, body: request.responseText });
    request.onerror = () => reject(new Error('Upload failed.'));
    request.onabort = () => reject(new Error('Upload aborted.'));
    request.send(body);
  });
}

async function saveBlobAsDownload(blob: Blob, fileName: string): Promise<boolean> {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  // Sofortiges Freigeben bricht den Download in manchen Browsern ab, bevor er begonnen hat.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.slice(dataUrl.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
