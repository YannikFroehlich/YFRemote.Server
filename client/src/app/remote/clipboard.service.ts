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

export type DeviceClipboardImageWriter = (image: Blob) => Promise<void>;

/** Wie DEVICE_CLIPBOARD_WRITER, nur für ein Bild (PNG) über `ClipboardItem`. */
export const DEVICE_CLIPBOARD_IMAGE_WRITER = new InjectionToken<DeviceClipboardImageWriter | null>(
  'DEVICE_CLIPBOARD_IMAGE_WRITER',
  {
    providedIn: 'root',
    factory: () => {
      const clipboard = globalThis.isSecureContext ? globalThis.navigator?.clipboard : undefined;
      return clipboard?.write && typeof ClipboardItem !== 'undefined'
        ? (image) => clipboard.write([new ClipboardItem({ [image.type]: image })])
        : null;
    },
  },
);

/** Ob der Browser die Zwischenablage ohne Tippen lesen und schreiben laesst: nur wer die
 *  Berechtigung `clipboard-read` kennt (Chromium). Safari verlangt fuer jeden Zugriff eine Geste,
 *  der automatische Abgleich kaeme dort nie an. */
export const CLIPBOARD_AUTO_SYNC_PROBE = new InjectionToken<() => Promise<boolean>>(
  'CLIPBOARD_AUTO_SYNC_PROBE',
  {
    providedIn: 'root',
    factory: () => async () => {
      try {
        await globalThis.navigator.permissions.query({ name: 'clipboard-read' as PermissionName });
        return true;
      } catch {
        return false;
      }
    },
  },
);

/** Text, oder ein Bild als PNG; `''` bei leerer Zwischenablage. */
export type DeviceClipboardContent = string | Blob;

export type DeviceClipboardReader = () => Promise<DeviceClipboardContent>;

/** `null` wie beim Schreiben. Safari und Firefox kennen die Berechtigung `clipboard-read` nicht;
 *  dort scheitert das Lesen bewusst, statt bei jeder Rückkehr in die App nachzufragen. Text geht
 *  vor, wie am PC (`GET /clipboard/text` vor `/clipboard/image`). */
export const DEVICE_CLIPBOARD_READER = new InjectionToken<DeviceClipboardReader | null>(
  'DEVICE_CLIPBOARD_READER',
  {
    providedIn: 'root',
    factory: () => {
      const navigator = globalThis.navigator;
      const clipboard = globalThis.isSecureContext ? navigator?.clipboard : undefined;
      if (!clipboard?.readText || !navigator.permissions) {
        return null;
      }

      return async () => {
        const permission = await navigator.permissions.query({
          name: 'clipboard-read' as PermissionName,
        });
        if (permission.state === 'denied') {
          throw new Error('clipboard-read denied');
        }
        if (!clipboard.read) {
          return clipboard.readText();
        }

        for (const item of await clipboard.read()) {
          if (item.types.includes('text/plain')) {
            return (await item.getType('text/plain')).text();
          }
          if (item.types.includes('image/png')) {
            return item.getType('image/png');
          }
        }
        return '';
      };
    },
  },
);

export interface ClipboardSendResult {
  readonly success: boolean;
  readonly error?: string;
  /** Nach `sendImage`: die Kennung, mit der der Abgleich des PCs das Bild zurückmeldet. */
  readonly imageId?: string;
}

export interface ClipboardReadResult {
  readonly success: boolean;
  /** `null`, wenn die PC-Zwischenablage gerade keinen Text enthält. */
  readonly text?: string | null;
  readonly error?: string;
}

export interface ClipboardImageResult {
  readonly success: boolean;
  /** `null`, wenn die PC-Zwischenablage gerade kein Bild enthält. */
  readonly image?: Blob | null;
  readonly error?: string;
}

interface ClipboardResponseBody {
  readonly success: boolean;
  readonly error?: string | null;
  readonly text?: string | null;
  readonly imageId?: string | null;
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

  async sendImage(image: Blob): Promise<ClipboardSendResult> {
    const formData = new FormData();
    formData.append('file', image, image instanceof File ? image.name : 'clipboard.png');

    const body = await this.request('/clipboard/image', { method: 'POST', body: formData });
    return body.success && body.imageId ? { success: true, imageId: body.imageId } : toSendResult(body);
  }

  /** Legt schon gesendete Dateien (Namen aus `POST /files`) in die PC-Zwischenablage. */
  async sendFiles(names: readonly string[]): Promise<ClipboardSendResult> {
    return toSendResult(
      await this.request('/clipboard/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names }),
      }),
    );
  }

  async readText(): Promise<ClipboardReadResult> {
    const body = await this.request('/clipboard/text', { method: 'GET', cache: 'no-store' });

    if (!body.success) {
      return toSendResult(body);
    }

    return { success: true, text: typeof body.text === 'string' && body.text ? body.text : null };
  }

  /** Nur PC-Server: der Android-Server kennt `GET /clipboard/image` nicht. */
  async readImage(): Promise<ClipboardImageResult> {
    try {
      const response = await this.fetchWithToken('/clipboard/image', {
        method: 'GET',
        cache: 'no-store',
      });
      if (response?.status === 204) {
        return { success: true, image: null };
      }
      if (response?.ok) {
        return { success: true, image: await response.blob() };
      }
      return response === null ? { success: false } : toSendResult(await readBody(response));
    } catch {
      return { success: false };
    }
  }

  private async request(
    path: string,
    init: RequestInit & { headers?: Record<string, string> },
  ): Promise<ClipboardResponseBody> {
    try {
      const response = await this.fetchWithToken(path, init);
      if (response === null) {
        return { success: false };
      }

      const body = await readBody(response);
      return response.ok ? body : { success: false, error: body.error ?? undefined };
    } catch {
      return { success: false };
    }
  }

  /** `null` ohne Pairing-Token. */
  private async fetchWithToken(
    path: string,
    init: RequestInit & { headers?: Record<string, string> },
  ): Promise<Response | null> {
    const token = this.pairing.token();
    if (token === null) {
      return null;
    }

    return this.fetchFn(`${getServerHttpBaseUrl(this.serverLocation)}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
    });
  }
}

async function readBody(response: Response): Promise<ClipboardResponseBody> {
  try {
    const body = (await response.json()) as ClipboardResponseBody | null;
    return body?.success
      ? body
      : { success: false, error: body?.error?.trim() || undefined };
  } catch {
    // Fehlerantworten ohne JSON (z. B. 401) verwenden den generischen Fallback.
    return { success: false };
  }
}

function toSendResult(body: ClipboardResponseBody): ClipboardSendResult {
  return body.success ? { success: true } : { success: false, error: body.error ?? undefined };
}
