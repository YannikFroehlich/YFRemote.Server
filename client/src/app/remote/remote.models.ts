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

/** Tipp ins Bild des Tabs "Bildschirm": x und y von 0 bis 1 auf dem Monitor, ohne `monitor` auf
 *  dem Hauptbildschirm. */
export interface ScreenClickAction {
  readonly type: 'screenClick';
  readonly x: number;
  readonly y: number;
  readonly button: 'left' | 'right';
  readonly monitor?: string;
}

/** Der Zeiger folgt dem Finger beim Ziehen im Bild; gedrueckt wird mit `mouseDown`. */
export interface ScreenMoveAction {
  readonly type: 'screenMove';
  readonly x: number;
  readonly y: number;
  readonly monitor?: string;
}

/** Alle Finger, die gerade das Bild beruehren (Schalter "Touch"); leer hebt alle ab. */
export interface TouchAction {
  readonly type: 'touch';
  readonly points: readonly { readonly id: number; readonly x: number; readonly y: number }[];
  readonly monitor?: string;
}

/** Der Stift als echter Windows-Stift (Schalter "Touch"); `null` nimmt ihn aus der Reichweite. */
export interface PenAction {
  readonly type: 'pen';
  readonly pen: {
    readonly x: number;
    readonly y: number;
    readonly pressure: number;
    readonly tiltX: number;
    readonly tiltY: number;
    readonly contact: boolean;
    readonly barrel: boolean;
    readonly eraser: boolean;
  } | null;
  readonly monitor?: string;
}

/** Ein Monitor des PCs aus `GET /screen/monitors`. */
export interface ScreenMonitor {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly primary: boolean;
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

/** Mausrad mit gehaltener Strg-Taste: so zoomt am PC auch das Spreizen auf einem Touchpad. */
export interface MouseZoomAction {
  readonly type: 'mouseZoom';
  readonly delta: number;
}

/** Energieaktion des Rechners; ohne Rueckmeldung, da der Rechner danach weg ist. */
export interface PowerAction {
  readonly type: 'shutdown' | 'restart' | 'sleep' | 'lock' | 'displayOff';
}

/** Was ein Timer bei Ablauf tut; ohne Angabe faehrt der PC herunter. */
export type TimerPower = 'shutdown' | 'sleep' | 'displayOff';

/** Faehrt den PC nach `minutes` Minuten herunter (max. 1440), oder schickt ihn mit `power` in den
 *  Ruhemodus bzw. schaltet den Bildschirm aus; 0 bricht einen Termin ab. */
export interface ShutdownTimerAction {
  readonly type: 'shutdownTimer';
  readonly minutes: number;
  readonly power?: TimerPower;
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
/** Kommt vom PC bei jedem Verbinden zuerst; `mediaOnly` = im Tray auf "Nur Medien" gestellt. */
export interface AccessMessage {
  readonly type: 'access';
  readonly mediaOnly: boolean;
}

export interface ShutdownTimerMessage {
  readonly type: 'shutdownTimer';
  readonly remainingSeconds?: number;
  /** Fehlt bei einem aelteren Server: dann Herunterfahren. */
  readonly action?: TimerPower;
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

/** Leitet fuer diese Verbindung neue Windows-Benachrichtigungen ans Geraet weiter (oder nicht mehr). */
export interface NotificationsAction {
  readonly type: 'notifications';
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
  /** Nur von der Android-App: Akkustand in Prozent, am Strom, Akkutemperatur in Grad Celsius. */
  readonly batteryLevel?: number;
  readonly batteryCharging?: boolean;
  readonly batteryTemperature?: number;
  /** Windows-Energiemodus; fehlt, wenn der PC keinen umschaltbaren hat. */
  readonly powerMode?: PowerMode;
  /** Anzeigemodus wie bei Win+P; fehlt, wenn der PC ihn nicht meldet. */
  readonly displayMode?: DisplayMode;
  /** Mikrofon stummgeschaltet; fehlt ohne Mikrofon. */
  readonly micMuted?: boolean;
  /** Fest eingebaute Laufwerke; fehlt bei aelteren Servern und der Android-App. */
  readonly drives?: readonly DriveStats[];
  /** Durchsatz aller Netzwerkadapter in Kilobit pro Sekunde; fehlt bei der ersten Messung. */
  readonly netDownKbps?: number;
  readonly netUpKbps?: number;
}

export interface DriveStats {
  readonly name: string;
  readonly freeMb: number;
  readonly totalMb: number;
}

/** Ein Prozess aus `GET /processes`; `cpu` in Prozent aller Kerne zusammen. */
export interface ProcessInfo {
  readonly id: number;
  readonly name: string;
  readonly cpu: number;
  readonly memoryMb: number;
}

/** Beendet einen Prozess aus `GET /processes`; der Name sichert gegen eine neu vergebene Nummer. */
export interface KillProcessAction {
  readonly type: 'killProcess';
  readonly id: string;
  readonly name: string;
}

export type DisplayMode = 'internal' | 'clone' | 'extend' | 'external';

/** Stellt den Anzeigemodus um (Tab "PC"). */
export interface DisplayModeAction {
  readonly type: 'displayMode';
  readonly mode: DisplayMode;
}

/** Schaltet das Standard-Mikrofon des PCs stumm oder wieder ein (Tab "PC"). */
export interface MicMuteAction {
  readonly type: 'micMute';
  readonly muted: boolean;
}

/** Eine Datei im Empfangsordner des PCs (`GET /folder`). */
export interface FolderFile {
  readonly name: string;
  readonly size: number;
}

export type PowerMode = 'efficiency' | 'balanced' | 'performance';

/** Stellt den Windows-Energiemodus um (Tab "PC"). */
export interface PowerModeAction {
  readonly type: 'powerMode';
  readonly mode: PowerMode;
}

/** Entfernt eine weitergeleitete Windows-Benachrichtigung auch im Info-Center des PCs. */
export interface DismissNotificationAction {
  readonly type: 'dismissNotification';
  readonly id: string;
}

/** Ein Bildschirm aus `GET /brightness`; `id` ist `internal` fuer das eingebaute Display. */
export interface MonitorBrightness {
  readonly id: string;
  readonly brightness: number;
}

/** Stellt die Helligkeit (0-100) eines Bildschirms aus `GET /brightness` (Tab "PC"). */
export interface BrightnessAction {
  readonly type: 'brightness';
  readonly id: string;
  readonly value: number;
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

/** Schaltet fuer diese Verbindung den Tab "OBS" ein oder aus; der PC fragt OBS nur, solange
 *  ein Geraet zusieht. */
export interface ObsWatchAction {
  readonly type: 'obs';
  readonly enabled: boolean;
}

/** Solange die Maus ueber dem Bild im Tab "Bildschirm" ist: der PC meldet die Form seines Zeigers
 *  und laesst ihn aus dem Bild weg, damit man nur einen sieht. */
export interface ScreenCursorAction {
  readonly type: 'screenCursor';
  readonly enabled: boolean;
}

/** Form des PC-Zeigers als CSS-Wert fuer `cursor`. */
export interface ScreenCursorMessage {
  readonly type: 'screenCursor';
  readonly shape: string;
}

/** Wechselt in OBS auf die Szene `name`. */
export interface ObsSceneAction {
  readonly type: 'obsScene';
  readonly name: string;
}

/** Stream in OBS starten, stoppen oder (ohne `mode`) umschalten. */
export interface ObsStreamAction {
  readonly type: 'obsStream';
  readonly mode?: 'start' | 'stop' | 'toggle';
}

/** Aufnahme in OBS; zusaetzlich pausieren und fortsetzen. Ohne `mode` umschalten. */
export interface ObsRecordAction {
  readonly type: 'obsRecord';
  readonly mode?: 'start' | 'stop' | 'toggle' | 'pause' | 'resume' | 'togglePause';
}

/** Wiederholungspuffer in OBS; `save` speichert die letzten Sekunden. Ohne `mode` umschalten. */
export interface ObsReplayAction {
  readonly type: 'obsReplay';
  readonly mode?: 'start' | 'stop' | 'toggle' | 'save';
}

/** Virtuelle Kamera in OBS. Ohne `mode` umschalten. */
export interface ObsVirtualCamAction {
  readonly type: 'obsVirtualCam';
  readonly mode?: 'start' | 'stop' | 'toggle';
}

/** Lautstaerke einer Audioquelle in OBS, `value` in dB (-100 bis 26) wie ihr Fader. */
export interface ObsVolumeAction {
  readonly type: 'obsVolume';
  readonly name: string;
  readonly value: number;
}

/** Blendet eine Quelle der Szene `name` ein oder aus; `id` ist OBS' sceneItemId. */
export interface ObsSourceAction {
  readonly type: 'obsSource';
  readonly name: string;
  readonly id: string;
  readonly enabled: boolean;
}

/** Eine Quelle der aktuellen Szene; `enabled` ist ihr Auge in der Quellenliste von OBS. */
export interface ObsSceneItem {
  readonly id: number;
  readonly name: string;
  readonly enabled: boolean;
}

/** Schaltet eine Audioquelle in OBS stumm (`muted`) oder ohne `muted` um. */
export interface ObsMuteAction {
  readonly type: 'obsMute';
  readonly name: string;
  readonly muted?: boolean;
}

/** Eine Audioquelle in OBS; `volume` in dB wie ihr Fader (-100 = ganz unten). */
export interface ObsInput {
  readonly name: string;
  readonly muted: boolean;
  readonly volume: number;
}

/** Zustand von OBS, solange der Tab offen ist. `offline`: OBS laeuft nicht, `disabled`: der
 *  WebSocket-Server ist in OBS aus, `authFailed`: das Passwort passt nicht. */
export interface ObsMessage {
  readonly type: 'obs';
  readonly state: 'connected' | 'offline' | 'disabled' | 'authFailed';
  readonly scenes?: readonly string[];
  readonly currentScene?: string;
  readonly streaming: boolean;
  readonly recording: boolean;
  readonly recordPaused: boolean;
  readonly inputs?: readonly ObsInput[];
  /** Laufzeit in Sekunden, nur solange gesendet bzw. aufgenommen wird. */
  readonly streamSeconds?: number;
  readonly recordSeconds?: number;
  /** Fehlen, wo OBS sie nicht anbietet (Wiederholungspuffer in den Einstellungen aus). */
  readonly replayBuffer?: boolean;
  readonly virtualCam?: boolean;
  /** Quellen der aktuellen Szene, oben in OBS zuerst. */
  readonly sources?: readonly ObsSceneItem[];
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

/** Schaltet fuer diese Verbindung die Meldung des Programms im Vordergrund ein oder aus
 *  (automatischer Profilwechsel, nur Windows). */
export interface ForegroundAppWatchAction {
  readonly type: 'foregroundApp';
  readonly enabled: boolean;
}

/** Programm im Vordergrund am PC, Name wie im Mixer; `null` ohne Fenster im Vordergrund. */
export interface ForegroundAppMessage {
  readonly type: 'foregroundApp';
  readonly name: string | null;
}

/** Setzt Lautstaerke (0-100) und/oder Stummschaltung einer App: per `id` aus dem Mixer oder per
 *  `name` aus einem eigenen Button (trifft alle Apps des Namens; ohne beides wird umgeschaltet). */
export interface AppVolumeAction {
  readonly type: 'appVolume';
  readonly id?: string;
  readonly name?: string;
  readonly volume?: number;
  readonly muted?: boolean;
}

/** Startet eine App aus `GET /launch/apps` per `name` oder oeffnet eine http(s)-`url` im
 *  Standardbrowser des PCs. */
export interface LaunchAction {
  readonly type: 'launch';
  readonly name?: string;
  readonly url?: string;
}

/** Ein Fenster aus `GET /windows` (wie Alt+Tab, das vorderste zuerst); `id` ist das Fensterhandle. */
export interface OpenWindow {
  readonly id: string;
  readonly title: string;
  readonly app: string;
}

/** Holt ein Fenster aus `GET /windows` in den Vordergrund, minimiert oder schliesst es;
 *  `killWindow` beendet seinen Prozess ohne Rueckfrage der App. */
export interface FocusWindowAction {
  readonly type: 'focusWindow' | 'minimizeWindow' | 'closeWindow' | 'killWindow';
  readonly id: string;
}

/** Macht ein Geraet aus `AppVolumesMessage.outputs` zum Standard-Wiedergabegeraet. */
export interface AudioOutputAction {
  readonly type: 'audioOutput';
  readonly id: string;
}

export interface AudioOutput {
  readonly id: string;
  readonly name: string;
  readonly default: boolean;
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
  readonly outputs?: readonly AudioOutput[];
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
/** Neu Kopiertes am PC: Text, oder ohne Text die Kennung eines Bilds (`GET /clipboard/image`). */
export interface ClipboardPushMessage {
  readonly type: 'clipboard';
  readonly text?: string;
  readonly imageId?: string;
}

/** Eine neue Windows-Benachrichtigung; `title` ist ihre erste Zeile, `text` der Rest. */
export interface PcNotificationMessage {
  readonly type: 'notification';
  readonly id: number;
  readonly app: string;
  readonly title: string;
  readonly text: string;
}

export type RemoteAction =
  | KeyboardAction
  | MouseMoveAction
  | MouseClickAction
  | ScreenClickAction
  | ScreenMoveAction
  | TouchAction
  | PenAction
  | MouseButtonAction
  | MouseScrollAction
  | MouseZoomAction
  | PowerAction
  | ShutdownTimerAction
  | VolumeAction
  | MediaSeekAction
  | TextAction
  | GamepadAction
  | GamepadDisconnectAction
  | ClipboardSyncAction
  | NotificationsAction
  | SystemStatsAction
  | VoicemeeterWatchAction
  | VoicemeeterParameterAction
  | AppsWatchAction
  | ForegroundAppWatchAction
  | AppVolumeAction
  | AudioOutputAction
  | LaunchAction
  | FocusWindowAction
  | PowerModeAction
  | DisplayModeAction
  | KillProcessAction
  | MicMuteAction
  | DismissNotificationAction
  | BrightnessAction
  | ObsWatchAction
  | ScreenCursorAction
  | ObsSceneAction
  | ObsStreamAction
  | ObsRecordAction
  | ObsReplayAction
  | ObsVirtualCamAction
  | ObsVolumeAction
  | ObsSourceAction
  | ObsMuteAction;

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
  | 'keyboard'
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
