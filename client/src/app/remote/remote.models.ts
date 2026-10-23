export interface KeyboardAction {
  readonly type: 'key' | 'hotkey';
  readonly keys: readonly string[];
}

export interface MouseMoveAction {
  readonly type: 'mouseMove';
  readonly deltaX: number;
  readonly deltaY: number;
}

export interface MouseClickAction {
  readonly type: 'mouseClick';
  readonly button: 'left' | 'right' | 'middle';
}

export interface MouseButtonAction {
  readonly type: 'mouseDown' | 'mouseUp';
  readonly button: 'left' | 'right' | 'middle';
}

export interface MouseScrollAction {
  readonly type: 'mouseScroll';
  readonly delta?: number;
  readonly deltaX?: number;
}

/** Energieaktion des Rechners; ohne Rueckmeldung, da der Rechner danach weg ist. */
export interface PowerAction {
  readonly type: 'shutdown' | 'restart' | 'sleep' | 'lock' | 'displayOff';
}

/** Faehrt den PC nach `minutes` Minuten herunter (max. 1440); 0 bricht einen Termin ab. */
export interface ShutdownTimerAction {
  readonly type: 'shutdownTimer';
  readonly minutes: number;
}

/** Setzt die PC-Lautstaerke (0-100) und hebt die Stummschaltung auf. */
export interface VolumeAction {
  readonly type: 'volume';
  readonly volume: number;
}

export interface TextAction {
  readonly type: 'text';
  readonly text: string;
}

/** Vollstaendiger Zustand des virtuellen Xbox-Controllers: `buttons` ist die XInput-Bitmaske,
 *  Sticks laufen von -32768 bis 32767 (Y positiv = oben), Trigger von 0 bis 255. */
export interface GamepadState {
  readonly buttons: number;
  readonly leftX: number;
  readonly leftY: number;
  readonly rightX: number;
  readonly rightY: number;
  readonly leftTrigger: number;
  readonly rightTrigger: number;
}

export interface GamepadAction {
  readonly type: 'gamepad';
  readonly gamepad: GamepadState;
}

/** Vibrationswunsch eines Spiels; kommt ungefragt vom Server, nicht als Antwort. */
/** Der Server bietet eine Datei an (Windows-Tray "Datei an Geräte senden...", Android "Teilen"),
 *  abrufbar ueber GET /files/{id}. */
export interface FileOfferMessage {
  readonly type: 'fileOffer';
  readonly id: string;
  readonly name: string;
  readonly size: number;
}

/** Geplantes Herunterfahren am PC; ohne `remainingSeconds` ist keines geplant. */
export interface ShutdownTimerMessage {
  readonly type: 'shutdownTimer';
  readonly remainingSeconds?: number;
}

export interface GamepadRumbleMessage {
  readonly type: 'rumble';
  readonly largeMotor: number;
  readonly smallMotor: number;
}

/** Steckt den Controller dieser Verbindung am PC wieder ab. */
export interface GamepadDisconnectAction {
  readonly type: 'gamepadDisconnect';
}

/** Schaltet fuer diese Verbindung den automatischen Zwischenablage-Abgleich ein oder aus. */
export interface ClipboardSyncAction {
  readonly type: 'clipboardSync';
  readonly enabled: boolean;
}

/** Schaltet fuer diese Verbindung die Systemanzeige ein oder aus; der PC misst nur, solange
 *  mindestens ein Geraet sie eingeschaltet hat. */
export interface SystemStatsAction {
  readonly type: 'systemStats';
  readonly enabled: boolean;
}

/** Auslastung in Prozent, Temperaturen in Grad Celsius; ein Wert fehlt, wenn der PC ihn nicht
 *  liefert (CPU-Temperatur unter Windows, GPU-Temperatur bei integrierter Grafik). */
export interface SystemStatsMessage {
  readonly type: 'systemStats';
  readonly cpuLoad?: number;
  readonly cpuTemperature?: number;
  readonly gpuLoad?: number;
  readonly gpuTemperature?: number;
  readonly memoryUsedMb: number;
  readonly memoryTotalMb: number;
}

/** Schaltet fuer diese Verbindung den Voicemeeter-Mixer ein oder aus; wie die Systemanzeige liest
 *  der PC Voicemeeter nur, solange ein Geraet zusieht. */
export interface VoicemeeterWatchAction {
  readonly type: 'voicemeeter';
  readonly enabled: boolean;
}

/** Setzt einen Voicemeeter-Wert: `parameter` wie "Strip[3].Mute", "Strip[0].A1" oder "Bus[0].Gain".
 *  Schalter nehmen 0/1 oder ohne `value` ein Umschalten, Gain -60 bis 12 dB. */
export interface VoicemeeterParameterAction {
  readonly type: 'voicemeeterParameter';
  readonly parameter: string;
  readonly value?: number;
}

/** Ein Voicemeeter-Eingang ("Strip[n]") oder -Bus ("Bus[n]"); `gain` in dB. */
export interface VoicemeeterChannel {
  readonly id: string;
  readonly name: string;
  readonly muted: boolean;
  readonly gain: number;
}

/** Alle Kanaele, solange der Mixer offen ist; ohne `channels` laeuft Voicemeeter nicht.
 *  `routes` sind die Busse, auf die ein Eingang schalten kann ("A1" ... "B3"). */
export interface VoicemeeterMessage {
  readonly type: 'voicemeeter';
  readonly channels?: readonly VoicemeeterChannel[];
  readonly routes?: readonly string[];
}

/** Schaltet fuer diese Verbindung die Lautstaerke pro App ein oder aus (Tab "Mixer"). */
export interface AppsWatchAction {
  readonly type: 'apps';
  readonly enabled: boolean;
}

/** Setzt Lautstaerke (0-100) und/oder Stummschaltung einer App. */
export interface AppVolumeAction {
  readonly type: 'appVolume';
  readonly id: string;
  readonly volume?: number;
  readonly muted?: boolean;
}

/** Eine App mit Ton am PC; `id` ist die Prozessnummer, unter Linux die Stream-Nummer, oder
 *  "system" fuer die Systemklaenge. */
export interface AppVolume {
  readonly id: string;
  readonly name: string;
  readonly volume: number;
  readonly muted: boolean;
}

export interface AppVolumesMessage {
  readonly type: 'apps';
  readonly apps: readonly AppVolume[];
}

/** Lautstaerke und laufendes Medium am PC; kommt ungefragt beim Verbinden und bei jeder Aenderung.
 *  `volume` fehlt ohne Wiedergabegeraet, `title` wenn keine App Medien meldet. `position` und
 *  `duration` in Sekunden fehlen ohne Zeitleiste; `coverId` wechselt mit dem Bild hinter
 *  `GET /media/cover`. */
export interface MediaStatusMessage {
  readonly type: 'media';
  readonly volume?: number;
  readonly muted: boolean;
  readonly title?: string;
  readonly artist?: string;
  readonly playing: boolean;
  readonly position?: number;
  readonly duration?: number;
  readonly canSeek?: boolean;
  readonly coverId?: string;
}

/** Springt in der laufenden Medien-App an `position` Sekunden. */
export interface MediaSeekAction {
  readonly type: 'mediaSeek';
  readonly position: number;
}

/** Neuer Text in der PC-Zwischenablage, nur bei eingeschaltetem Abgleich. */
export interface ClipboardPushMessage {
  readonly type: 'clipboard';
  readonly text: string;
}

export type RemoteAction =
  | KeyboardAction
  | MouseMoveAction
  | MouseClickAction
  | MouseButtonAction
  | MouseScrollAction
  | PowerAction
  | ShutdownTimerAction
  | VolumeAction
  | MediaSeekAction
  | TextAction
  | GamepadAction
  | GamepadDisconnectAction
  | ClipboardSyncAction
  | SystemStatsAction
  | VoicemeeterWatchAction
  | VoicemeeterParameterAction
  | AppsWatchAction
  | AppVolumeAction;

/** Ein Schritt in einer Aktionskette (Makro): eine Aktion plus Wartezeit davor. */
export interface MacroStep {
  readonly action: RemoteAction;
  readonly delayMs: number;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface ServerConfig {
  readonly host: string;
  readonly port: number;
}

export interface RemoteSuccessResponse {
  readonly requestId?: string;
  readonly success: true;
}

export interface RemoteErrorResponse {
  readonly requestId?: string;
  readonly success: false;
  readonly error?: string;
}

export type RemoteResponse = RemoteSuccessResponse | RemoteErrorResponse;

/** Plattform der Gegenstelle, wie sie `GET /health` meldet. */
export type ServerPlatform = 'windows' | 'linux' | 'android';

export type RemoteIcon =
  | 'arrow-up'
  | 'arrow-down'
  | 'arrow-left'
  | 'arrow-right'
  | 'check'
  | 'home'
  | 'recents'
  | 'back'
  | 'next-tab'
  | 'previous-tab'
  | 'close-tab'
  | 'restore-tab'
  | 'fullscreen'
  | 'play-pause'
  | 'volume-plus'
  | 'volume-minus'
  | 'volume-mute'
  | 'track-previous'
  | 'track-next'
  | 'stop'
  | 'settings'
  | 'refresh'
  | 'disconnect'
  | 'key'
  | 'star'
  | 'plus'
  | 'edit'
  | 'power'
  | 'restart'
  | 'sleep'
  | 'lock'
  | 'monitor'
  | 'timer'
  | 'mic'
  | 'upload'
  | 'download'
  | 'clipboard';

export interface RemoteButtonConfig {
  readonly id: string;
  readonly label: string;
  readonly ariaLabel: string;
  readonly icon: RemoteIcon;
  readonly action?: RemoteAction;
  /** Mehrschrittige Aktionskette; nimmt Vorrang vor `action`, wenn gesetzt. */
  readonly steps?: readonly MacroStep[];
  /** Sicherheitsabfrage vor dem Ausloesen; Text der Rueckfrage. */
  readonly confirm?: string;
  readonly disabled?: boolean;
  readonly unavailableText?: string;
  /** Blendet die Textbeschriftung neben dem Symbol aus (z. B. die D-Pad-Pfeile). Default: true. */
  readonly showLabel?: boolean;
}
