import { inject, Injectable, InjectionToken } from '@angular/core';
import { PairingService } from './pairing.service';
import { getServerHttpBaseUrl, SERVER_LOCATION } from './server-config';

export const CLIPBOARD_FETCH = new InjectionToken<typeof fetch>('CLIPBOARD_FETCH', {
  providedIn: 'root',
  factory: () => globalThis.fetch.bind(globalThis),
});

export interface ClipboardSendResult {
  readonly success: boolean;
  readonly error?: string;
}

interface ClipboardResponseBody {
  readonly success: boolean;
  readonly error?: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class ClipboardService {
  private readonly pairing = inject(PairingService);
  private readonly fetchFn = inject(CLIPBOARD_FETCH);
  private readonly serverLocation = inject(SERVER_LOCATION);

  async sendText(text: string): Promise<ClipboardSendResult> {
    return this.send('/clipboard/text', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  }

  async sendImage(file: File): Promise<ClipboardSendResult> {
    const formData = new FormData();
    formData.append('file', file);

    return this.send('/clipboard/image', { body: formData });
  }

  private async send(
    path: string,
    init: { headers?: Record<string, string>; body: BodyInit },
  ): Promise<ClipboardSendResult> {
    const token = this.pairing.token();
    if (token === null) {
      return { success: false };
    }

    try {
      const response = await this.fetchFn(`${getServerHttpBaseUrl(this.serverLocation)}${path}`, {
        method: 'POST',
        headers: { ...init.headers, Authorization: `Bearer ${token}` },
        body: init.body,
      });

      let body: ClipboardResponseBody | null = null;
      try {
        body = (await response.json()) as ClipboardResponseBody;
      } catch {
        // Fehlerantworten ohne JSON (z. B. 401) verwenden den generischen Fallback unten.
      }

      if (!response.ok || !body?.success) {
        return { success: false, error: body?.error?.trim() || undefined };
      }

      return { success: true };
    } catch {
      return { success: false };
    }
  }
}
