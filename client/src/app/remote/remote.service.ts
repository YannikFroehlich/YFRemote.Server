import { computed, inject, Injectable, InjectionToken, OnDestroy, signal } from '@angular/core';
import {
  ConnectionStatus,
  MacroStep,
  RemoteAction,
  RemoteResponse,
  ServerConfig,
} from './remote.models';
import {
  DEFAULT_SERVER_CONFIG,
  MOUSE_SENSITIVITY_STORAGE_KEY,
  normalizeMouseSensitivity,
  normalizeServerConfig,
  parseStoredMouseSensitivity,
  parseStoredServerConfig,
  SERVER_CONFIG_STORAGE_KEY,
} from './server-config';

export interface RemoteSocket {
  readonly url: string;
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send(data: string): void;
  close(): void;
}

export type RemoteSocketFactory = (url: string) => RemoteSocket;

export const REMOTE_STORAGE = new InjectionToken<Storage | null>('REMOTE_STORAGE', {
  providedIn: 'root',
  factory: () => getBrowserStorage(),
});

export const REMOTE_WEBSOCKET_FACTORY = new InjectionToken<RemoteSocketFactory>(
  'REMOTE_WEBSOCKET_FACTORY',
  {
    providedIn: 'root',
    factory: () => (url: string) => new WebSocket(url),
  },
);

export const REMOTE_AUTO_CONNECT = new InjectionToken<boolean>('REMOTE_AUTO_CONNECT', {
  providedIn: 'root',
  factory: () => true,
});

const SOCKET_OPEN = 1;
const RECONNECT_DELAYS_MS = [2000, 4000, 6000, 8000, 10000] as const;
const ERROR_VISIBLE_MS = 4200;

@Injectable({
  providedIn: 'root',
})
export class RemoteService implements OnDestroy {
  private readonly storage = inject(REMOTE_STORAGE);
  private readonly createSocket = inject(REMOTE_WEBSOCKET_FACTORY);
  private readonly autoConnect = inject(REMOTE_AUTO_CONNECT);

  private readonly configSignal = signal<ServerConfig>(this.loadConfig());
  private readonly mouseSensitivitySignal = signal(this.loadMouseSensitivity());
  private readonly statusSignal = signal<ConnectionStatus>('disconnected');
  private readonly lastErrorSignal = signal<string | null>(null);
  private readonly manualDisconnectSignal = signal(false);

  private socket: RemoteSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private errorTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;

  readonly config = this.configSignal.asReadonly();
  readonly mouseSensitivity = this.mouseSensitivitySignal.asReadonly();
  readonly status = this.statusSignal.asReadonly();
  readonly lastError = this.lastErrorSignal.asReadonly();
  readonly manuallyDisconnected = this.manualDisconnectSignal.asReadonly();
  readonly socketUrl = computed(() => this.createSocketUrl(this.configSignal()));

  constructor() {
    if (this.autoConnect) {
      this.connect();
    }
  }

  connect(): void {
    this.manualDisconnectSignal.set(false);
    this.openFreshSocket();
  }

  disconnect(): void {
    this.manualDisconnectSignal.set(true);
    this.clearReconnectTimer();
    this.closeActiveSocket();
    this.statusSignal.set('disconnected');
  }

  reconnect(): void {
    this.manualDisconnectSignal.set(false);
    this.openFreshSocket();
  }

  saveConfig(config: ServerConfig): boolean {
    const normalizedConfig = normalizeServerConfig(config);

    if (normalizedConfig === null) {
      this.showError('Serveradresse oder Port ist ungültig.');
      return false;
    }

    this.configSignal.set(normalizedConfig);
    this.persistConfig(normalizedConfig);
    this.reconnectAttempt = 0;
    this.reconnect();
    return true;
  }

  saveMouseSensitivity(sensitivity: number): boolean {
    const normalizedSensitivity = normalizeMouseSensitivity(sensitivity);

    if (normalizedSensitivity === null) {
      this.showError('Mausgeschwindigkeit ist ungültig.');
      return false;
    }

    this.mouseSensitivitySignal.set(normalizedSensitivity);
    this.persistMouseSensitivity(normalizedSensitivity);
    return true;
  }

  /** Führt eine Aktionskette sequenziell aus und wartet dabei die jeweils konfigurierte
   *  Verzögerung ab. Bricht ab, sobald ein Schritt fehlschlägt (z. B. keine Verbindung). */
  async runSteps(steps: readonly MacroStep[]): Promise<void> {
    for (const step of steps) {
      if (step.delayMs > 0) {
        await sleep(step.delayMs);
      }

      if (!this.sendAction(step.action)) {
        return;
      }
    }
  }

  sendAction(action: RemoteAction): boolean {
    if (this.socket === null || this.socket.readyState !== SOCKET_OPEN) {
      this.showError('Keine Verbindung zum Server.');
      return false;
    }

    try {
      this.socket.send(JSON.stringify(action));
      return true;
    } catch (error) {
      this.showError(`Senden fehlgeschlagen: ${this.getErrorMessage(error)}`);
      this.closeActiveSocket();
      this.statusSignal.set('disconnected');
      this.scheduleReconnect();
      return false;
    }
  }

  ngOnDestroy(): void {
    this.manualDisconnectSignal.set(true);
    this.clearReconnectTimer();
    this.clearErrorTimer();
    this.closeActiveSocket();
  }

  private openFreshSocket(): void {
    this.clearReconnectTimer();
    this.closeActiveSocket();
    this.statusSignal.set('connecting');
    this.clearError();

    const socketUrl = this.socketUrl();

    try {
      const socket = this.createSocket(socketUrl);
      this.socket = socket;
      this.bindSocket(socket);
    } catch (error) {
      this.statusSignal.set('disconnected');
      this.showError(`Verbindung fehlgeschlagen: ${this.getErrorMessage(error)}`);
      this.scheduleReconnect();
    }
  }

  private bindSocket(socket: RemoteSocket): void {
    socket.onopen = () => {
      if (this.socket !== socket) {
        return;
      }

      this.reconnectAttempt = 0;
      this.statusSignal.set('connected');
      this.clearError();
    };

    socket.onmessage = (event: MessageEvent<string>) => {
      if (this.socket !== socket) {
        return;
      }

      this.handleResponse(event.data);
    };

    socket.onerror = () => {
      if (this.socket !== socket) {
        return;
      }

      this.showError('WebSocket-Fehler. Verbindung wird neu aufgebaut.');
    };

    socket.onclose = () => {
      if (this.socket !== socket) {
        return;
      }

      this.socket = null;
      this.statusSignal.set('disconnected');
      this.scheduleReconnect();
    };
  }

  private handleResponse(rawMessage: string): void {
    const response = this.parseResponse(rawMessage);

    if (response === null) {
      this.showError('Ungültige Serverantwort.');
      console.warn('YFRemote: invalid server response', rawMessage);
      return;
    }

    if (response.success) {
      this.clearError();
      return;
    }

    this.showError(response.error?.trim() || 'Aktion wurde vom Server abgelehnt.');
  }

  private parseResponse(rawMessage: string): RemoteResponse | null {
    try {
      const parsedValue: unknown = JSON.parse(rawMessage);

      if (!this.isRemoteResponse(parsedValue)) {
        return null;
      }

      return parsedValue;
    } catch {
      return null;
    }
  }

  private isRemoteResponse(value: unknown): value is RemoteResponse {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    const response = value as { readonly success?: unknown; readonly error?: unknown };

    if (response.success === true) {
      return true;
    }

    return (
      response.success === false &&
      (response.error === undefined || typeof response.error === 'string')
    );
  }

  private scheduleReconnect(): void {
    if (this.manualDisconnectSignal()) {
      return;
    }

    this.clearReconnectTimer();
    const delay =
      RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectAttempt += 1;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;

      if (!this.manualDisconnectSignal() && this.statusSignal() !== 'connected') {
        this.openFreshSocket();
      }
    }, delay);
  }

  private closeActiveSocket(): void {
    if (this.socket === null) {
      return;
    }

    const socket = this.socket;
    this.socket = null;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    socket.close();
  }

  private showError(message: string): void {
    this.clearErrorTimer();
    this.lastErrorSignal.set(message);
    this.errorTimer = setTimeout(() => this.clearError(), ERROR_VISIBLE_MS);
  }

  private clearError(): void {
    this.clearErrorTimer();
    this.lastErrorSignal.set(null);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearErrorTimer(): void {
    if (this.errorTimer !== null) {
      clearTimeout(this.errorTimer);
      this.errorTimer = null;
    }
  }

  private createSocketUrl(config: ServerConfig): string {
    return `ws://${config.host}:${config.port}/ws`;
  }

  private loadConfig(): ServerConfig {
    return parseStoredServerConfig(this.storage?.getItem(SERVER_CONFIG_STORAGE_KEY) ?? null);
  }

  private loadMouseSensitivity(): number {
    return parseStoredMouseSensitivity(
      this.storage?.getItem(MOUSE_SENSITIVITY_STORAGE_KEY) ?? null,
    );
  }

  private persistConfig(config: ServerConfig): void {
    this.storage?.setItem(SERVER_CONFIG_STORAGE_KEY, JSON.stringify(config));
  }

  private persistMouseSensitivity(sensitivity: number): void {
    this.storage?.setItem(MOUSE_SENSITIVITY_STORAGE_KEY, String(sensitivity));
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error && error.message.length > 0
      ? error.message
      : 'Unbekannter Fehler';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBrowserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
