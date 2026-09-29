import { inject, InjectionToken, Signal, signal } from '@angular/core';
import { ConnectionStatus, GamepadAction, GamepadDisconnectAction } from '../remote.models';
import { RemoteService } from '../remote.service';

/** Der Teil von RemoteService, den der Controller braucht - austauschbar, damit derselbe
 *  Controller auch per Bluetooth senden kann. */
export interface GamepadTransport {
  readonly status: Signal<ConnectionStatus>;
  readonly lastError: Signal<string | null>;
  readonly gamepadRumble: Signal<number>;
  readonly haptics: Signal<boolean>;
  sendAction(action: GamepadAction | GamepadDisconnectAction): boolean;
}

/** Hängt die Android-App (Bereich "Controller", bluetooth/GamepadActivity.kt) per
 *  addJavascriptInterface als window.YFRemoteBluetooth ein. */
export interface BluetoothGamepadBridge {
  sendGamepad(json: string): boolean;
  getStatus(): string;
  close(): void;
}

export const BLUETOOTH_STATUS_EVENT = 'yfremote-bluetooth-status';

export const BLUETOOTH_GAMEPAD_BRIDGE = new InjectionToken<BluetoothGamepadBridge | null>(
  'BLUETOOTH_GAMEPAD_BRIDGE',
  {
    providedIn: 'root',
    factory: () =>
      (globalThis as { YFRemoteBluetooth?: BluetoothGamepadBridge }).YFRemoteBluetooth ?? null,
  },
);

export const GAMEPAD_TRANSPORT = new InjectionToken<GamepadTransport>('GAMEPAD_TRANSPORT', {
  providedIn: 'root',
  factory: () => {
    const bridge = inject(BLUETOOTH_GAMEPAD_BRIDGE);
    return bridge ? createBluetoothTransport(bridge) : inject(RemoteService);
  },
});

export function createBluetoothTransport(
  bridge: BluetoothGamepadBridge,
  target: EventTarget = globalThis,
): GamepadTransport {
  const status = signal(parseStatus(bridge.getStatus()));
  target.addEventListener(BLUETOOTH_STATUS_EVENT, (event) =>
    status.set(parseStatus((event as CustomEvent<unknown>).detail)),
  );

  return {
    status: status.asReadonly(),
    lastError: signal(null).asReadonly(),
    // Vibration vom Zielgerät kommt über Bluetooth-HID nicht zurück.
    gamepadRumble: signal(0).asReadonly(),
    haptics: signal(true).asReadonly(),
    // gamepadDisconnect braucht es nicht: die App lässt beim Verlassen selbst alles los.
    sendAction: (action) =>
      action.type === 'gamepad' ? bridge.sendGamepad(JSON.stringify(action.gamepad)) : true,
  };
}

function parseStatus(value: unknown): ConnectionStatus {
  return value === 'connected' || value === 'connecting' ? value : 'disconnected';
}
