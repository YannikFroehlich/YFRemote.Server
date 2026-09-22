import { inject, Injectable, InjectionToken, signal } from '@angular/core';
import { PairingService } from './pairing.service';
import { getServerHttpBaseUrl, SERVER_LOCATION } from './server-config';

export const FILE_TRANSFER_FETCH = new InjectionToken<typeof fetch>('FILE_TRANSFER_FETCH', {
  providedIn: 'root',
  factory: () => globalThis.fetch.bind(globalThis),
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
