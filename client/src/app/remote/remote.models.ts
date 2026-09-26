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
  readonly type: 'shutdown' | 'restart' | 'sleep';
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

/** Steckt den Controller dieser Verbindung am PC wieder ab. */
export interface GamepadDisconnectAction {
  readonly type: 'gamepadDisconnect';
}

export type RemoteAction =
  | KeyboardAction
  | MouseMoveAction
  | MouseClickAction
  | MouseButtonAction
  | MouseScrollAction
  | PowerAction
  | TextAction
  | GamepadAction
  | GamepadDisconnectAction;

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
