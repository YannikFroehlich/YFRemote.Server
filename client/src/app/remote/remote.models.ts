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
  readonly button: 'left' | 'right';
}

export interface MouseScrollAction {
  readonly type: 'mouseScroll';
  readonly delta: number;
}

export interface TextAction {
  readonly type: 'text';
  readonly text: string;
}

export type RemoteAction =
  KeyboardAction | MouseMoveAction | MouseClickAction | MouseScrollAction | TextAction;

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

export type RemoteIcon =
  | 'arrow-up'
  | 'arrow-down'
  | 'arrow-left'
  | 'arrow-right'
  | 'check'
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
  | 'settings'
  | 'refresh'
  | 'disconnect'
  | 'key'
  | 'star'
  | 'plus'
  | 'edit';

export interface RemoteButtonConfig {
  readonly id: string;
  readonly label: string;
  readonly ariaLabel: string;
  readonly icon: RemoteIcon;
  readonly action?: RemoteAction;
  /** Mehrschrittige Aktionskette; nimmt Vorrang vor `action`, wenn gesetzt. */
  readonly steps?: readonly MacroStep[];
  readonly disabled?: boolean;
  readonly unavailableText?: string;
  /** Blendet die Textbeschriftung neben dem Symbol aus (z. B. die D-Pad-Pfeile). Default: true. */
  readonly showLabel?: boolean;
}
