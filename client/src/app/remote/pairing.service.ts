import { computed, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { REMOTE_STORAGE } from './remote.service';
import { getServerHttpBaseUrl, SERVER_LOCATION } from './server-config';
import { PAIRING_TOKEN_STORAGE_KEY, parseStoredPairingToken } from './pairing';

export const PAIRING_FETCH = new InjectionToken<typeof fetch>('PAIRING_FETCH', {
  providedIn: 'root',
  factory: () => globalThis.fetch.bind(globalThis),
});

interface PairResponseBody {
  readonly success: boolean;
  readonly token?: string | null;
  readonly error?: string | null;
}

interface PairStatusResponseBody {
  readonly valid: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class PairingService {
  private readonly storage = inject(REMOTE_STORAGE);
  private readonly fetchFn = inject(PAIRING_FETCH);
  private readonly serverLocation = inject(SERVER_LOCATION);

  private readonly tokenSignal = signal<string | null>(this.loadToken());
  private readonly errorSignal = signal<string | null>(null);

  readonly token = this.tokenSignal.asReadonly();
  readonly isPaired = computed(() => this.tokenSignal() !== null);
  readonly lastError = this.errorSignal.asReadonly();

  constructor() {
    if (this.tokenSignal() !== null) {
      void this.verify();
    }
  }

  async pair(pin: string, deviceName: string, remember: boolean): Promise<boolean> {
    this.errorSignal.set(null);

    let body: PairResponseBody;
    try {
      const response = await this.fetchFn(`${this.getHttpBaseUrl()}/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, deviceName }),
      });
      body = (await response.json()) as PairResponseBody;
    } catch (error) {
      this.errorSignal.set(`Verbindung zum Server fehlgeschlagen: ${this.getErrorMessage(error)}`);
      return false;
    }

    if (!body.success || !body.token) {
      this.errorSignal.set(body.error?.trim() || 'PIN wurde vom Server abgelehnt.');
      return false;
    }

    this.tokenSignal.set(body.token);

    if (remember) {
      this.storage?.setItem(PAIRING_TOKEN_STORAGE_KEY, body.token);
    }

    return true;
  }

  /** Prueft ein vorhandenes Token beim Start, bevor ueberhaupt ein WebSocket
   *  geoeffnet wird. Loescht das Token nur bei einer expliziten Ablehnung durch
   *  den Server - ein Netzwerkfehler darf ein gueltiges Token nicht wegwerfen. */
  async verify(): Promise<boolean> {
    const token = this.tokenSignal();
    if (token === null) {
      return false;
    }

    try {
      const response = await this.fetchFn(
        `${this.getHttpBaseUrl()}/pair/status?token=${encodeURIComponent(token)}`,
      );
      const body = (await response.json()) as PairStatusResponseBody;

      if (body.valid === false) {
        this.clearToken();
        return false;
      }

      return true;
    } catch {
      return true;
    }
  }

  private clearToken(): void {
    this.tokenSignal.set(null);
    this.storage?.removeItem(PAIRING_TOKEN_STORAGE_KEY);
  }

  private loadToken(): string | null {
    return parseStoredPairingToken(this.storage?.getItem(PAIRING_TOKEN_STORAGE_KEY) ?? null);
  }

  private getHttpBaseUrl(): string {
    return getServerHttpBaseUrl(this.serverLocation);
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error && error.message.length > 0
      ? error.message
      : 'Unbekannter Fehler';
  }
}
