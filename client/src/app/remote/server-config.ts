import { InjectionToken } from '@angular/core';
import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { ServerConfig } from './remote.models';

export const MOUSE_SENSITIVITY_STORAGE_KEY = 'yfremote.mouseSensitivity';
export const DEFAULT_MOUSE_SENSITIVITY = 1;
export const MOUSE_SENSITIVITY_MIN = 0.5;
export const MOUSE_SENSITIVITY_MAX = 4;
export const MOUSE_SENSITIVITY_STEP = 0.25;

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
  if (!Number.isFinite(value)) {
    return null;
  }

  const roundedValue = Math.round(value * 100) / 100;

  if (roundedValue < MOUSE_SENSITIVITY_MIN || roundedValue > MOUSE_SENSITIVITY_MAX) {
    return null;
  }

  return roundedValue;
}

export function parseStoredMouseSensitivity(rawValue: string | null): number {
  if (rawValue === null) {
    return DEFAULT_MOUSE_SENSITIVITY;
  }

  const parsedValue = Number(rawValue);
  return normalizeMouseSensitivity(parsedValue) ?? DEFAULT_MOUSE_SENSITIVITY;
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

export const mouseSensitivityValidator: ValidatorFn = (
  control: AbstractControl<unknown>,
): ValidationErrors | null => {
  const value =
    typeof control.value === 'number' || typeof control.value === 'string'
      ? Number(control.value)
      : Number.NaN;

  return normalizeMouseSensitivity(value) === null ? { mouseSensitivity: true } : null;
};

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
