import { inject, Injectable, InjectionToken } from '@angular/core';
import { PairingService } from './pairing.service';
import { getServerHttpBaseUrl, SERVER_LOCATION } from './server-config';

export const CLIPBOARD_FETCH = new InjectionToken<typeof fetch>('CLIPBOARD_FETCH', {
  providedIn: 'root',
  factory: () => globalThis.fetch.bind(globalThis),
});

export type DeviceClipboardWriter = (text: string) => Promise<void>;

/** `null`, wo die Async-Clipboard-API fehlt: sie gibt es nur im sicheren Kontext, über
 *  `http://<LAN-IP>` bleibt nur manuelles Markieren und Kopieren. */
export const DEVICE_CLIPBOARD_WRITER = new InjectionToken<DeviceClipboardWriter | null>(
  'DEVICE_CLIPBOARD_WRITER',
  {
    providedIn: 'root',
    factory: () => {
      const clipboard = globalThis.isSecureContext ? globalThis.navigator?.clipboard : undefined;
      return clipboard?.writeText ? (text) => clipboard.writeText(text) : null;
    },
  },
);

export interface ClipboardSendResult {
  readonly success: boolean;
  readonly error?: string;
}

export interface ClipboardReadResult {
  readonly success: boolean;
  /** `null`, wenn die PC-Zwischenablage gerade keinen Text enthält. */
  readonly text?: string | null;
  readonly error?: string;
}

interface ClipboardResponseBody {
  readonly success: boolean;
  readonly error?: string | null;
  readonly text?: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class ClipboardService {
  private readonly pairing = inject(PairingService);
  private readonly fetchFn = inject(CLIPBOARD_FETCH);
  private readonly serverLocation = inject(SERVER_LOCATION);

  async sendText(text: string): Promise<ClipboardSendResult> {
    return toSendResult(
      await this.request('/clipboard/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      }),
    );
  }

  async sendImage(file: File): Promise<ClipboardSendResult> {
    const formData = new FormData();
    formData.append('file', file);

    return toSendResult(await this.request('/clipboard/image', { method: 'POST', body: formData }));
  }

  async readText(): Promise<ClipboardReadResult> {
    const body = await this.request('/clipboard/text', { method: 'GET', cache: 'no-store' });

    if (!body.success) {
      return toSendResult(body);
    }

    return { success: true, text: typeof body.text === 'string' && body.text ? body.text : null };
  }

  private async request(
    path: string,
    init: RequestInit & { headers?: Record<string, string> },
  ): Promise<ClipboardResponseBody> {
    const token = this.pairing.token();
    if (token === null) {
      return { success: false };
    }

    try {
      const response = await this.fetchFn(`${getServerHttpBaseUrl(this.serverLocation)}${path}`, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${token}` },
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

      return body;
    } catch {
      return { success: false };
    }
  }
}

function toSendResult(body: ClipboardResponseBody): ClipboardSendResult {
  return body.success ? { success: true } : { success: false, error: body.error ?? undefined };
}
