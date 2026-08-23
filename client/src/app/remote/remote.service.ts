import { computed, inject, Injectable, InjectionToken, OnDestroy, signal } from '@angular/core';
import {
  ConnectionStatus,
  MacroStep,
  RemoteAction,
  RemoteResponse,
  ServerConfig,
} from './remote.models';
import { PairingService } from './pairing.service';
import {
  getServerConfigFromLocation,
  getServerPageUrl,
  getServerWebSocketBaseUrl,
  MOUSE_SENSITIVITY_STORAGE_KEY,
  normalizeMouseSensitivity,
  normalizeServerConfig,
  parseStoredMouseSensitivity,
  SERVER_LOCATION,
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
const ACTION_CONFIRMATION_TIMEOUT_MS = 5000;

interface PendingAction {
  readonly resolve: (success: boolean) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

@Injectable({
  providedIn: 'root',
})
export class RemoteService implements OnDestroy {
  private readonly storage = inject(REMOTE_STORAGE);
  private readonly createSocket = inject(REMOTE_WEBSOCKET_FACTORY);
  private readonly autoConnect = inject(REMOTE_AUTO_CONNECT);
  private readonly pairing = inject(PairingService);
  private readonly serverLocation = inject(SERVER_LOCATION);

  private readonly configSignal = signal<ServerConfig>(
    getServerConfigFromLocation(this.serverLocation),
  );
  private readonly mouseSensitivitySignal = signal(this.loadMouseSensitivity());
  private readonly statusSignal = signal<ConnectionStatus>('disconnected');
  private readonly lastErrorSignal = signal<string | null>(null);
  private readonly manualDisconnectSignal = signal(false);

  private socket: RemoteSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private errorTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private requestSequence = 0;
  private readonly pendingActions = new Map<string, PendingAction>();

  readonly config = this.configSignal.asReadonly();
  readonly mouseSensitivity = this.mouseSensitivitySignal.asReadonly();
  readonly status = this.statusSignal.asReadonly();
  readonly lastError = this.lastErrorSignal.asReadonly();
  readonly manuallyDisconnected = this.manualDisconnectSignal.asReadonly();
  readonly socketUrl = computed(() => this.createSocketUrl());

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

  async unpair(): Promise<boolean> {
    const unpaired = await this.pairing.unpair();
    if (!unpaired) {
      this.showError(this.pairing.lastError() ?? 'Entkopplung fehlgeschlagen.');
      return false;
    }

    this.disconnect();
    return true;
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

    const activeConfig = this.configSignal();
    if (
      normalizedConfig.host === activeConfig.host &&
      normalizedConfig.port === activeConfig.port
    ) {
      this.reconnectAttempt = 0;
      this.reconnect();
      return true;
    }

    try {
      this.serverLocation.assign(getServerPageUrl(normalizedConfig, this.serverLocation));
      return true;
    } catch (error) {
      this.showError(`Serverwechsel fehlgeschlagen: ${this.getErrorMessage(error)}`);
      return false;
    }
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

  /** Führt eine Aktionskette sequenziell aus und wartet neben der konfigurierten
   *  Verzögerung auch auf die Serverbestätigung jedes einzelnen Schritts. */
  async runSteps(steps: readonly MacroStep[]): Promise<void> {
    const waitForServerConfirmation = steps.length > 1;

    for (const step of steps) {
      if (step.delayMs > 0) {
        await sleep(step.delayMs);
      }

      const succeeded = waitForServerConfirmation
        ? await this.sendActionAndWait(step.action)
        : this.sendAction(step.action);

      if (!succeeded) {
        return;
      }
    }
  }

  sendAction(action: RemoteAction): boolean {
    return this.sendActionRequest(action);
  }

  private sendActionAndWait(action: RemoteAction): Promise<boolean> {
    const requestId = this.createRequestId();

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (this.settlePendingAction(requestId, false)) {
          this.showError('Keine Bestätigung vom Server erhalten.');
        }
      }, ACTION_CONFIRMATION_TIMEOUT_MS);

      this.pendingActions.set(requestId, { resolve, timeout });

      if (!this.sendActionRequest(action, requestId)) {
        this.settlePendingAction(requestId, false);
      }
    });
  }

  private sendActionRequest(action: RemoteAction, requestId?: string): boolean {
    if (this.socket === null || this.socket.readyState !== SOCKET_OPEN) {
      this.showError('Keine Verbindung zum Server.');
      return false;
    }

    try {
      const message = requestId === undefined ? action : { requestId, ...action };
      this.socket.send(JSON.stringify(message));
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
      this.failPendingActions('Verbindung zum Server wurde getrennt.');
      this.statusSignal.set('disconnected');
      this.scheduleReconnect();
      this.recheckPairing();
    };
  }

  /** Ein serverseitig entkoppeltes Geraet verbindet sich sonst endlos mit einem
   *  ungueltigen Token neu, ohne dass der Nutzer je wieder zur PIN-Eingabe kommt.
   *  Ein Verbindungsabbruch ist daher der Anlass, das Token gegenzupruefen -
   *  ein echter Netzwerkfehler loescht es dabei nicht (siehe PairingService.verify). */
  private recheckPairing(): void {
    if (this.manuallyDisconnected()) {
      return;
    }

    void this.pairing.verify();
  }

  private handleResponse(rawMessage: string): void {
    const response = this.parseResponse(rawMessage);

    if (response === null) {
      this.showError('Ungültige Serverantwort.');
      console.warn('YFRemote: invalid server response', rawMessage);
      return;
    }

    if (response.requestId !== undefined) {
      this.settlePendingAction(response.requestId, response.success);
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

    const response = value as {
      readonly requestId?: unknown;
      readonly success?: unknown;
      readonly error?: unknown;
    };

    if (response.requestId !== undefined && typeof response.requestId !== 'string') {
      return false;
    }

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
    this.failPendingActions();

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

  private createRequestId(): string {
    this.requestSequence += 1;
    return String(this.requestSequence);
  }

  private settlePendingAction(requestId: string, success: boolean): boolean {
    const pendingAction = this.pendingActions.get(requestId);
    if (pendingAction === undefined) {
      return false;
    }

    clearTimeout(pendingAction.timeout);
    this.pendingActions.delete(requestId);
    pendingAction.resolve(success);
    return true;
  }

  private failPendingActions(error?: string): void {
    if (this.pendingActions.size === 0) {
      return;
    }

    const pendingActions = Array.from(this.pendingActions.values());
    this.pendingActions.clear();

    for (const pendingAction of pendingActions) {
      clearTimeout(pendingAction.timeout);
      pendingAction.resolve(false);
    }

    if (error !== undefined) {
      this.showError(error);
    }
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

  private createSocketUrl(): string {
    const baseUrl = `${getServerWebSocketBaseUrl(this.serverLocation)}/ws`;
    const token = this.pairing.token();
    return token === null ? baseUrl : `${baseUrl}?token=${encodeURIComponent(token)}`;
  }

  private loadMouseSensitivity(): number {
    return parseStoredMouseSensitivity(
      this.storage?.getItem(MOUSE_SENSITIVITY_STORAGE_KEY) ?? null,
    );
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
