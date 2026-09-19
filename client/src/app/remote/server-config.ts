import { InjectionToken } from '@angular/core';
import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { ServerConfig } from './remote.models';

export const MOUSE_SENSITIVITY_STORAGE_KEY = 'yfremote.mouseSensitivity';
export const DEFAULT_MOUSE_SENSITIVITY = 1;
export const MOUSE_SENSITIVITY_MIN = 0.5;
export const MOUSE_SENSITIVITY_MAX = 4;
export const MOUSE_SENSITIVITY_STEP = 0.25;
export const SCROLL_SPEED_STORAGE_KEY = 'yfremote.scrollSpeed';
export const DEFAULT_SCROLL_SPEED = 1;
export const SCROLL_SPEED_MIN = 0.25;
export const SCROLL_SPEED_MAX = 3;
export const SCROLL_SPEED_STEP = 0.25;
export const INVERT_SCROLL_STORAGE_KEY = 'yfremote.invertScroll';
export const HAPTICS_STORAGE_KEY = 'yfremote.haptics';
export const POINTER_ACCELERATION_STORAGE_KEY = 'yfremote.pointerAcceleration';
export const LIVE_TYPING_STORAGE_KEY = 'yfremote.liveTyping';

const IPV4_SEGMENT_PATTERN = '(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])';
const IPV4_PATTERN = new RegExp(
  `^${IPV4_SEGMENT_PATTERN}\\.${IPV4_SEGMENT_PATTERN}\\.${IPV4_SEGMENT_PATTERN}\\.${IPV4_SEGMENT_PATTERN}$`,
);
const HOSTNAME_PATTERN =
  /^(localhost|([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?))*)$/i;

export function normalizeHost(host: string): string {
  return host.trim();
}

export function isValidHost(host: string): boolean {
  const normalizedHost = normalizeHost(host);

  if (
    normalizedHost.length === 0 ||
    normalizedHost.includes('://') ||
    /[\s/:?#]/.test(normalizedHost)
  ) {
    return false;
  }

  return IPV4_PATTERN.test(normalizedHost) || HOSTNAME_PATTERN.test(normalizedHost);
}

export interface ServerLocation {
  readonly protocol: string;
  readonly hostname: string;
  readonly port: string;
  readonly origin: string;
  readonly pathname?: string;
  readonly search?: string;
  readonly hash?: string;
  assign(url: string): void;
}

export const SERVER_LOCATION = new InjectionToken<ServerLocation>('SERVER_LOCATION', {
  providedIn: 'root',
  factory: () => globalThis.location,
});

export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

export function parsePortValue(value: unknown): number | null {
  if (typeof value === 'number') {
    return isValidPort(value) ? value : null;
  }

  if (typeof value !== 'string' || !/^[0-9]+$/.test(value.trim())) {
    return null;
  }

  const parsedPort = Number(value);
  return isValidPort(parsedPort) ? parsedPort : null;
}

export function normalizeServerConfig(config: ServerConfig): ServerConfig | null {
  const host = normalizeHost(config.host);

  if (!isValidHost(host) || !isValidPort(config.port)) {
    return null;
  }

  return {
    host,
    port: config.port,
  };
}

export function normalizeMouseSensitivity(value: number): number | null {
  return normalizeRangeValue(value, MOUSE_SENSITIVITY_MIN, MOUSE_SENSITIVITY_MAX);
}

export function parseStoredMouseSensitivity(rawValue: string | null): number {
  if (rawValue === null) {
    return DEFAULT_MOUSE_SENSITIVITY;
  }

  const parsedValue = Number(rawValue);
  return normalizeMouseSensitivity(parsedValue) ?? DEFAULT_MOUSE_SENSITIVITY;
}

export function normalizeScrollSpeed(value: number): number | null {
  return normalizeRangeValue(value, SCROLL_SPEED_MIN, SCROLL_SPEED_MAX);
}

export function parseStoredScrollSpeed(rawValue: string | null): number {
  return rawValue === null
    ? DEFAULT_SCROLL_SPEED
    : (normalizeScrollSpeed(Number(rawValue)) ?? DEFAULT_SCROLL_SPEED);
}

export function parseStoredFlag(rawValue: string | null, fallback: boolean): boolean {
  return rawValue === null ? fallback : rawValue === 'true';
}

function normalizeRangeValue(value: number, min: number, max: number): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }

  const roundedValue = Math.round(value * 100) / 100;
  return roundedValue < min || roundedValue > max ? null : roundedValue;
}

export function getServerConfigFromLocation(location: ServerLocation): ServerConfig {
  const host = normalizeHost(location.hostname);
  const port = parsePortValue(location.port) ?? defaultPortForProtocol(location.protocol);

  return {
    host: isValidHost(host) ? host : 'localhost',
    port,
  };
}

export function getServerHttpBaseUrl(location: ServerLocation): string {
  try {
    const origin = new URL(location.origin);
    if (origin.protocol === 'http:' || origin.protocol === 'https:') {
      return origin.origin;
    }
  } catch {
    // Bei ungewoehnlichen Test- oder Einbettungsumgebungen auf die Einzelwerte fallen.
  }

  return buildServerOrigin(getServerConfigFromLocation(location), httpProtocol(location.protocol));
}

export function getServerWebSocketBaseUrl(location: ServerLocation): string {
  const httpOrigin = new URL(getServerHttpBaseUrl(location));
  const socketProtocol = httpOrigin.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${socketProtocol}//${httpOrigin.host}`;
}

export function getServerPageUrl(config: ServerConfig, location: ServerLocation): string {
  const normalizedConfig = normalizeServerConfig(config);
  if (normalizedConfig === null) {
    throw new Error('Invalid server config.');
  }

  return `${buildServerOrigin(normalizedConfig, httpProtocol(location.protocol))}/`;
}

export const hostValidator: ValidatorFn = (
  control: AbstractControl<unknown>,
): ValidationErrors | null => {
  const value = typeof control.value === 'string' ? control.value : '';
  return isValidHost(value) ? null : { host: true };
};

export const portValidator: ValidatorFn = (
  control: AbstractControl<unknown>,
): ValidationErrors | null => {
  return parsePortValue(control.value) === null ? { port: true } : null;
};

export const mouseSensitivityValidator = rangeValidator(
  normalizeMouseSensitivity,
  'mouseSensitivity',
);
export const scrollSpeedValidator = rangeValidator(normalizeScrollSpeed, 'scrollSpeed');

function rangeValidator(
  normalize: (value: number) => number | null,
  errorKey: string,
): ValidatorFn {
  return (control: AbstractControl<unknown>): ValidationErrors | null => {
    const value =
      typeof control.value === 'number' || typeof control.value === 'string'
        ? Number(control.value)
        : Number.NaN;

    return normalize(value) === null ? { [errorKey]: true } : null;
  };
}

function httpProtocol(protocol: string): 'http:' | 'https:' {
  return protocol === 'https:' ? 'https:' : 'http:';
}

function defaultPortForProtocol(protocol: string): number {
  return protocol === 'https:' ? 443 : 80;
}

function buildServerOrigin(config: ServerConfig, protocol: 'http:' | 'https:'): string {
  const defaultPort = defaultPortForProtocol(protocol);
  const port = config.port === defaultPort ? '' : `:${config.port}`;
  return `${protocol}//${config.host}${port}`;
}
