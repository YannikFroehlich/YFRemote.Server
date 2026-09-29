import { describe, expect, it } from 'vitest';
import {
  BLUETOOTH_STATUS_EVENT,
  BluetoothGamepadBridge,
  createBluetoothTransport,
} from './gamepad-transport';

function fakeBridge(status = 'disconnected'): BluetoothGamepadBridge & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    sendGamepad: (json) => {
      sent.push(json);
      return true;
    },
    getStatus: () => status,
    close: () => undefined,
  };
}

describe('createBluetoothTransport', () => {
  it('sends the gamepad state as JSON through the bridge', () => {
    const bridge = fakeBridge('connected');
    const transport = createBluetoothTransport(bridge, new EventTarget());
    const gamepad = {
      buttons: 0x1000,
      leftX: 1,
      leftY: 2,
      rightX: 3,
      rightY: 4,
      leftTrigger: 5,
      rightTrigger: 6,
    };

    expect(transport.sendAction({ type: 'gamepad', gamepad })).toBe(true);
    expect(bridge.sent).toEqual([JSON.stringify(gamepad)]);
    expect(transport.sendAction({ type: 'gamepadDisconnect' })).toBe(true);
    expect(bridge.sent).toHaveLength(1);
  });

  it('follows the status the app reports', () => {
    const target = new EventTarget();
    const transport = createBluetoothTransport(fakeBridge('connecting'), target);
    expect(transport.status()).toBe('connecting');

    target.dispatchEvent(new CustomEvent(BLUETOOTH_STATUS_EVENT, { detail: 'connected' }));
    expect(transport.status()).toBe('connected');

    target.dispatchEvent(new CustomEvent(BLUETOOTH_STATUS_EVENT, { detail: 'kaputt' }));
    expect(transport.status()).toBe('disconnected');
  });
});
