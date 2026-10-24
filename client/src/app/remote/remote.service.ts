import { computed, inject, Injectable, InjectionToken, OnDestroy, signal } from '@angular/core';
import {
  ClipboardPushMessage,
  ConnectionStatus,
  FileOfferMessage,
  GamepadRumbleMessage,
  MacroStep,
  MediaStatusMessage,
  RemoteAction,
  RemoteResponse,
  ServerConfig,
  ServerPlatform,
  ShutdownTimerMessage,
  SystemStatsMessage,
  VoicemeeterMessage,
  AppVolumesMessage,
} from './remote.models';
import { PAIRING_FETCH, PairingService } from './pairing.service';
import {
  CLIPBOARD_SYNC_STORAGE_KEY,
  getServerConfigFromLocation,
  getServerHttpBaseUrl,
  getServerPageUrl,
  getServerWebSocketBaseUrl,
  HAPTICS_STORAGE_KEY,
  INVERT_SCROLL_STORAGE_KEY,
  LIVE_TYPING_STORAGE_KEY,
  MOUSE_SENSITIVITY_STORAGE_KEY,
  normalizeMouseSensitivity,
  normalizeScrollSpeed,
  normalizeServerConfig,
  parseStoredFlag,
  parseStoredMouseSensitivity,
  parseStoredScrollSpeed,
  parseStoredServerProfiles,
  POINTER_ACCELERATION_STORAGE_KEY,
  SCROLL_SPEED_STORAGE_KEY,
  SERVER_LOCATION,
  SERVER_PROFILES_STORAGE_KEY,
  withoutServerProfile,
  withServerProfile,
} from './server-config';
import { TranslationService } from './translation.service';

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

export const REMOTE_VIBRATE = new InjectionToken<(pattern: VibratePattern) => void>('REMOTE_VIBRATE', {
  providedIn: 'root',
  // iOS kennt navigator.vibrate nicht; dort bleibt es einfach still.
  factory: () => (pattern: VibratePattern) => void globalThis.navigator?.vibrate?.(pattern),
});

const SOCKET_OPEN = 1;
const RECONNECT_DELAYS_MS = [2000, 4000, 6000, 8000, 10000] as const;
const ERROR_VISIBLE_MS = 4200;
const ACTION_CONFIRMATION_TIMEOUT_MS = 5000;
const HAPTIC_PULSE_MS = 10;
/** Wortgleich mit InputBlockedException des Servers: Windows weist waehrend der
 *  Benutzerkontensteuerung und des Sperrbildschirms jede Eingabe ab. */
const INPUT_BLOCKED_ERROR = 'Input is blocked by a secure desktop (UAC prompt or lock screen).';
// Nur für einzelne Tipp-Aktionen vibrieren, nicht für den Strom aus Bewegungen, Scrollen und
// Text (die Handy-Tastatur gibt beim Tippen schon selbst Rückmeldung).
const HAPTIC_ACTION_TYPES: ReadonlySet<RemoteAction['type']> = new Set([
  'key',
  'hotkey',
  'mouseClick',
  'mouseDown',
]);

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
  private readonly vibrate = inject(REMOTE_VIBRATE);
  private readonly pairing = inject(PairingService);
  private readonly fetchFn = inject(PAIRING_FETCH);
  private readonly serverLocation = inject(SERVER_LOCATION);
  private readonly i18n = inject(TranslationService);

  private readonly configSignal = signal<ServerConfig>(
    getServerConfigFromLocation(this.serverLocation),
  );
  private readonly serverProfilesSignal = signal<ServerConfig[]>(this.loadServerProfiles());
  private readonly mouseSensitivitySignal = signal(this.loadMouseSensitivity());
  private readonly scrollSpeedSignal = signal(
    parseStoredScrollSpeed(this.readStorage(SCROLL_SPEED_STORAGE_KEY)),
  );
  private readonly invertScrollSignal = signal(
    parseStoredFlag(this.readStorage(INVERT_SCROLL_STORAGE_KEY), false),
  );
  private readonly hapticsSignal = signal(
    parseStoredFlag(this.readStorage(HAPTICS_STORAGE_KEY), true),
  );
  private readonly pointerAccelerationSignal = signal(
    parseStoredFlag(this.readStorage(POINTER_ACCELERATION_STORAGE_KEY), true),
  );
  private readonly liveTypingSignal = signal(
    parseStoredFlag(this.readStorage(LIVE_TYPING_STORAGE_KEY), false),
  );
  private readonly clipboardSyncSignal = signal(
    parseStoredFlag(this.readStorage(CLIPBOARD_SYNC_STORAGE_KEY), false),
  );
  private readonly statusSignal = signal<ConnectionStatus>('disconnected');
  private readonly lastErrorSignal = signal<string | null>(null);
  private readonly manualDisconnectSignal = signal(false);
  private readonly serverPlatformSignal = signal<ServerPlatform | null>(null);
  private readonly gamepadAvailableSignal = signal(false);
  private readonly gamepadRumbleSignal = signal(0);
  private readonly fileOfferSignal = signal<FileOfferMessage | null>(null);
  private readonly mediaStatusSignal = signal<MediaStatusMessage | null>(null);
  private readonly mediaCoverSignal = signal<string | null>(null);
  private mediaCoverId: string | null = null;
  private readonly shutdownDeadlineSignal = signal<number | null>(null);
  private readonly pcClipboardSignal = signal<ClipboardPushMessage | null>(null);
  private readonly systemStatsSignal = signal<SystemStatsMessage | null>(null);
  private systemStatsWatched = false;
  private readonly voicemeeterAvailableSignal = signal(false);
  private readonly voicemeeterSignal = signal<VoicemeeterMessage | null>(null);
  private voicemeeterWatched = false;
  private readonly appsSignal = signal<AppVolumesMessage | null>(null);
  private appsWatched = false;
  // Der Server schickt das Angebot bei jedem Verbinden erneut - ein verworfenes soll dann nicht
  // wieder auftauchen.
  private dismissedFileOfferId: string | null = null;

  private socket: RemoteSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private errorTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private requestSequence = 0;
  private readonly pendingActions = new Map<string, PendingAction>();

  readonly config = this.configSignal.asReadonly();
  readonly serverProfiles = this.serverProfilesSignal.asReadonly();
  readonly mouseSensitivity = this.mouseSensitivitySignal.asReadonly();
  readonly scrollSpeed = this.scrollSpeedSignal.asReadonly();
  readonly invertScroll = this.invertScrollSignal.asReadonly();
  readonly haptics = this.hapticsSignal.asReadonly();
  readonly pointerAcceleration = this.pointerAccelerationSignal.asReadonly();
  readonly liveTyping = this.liveTypingSignal.asReadonly();
  /** Gewuenschter Zwischenablage-Abgleich; wirksam nur, wo `clipboardSyncSupported()` gilt. */
  readonly clipboardSync = this.clipboardSyncSignal.asReadonly();
  readonly status = this.statusSignal.asReadonly();
  /** Plattform der Gegenstelle laut `GET /health`; `null`, solange sie unbekannt ist. */
  readonly serverPlatform = this.serverPlatformSignal.asReadonly();
  /** Ob die Gegenstelle virtuelle Xbox-Controller anlegen kann (Windows mit ViGEmBus-Treiber). */
  readonly gamepadAvailable = this.gamepadAvailableSignal.asReadonly();
  /** Staerkerer der beiden Vibrationsmotoren (0-255), wie ihn das Spiel zuletzt gesetzt hat. */
  readonly gamepadRumble = this.gamepadRumbleSignal.asReadonly();
  /** Datei, die der PC gerade anbietet; `null`, solange keine angeboten ist. */
  readonly fileOffer = this.fileOfferSignal.asReadonly();
  /** Lautstaerke und laufendes Medium am PC; `null`, solange die Gegenstelle keine meldet. */
  readonly mediaStatus = this.mediaStatusSignal.asReadonly();
  /** Albumcover des laufenden Mediums als Data-URL; `null` ohne Cover oder solange es laedt. */
  readonly mediaCover = this.mediaCoverSignal.asReadonly();
  /** Zeitpunkt (`Date.now()`-Basis), zu dem der PC herunterfaehrt; `null` ohne geplanten Termin.
   *  Aus der gemeldeten Restzeit berechnet, weil die Uhr des Geraets von der des PCs abweichen kann. */
  readonly shutdownDeadline = this.shutdownDeadlineSignal.asReadonly();
  /** Zuletzt vom PC gemeldeter Zwischenablage-Text (nur bei eingeschaltetem Abgleich). Ein neues
   *  Objekt pro Meldung, damit auch derselbe Text erneut auslöst. */
  readonly pcClipboard = this.pcClipboardSignal.asReadonly();
  /** Den Abgleich koennen nur der Windows- und der Linux-Server, nicht die Android-App. */
  readonly clipboardSyncSupported = computed(
    () => this.serverPlatformSignal() === 'windows' || this.serverPlatformSignal() === 'linux',
  );
  /** Zuletzt gemeldete Auslastung des PCs; `null`, solange niemand zusieht oder nichts kam. */
  readonly systemStats = this.systemStatsSignal.asReadonly();
  /** Auch die Systemanzeige koennen nur die PC-Server. */
  readonly systemStatsSupported = this.clipboardSyncSupported;
  /** Ob am PC Voicemeeter installiert ist (`GET /health`); dann gibt es den Tab "Mixer". */
  readonly voicemeeterAvailable = this.voicemeeterAvailableSignal.asReadonly();
  /** Zuletzt gemeldete Voicemeeter-Kanaele; `null`, solange niemand zusieht oder nichts kam. */
  readonly voicemeeter = this.voicemeeterSignal.asReadonly();
  /** Apps mit Ton am PC; `null`, solange niemand zusieht oder nichts kam. Nur PC-Server. */
  readonly apps = this.appsSignal.asReadonly();
  readonly lastError = this.lastErrorSignal.asReadonly();
  readonly manuallyDisconnected = this.manualDisconnectSignal.asReadonly();
  readonly socketUrl = computed(() => this.createSocketUrl());

  constructor() {
    this.recordServerProfile(this.configSignal());

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
      this.showError(this.pairing.lastError() ?? this.i18n.t('remoteService.error.unpairFailed'));
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
      this.showError(this.i18n.t('remoteService.error.invalidServerConfig'));
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
      const targetUrl = getServerPageUrl(normalizedConfig, this.serverLocation);
      this.recordServerProfile(normalizedConfig);
      this.serverLocation.assign(targetUrl);
      return true;
    } catch (error) {
      this.showError(
        this.i18n.t('remoteService.error.serverChangeFailed', {
          message: this.getErrorMessage(error),
        }),
      );
      return false;
    }
  }

  saveMouseSensitivity(sensitivity: number): boolean {
    const normalizedSensitivity = normalizeMouseSensitivity(sensitivity);

    if (normalizedSensitivity === null) {
      this.showError(this.i18n.t('remoteService.error.invalidMouseSensitivity'));
      return false;
    }

    this.mouseSensitivitySignal.set(normalizedSensitivity);
    this.persistMouseSensitivity(normalizedSensitivity);
    return true;
  }

  saveScrollSettings(speed: number, invert: boolean): boolean {
    const normalizedSpeed = normalizeScrollSpeed(speed);

    if (normalizedSpeed === null) {
      this.showError(this.i18n.t('remoteService.error.invalidScrollSpeed'));
      return false;
    }

    this.scrollSpeedSignal.set(normalizedSpeed);
    this.invertScrollSignal.set(invert);
    this.storage?.setItem(SCROLL_SPEED_STORAGE_KEY, String(normalizedSpeed));
    this.storage?.setItem(INVERT_SCROLL_STORAGE_KEY, String(invert));
    return true;
  }

  saveHaptics(enabled: boolean): void {
    this.hapticsSignal.set(enabled);
    this.storage?.setItem(HAPTICS_STORAGE_KEY, String(enabled));
  }

  savePointerAcceleration(enabled: boolean): void {
    this.pointerAccelerationSignal.set(enabled);
    this.storage?.setItem(POINTER_ACCELERATION_STORAGE_KEY, String(enabled));
  }

  saveLiveTyping(enabled: boolean): void {
    this.liveTypingSignal.set(enabled);
    this.storage?.setItem(LIVE_TYPING_STORAGE_KEY, String(enabled));
  }

  saveClipboardSync(enabled: boolean): void {
    this.clipboardSyncSignal.set(enabled);
    this.storage?.setItem(CLIPBOARD_SYNC_STORAGE_KEY, String(enabled));
    this.sendClipboardSync();
  }

  /** Nur solange die Anzeige sichtbar ist - ohne Zuhoerer misst der PC nichts. */
  watchSystemStats(enabled: boolean): void {
    this.systemStatsWatched = enabled;
    if (!enabled) {
      this.systemStatsSignal.set(null);
    }
    this.sendSystemStats();
  }

  /** Wie `watchSystemStats`: der PC liest Voicemeeter nur, solange Mixer oder Button-Editor offen sind. */
  watchVoicemeeter(enabled: boolean): void {
    this.voicemeeterWatched = enabled;
    if (!enabled) {
      this.voicemeeterSignal.set(null);
    }
    this.sendVoicemeeterWatch();
  }

  /** Setzt einen Voicemeeter-Wert und zeigt ihn sofort an - die Bestaetigung kommt erst mit der
   *  naechsten sekuendlichen Meldung. Ohne `value` wird ein Schalter umgeschaltet. */
  setVoicemeeterParameter(parameter: string, value?: number): void {
    const sent = this.sendAction(
      value === undefined
        ? { type: 'voicemeeterParameter', parameter }
        : { type: 'voicemeeterParameter', parameter, value },
    );

    const state = this.voicemeeterSignal();
    const [id, name] = parameter.split('.');
    if (!sent || state?.channels === undefined || (name !== 'Mute' && name !== 'Gain')) {
      return;
    }

    this.voicemeeterSignal.set({
      ...state,
      channels: state.channels.map((channel) =>
        channel.id !== id
          ? channel
          : name === 'Gain'
            ? { ...channel, gain: value ?? channel.gain }
            : { ...channel, muted: value === undefined ? !channel.muted : value === 1 },
      ),
    });
  }

  /** Wie `watchSystemStats`: der PC liest die Audio-Sitzungen nur, solange der Mixer offen ist. */
  watchApps(enabled: boolean): void {
    this.appsWatched = enabled;
    if (!enabled) {
      this.appsSignal.set(null);
    }
    this.sendAppsWatch();
  }

  /** Wie `setVoicemeeterParameter`: sofort anzeigen, die Bestaetigung kommt mit der naechsten Meldung. */
  setApp(id: string, change: { readonly volume?: number; readonly muted?: boolean }): void {
    const state = this.appsSignal();
    if (!this.sendAction({ type: 'appVolume', id, ...change }) || state === null) {
      return;
    }

    this.appsSignal.set({
      ...state,
      apps: state.apps.map((app) => (app.id === id ? { ...app, ...change } : app)),
    });
  }

  /** Wechselt das Standard-Wiedergabegeraet des PCs, ebenfalls sofort angezeigt. */
  setAudioOutput(id: string): void {
    const state = this.appsSignal();
    if (!this.sendAction({ type: 'audioOutput', id }) || state?.outputs === undefined) {
      return;
    }

    this.appsSignal.set({
      ...state,
      outputs: state.outputs.map((output) => ({ ...output, default: output.id === id })),
    });
  }

  /** Die Apps, die ein eigener Button am PC starten darf; leer, wenn der PC nicht antwortet. */
  async readLaunchApps(): Promise<readonly string[]> {
    const token = this.pairing.token();
    if (token === null) {
      return [];
    }

    try {
      const response = await this.fetchFn(
        `${getServerHttpBaseUrl(this.serverLocation)}/launch/apps`,
        { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } },
      );
      const body = response.ok ? ((await response.json()) as { apps?: unknown }) : null;
      return Array.isArray(body?.apps)
        ? body.apps.filter((name): name is string => typeof name === 'string')
        : [];
    } catch {
      return [];
    }
  }

  dismissFileOffer(): void {
    this.dismissedFileOfferId = this.fileOfferSignal()?.id ?? null;
    this.fileOfferSignal.set(null);
  }

  removeServerProfile(config: ServerConfig): void {
    const updated = withoutServerProfile(this.serverProfilesSignal(), config);
    this.serverProfilesSignal.set(updated);
    this.persistServerProfiles(updated);
  }

  /** Führt eine Aktionskette sequenziell aus und wartet neben der konfigurierten
   *  Verzögerung auch auf die Serverbestätigung jedes einzelnen Schritts. */
  async runSteps(steps: readonly MacroStep[]): Promise<void> {
    const waitForServerConfirmation = steps.length > 1;
    this.hapticPulse();

    for (const step of steps) {
      if (step.delayMs > 0) {
        await sleep(step.delayMs);
      }

      const succeeded = waitForServerConfirmation
        ? await this.sendActionAndWait(step.action)
        : this.sendActionRequest(step.action);

      if (!succeeded) {
        return;
      }
    }
  }

  sendAction(action: RemoteAction): boolean {
    if (HAPTIC_ACTION_TYPES.has(action.type)) {
      this.hapticPulse();
    }

    return this.sendActionRequest(action);
  }

  private hapticPulse(): void {
    if (this.hapticsSignal()) {
      this.vibrate(HAPTIC_PULSE_MS);
    }
  }

  private sendActionAndWait(action: RemoteAction): Promise<boolean> {
    const requestId = this.createRequestId();

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (this.settlePendingAction(requestId, false)) {
          this.showError(this.i18n.t('remoteService.error.noConfirmation'));
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
      this.showError(this.i18n.t('remoteService.error.noConnection'));
      return false;
    }

    try {
      const message = requestId === undefined ? action : { requestId, ...action };
      this.socket.send(JSON.stringify(message));
      return true;
    } catch (error) {
      this.showError(
        this.i18n.t('remoteService.error.sendFailed', { message: this.getErrorMessage(error) }),
      );
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
      this.showError(
        this.i18n.t('remoteService.error.connectFailed', { message: this.getErrorMessage(error) }),
      );
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
      void this.detectServerPlatform();
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

      this.showError(this.i18n.t('remoteService.error.socketError'));
    };

    socket.onclose = () => {
      if (this.socket !== socket) {
        return;
      }

      this.socket = null;
      this.gamepadRumbleSignal.set(0);
      this.fileOfferSignal.set(null);
      this.mediaStatusSignal.set(null);
      this.clearMediaCover();
      this.shutdownDeadlineSignal.set(null);
      this.systemStatsSignal.set(null);
      this.voicemeeterSignal.set(null);
      this.appsSignal.set(null);
      this.failPendingActions(this.i18n.t('remoteService.error.disconnected'));
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
    const message = parseJson(rawMessage);

    if (isRumbleMessage(message)) {
      this.gamepadRumbleSignal.set(Math.max(message.largeMotor, message.smallMotor));
      return;
    }

    if (isMediaStatusMessage(message)) {
      this.mediaStatusSignal.set(message);
      void this.loadMediaCover(message.coverId ?? null);
      return;
    }

    if (isClipboardPushMessage(message)) {
      this.pcClipboardSignal.set(message);
      return;
    }

    if (isShutdownTimerMessage(message)) {
      this.shutdownDeadlineSignal.set(
        message.remainingSeconds === undefined ? null : Date.now() + message.remainingSeconds * 1000,
      );
      return;
    }

    if (isSystemStatsMessage(message)) {
      if (this.systemStatsWatched) {
        this.systemStatsSignal.set(message);
      }
      return;
    }

    if (isVoicemeeterMessage(message)) {
      if (this.voicemeeterWatched) {
        this.voicemeeterSignal.set(message);
      }
      return;
    }

    if (isAppVolumesMessage(message)) {
      if (this.appsWatched) {
        this.appsSignal.set(message);
      }
      return;
    }

    if (isFileOfferMessage(message)) {
      if (message.id !== this.dismissedFileOfferId) {
        this.fileOfferSignal.set(message);
      }
      return;
    }

    const response = this.isRemoteResponse(message) ? message : null;

    if (response === null) {
      this.showError(this.i18n.t('remoteService.error.invalidResponse'));
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

    const error = response.error?.trim();
    this.showError(
      error === INPUT_BLOCKED_ERROR
        ? this.i18n.t('remoteService.error.inputBlocked')
        : error || this.i18n.t('remoteService.error.actionRejected'),
    );
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

  // Einziger Zweck: der Remote-Tab muss wissen, ob am anderen Ende ein Telefon oder ein PC
  // haengt - ein Android-Server kann weder Browser-Tab-Hotkeys noch Herunterfahren. Schlaegt der
  // Aufruf fehl, bleibt die Plattform unbekannt und das Layout unveraendert.
  private async detectServerPlatform(): Promise<void> {
    try {
      const response = await this.fetchFn(`${getServerHttpBaseUrl(this.serverLocation)}/health`);
      const body = (await response.json()) as {
        readonly platform?: unknown;
        readonly gamepad?: unknown;
        readonly voicemeeter?: unknown;
      };
      this.serverPlatformSignal.set(
        body.platform === 'windows' || body.platform === 'linux' || body.platform === 'android'
          ? body.platform
          : null,
      );
      this.gamepadAvailableSignal.set(body.gamepad === true);
      this.voicemeeterAvailableSignal.set(body.voicemeeter === true);
    } catch {
      this.serverPlatformSignal.set(null);
      this.gamepadAvailableSignal.set(false);
      this.voicemeeterAvailableSignal.set(false);
    }

    // Der Server vergisst den Abgleich mit jeder Verbindung; er wird erst hier eingeschaltet,
    // weil erst /health sagt, ob die Gegenstelle ihn kann.
    if (this.clipboardSyncSignal()) {
      this.sendClipboardSync();
    }
    if (this.systemStatsWatched) {
      this.sendSystemStats();
    }
    if (this.voicemeeterWatched) {
      this.sendVoicemeeterWatch();
    }
    if (this.appsWatched) {
      this.sendAppsWatch();
    }
  }

  private sendClipboardSync(): void {
    if (this.clipboardSyncSupported() && this.socket?.readyState === SOCKET_OPEN) {
      this.sendActionRequest({ type: 'clipboardSync', enabled: this.clipboardSyncSignal() });
    }
  }

  private sendSystemStats(): void {
    if (this.systemStatsSupported() && this.socket?.readyState === SOCKET_OPEN) {
      this.sendActionRequest({ type: 'systemStats', enabled: this.systemStatsWatched });
    }
  }

  // Das Bild kommt nicht mit der sekuendlichen Meldung, sondern nur bei neuer CoverId per HTTP - mit
  // Token im Header, deshalb fetch statt <img src>. Eine Antwort zu einem inzwischen anderen Cover
  // wird verworfen.
  private async loadMediaCover(coverId: string | null): Promise<void> {
    if (coverId === this.mediaCoverId) {
      return;
    }

    this.mediaCoverId = coverId;
    this.mediaCoverSignal.set(null);
    const token = this.pairing.token();
    if (coverId === null || token === null) {
      return;
    }

    try {
      const response = await this.fetchFn(
        `${getServerHttpBaseUrl(this.serverLocation)}/media/cover`,
        { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } },
      );
      const cover = response.status === 200 ? await toDataUrl(response) : null;
      if (this.mediaCoverId === coverId) {
        this.mediaCoverSignal.set(cover);
      }
    } catch {
      // Ohne Cover bleibt das Symbol stehen.
    }
  }

  private clearMediaCover(): void {
    this.mediaCoverId = null;
    this.mediaCoverSignal.set(null);
  }

  private sendAppsWatch(): void {
    if (this.systemStatsSupported() && this.socket?.readyState === SOCKET_OPEN) {
      this.sendActionRequest({ type: 'apps', enabled: this.appsWatched });
    }
  }

  private sendVoicemeeterWatch(): void {
    if (this.voicemeeterAvailableSignal() && this.socket?.readyState === SOCKET_OPEN) {
      this.sendActionRequest({ type: 'voicemeeter', enabled: this.voicemeeterWatched });
    }
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
    this.gamepadRumbleSignal.set(0);
    // Ein noch gueltiges Angebot kommt beim naechsten Verbinden wieder, ein abgelaufenes nicht.
    this.fileOfferSignal.set(null);
    this.mediaStatusSignal.set(null);
    this.clearMediaCover();
    // Ein noch geplanter Termin kommt beim naechsten Verbinden wieder.
    this.shutdownDeadlineSignal.set(null);
    this.systemStatsSignal.set(null);
    this.voicemeeterSignal.set(null);
    this.appsSignal.set(null);

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
    return parseStoredMouseSensitivity(this.readStorage(MOUSE_SENSITIVITY_STORAGE_KEY));
  }

  private loadServerProfiles(): ServerConfig[] {
    return parseStoredServerProfiles(this.readStorage(SERVER_PROFILES_STORAGE_KEY));
  }

  private recordServerProfile(config: ServerConfig): void {
    const updated = withServerProfile(this.serverProfilesSignal(), config);
    this.serverProfilesSignal.set(updated);
    this.persistServerProfiles(updated);
  }

  private persistServerProfiles(profiles: readonly ServerConfig[]): void {
    this.storage?.setItem(SERVER_PROFILES_STORAGE_KEY, JSON.stringify(profiles));
  }

  private readStorage(key: string): string | null {
    return this.storage?.getItem(key) ?? null;
  }

  private persistMouseSensitivity(sensitivity: number): void {
    this.storage?.setItem(MOUSE_SENSITIVITY_STORAGE_KEY, String(sensitivity));
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error && error.message.length > 0
      ? error.message
      : this.i18n.t('common.unknownError');
  }
}

function parseJson(rawMessage: string): unknown {
  try {
    return JSON.parse(rawMessage);
  } catch {
    return null;
  }
}

function isRumbleMessage(value: unknown): value is GamepadRumbleMessage {
  const message = value as Partial<GamepadRumbleMessage> | null;
  return (
    message?.type === 'rumble' &&
    typeof message.largeMotor === 'number' &&
    typeof message.smallMotor === 'number'
  );
}

function isMediaStatusMessage(value: unknown): value is MediaStatusMessage {
  const message = value as Partial<MediaStatusMessage> | null;
  const optional = (field: unknown, type: string) => field === undefined || typeof field === type;
  return (
    message?.type === 'media' &&
    optional(message.volume, 'number') &&
    typeof message.muted === 'boolean' &&
    optional(message.title, 'string') &&
    optional(message.artist, 'string') &&
    typeof message.playing === 'boolean' &&
    optional(message.position, 'number') &&
    optional(message.duration, 'number') &&
    optional(message.canSeek, 'boolean') &&
    optional(message.coverId, 'string')
  );
}

// Data-URL statt Blob-URL: nichts freizugeben, wenn das Cover wechselt. In Stuecken, weil
// String.fromCharCode nur begrenzt viele Argumente nimmt.
async function toDataUrl(response: Response): Promise<string> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${response.headers.get('Content-Type') ?? 'image/png'};base64,${btoa(binary)}`;
}

function isShutdownTimerMessage(value: unknown): value is ShutdownTimerMessage {
  const message = value as Partial<ShutdownTimerMessage> | null;
  return (
    message?.type === 'shutdownTimer' &&
    (message.remainingSeconds === undefined || typeof message.remainingSeconds === 'number')
  );
}

function isClipboardPushMessage(value: unknown): value is ClipboardPushMessage {
  const message = value as Partial<ClipboardPushMessage> | null;
  return message?.type === 'clipboard' && typeof message.text === 'string';
}

function isSystemStatsMessage(value: unknown): value is SystemStatsMessage {
  const message = value as Partial<SystemStatsMessage> | null;
  const optionalNumber = (field: unknown) => field === undefined || typeof field === 'number';
  return (
    message?.type === 'systemStats' &&
    optionalNumber(message.cpuLoad) &&
    optionalNumber(message.cpuTemperature) &&
    optionalNumber(message.gpuLoad) &&
    optionalNumber(message.gpuTemperature) &&
    typeof message.memoryUsedMb === 'number' &&
    typeof message.memoryTotalMb === 'number'
  );
}

function isVoicemeeterMessage(value: unknown): value is VoicemeeterMessage {
  const message = value as Partial<VoicemeeterMessage> | null;
  if (message?.type !== 'voicemeeter') {
    return false;
  }

  const channels = message.channels as unknown;
  const routes = message.routes as unknown;
  return (
    (channels === undefined ||
      (Array.isArray(channels) &&
        channels.every(
          (channel) =>
            typeof channel?.id === 'string' &&
            typeof channel.name === 'string' &&
            typeof channel.muted === 'boolean' &&
            typeof channel.gain === 'number',
        ))) &&
    (routes === undefined ||
      (Array.isArray(routes) && routes.every((route) => typeof route === 'string')))
  );
}

function isAppVolumesMessage(value: unknown): value is AppVolumesMessage {
  const message = value as Partial<AppVolumesMessage> | null;
  const apps = message?.apps as unknown;
  const outputs = message?.outputs as unknown;
  return (
    message?.type === 'apps' &&
    Array.isArray(apps) &&
    apps.every(
      (app) =>
        typeof app?.id === 'string' &&
        typeof app.name === 'string' &&
        typeof app.volume === 'number' &&
        typeof app.muted === 'boolean',
    ) &&
    (outputs === undefined ||
      (Array.isArray(outputs) &&
        outputs.every(
          (output) =>
            typeof output?.id === 'string' &&
            typeof output.name === 'string' &&
            typeof output.default === 'boolean',
        )))
  );
}

function isFileOfferMessage(value: unknown): value is FileOfferMessage {
  const message = value as Partial<FileOfferMessage> | null;
  return (
    message?.type === 'fileOffer' &&
    typeof message.id === 'string' &&
    typeof message.name === 'string' &&
    typeof message.size === 'number'
  );
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
