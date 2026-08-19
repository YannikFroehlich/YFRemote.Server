import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { ServerConfig } from './remote.models';

export const SERVER_CONFIG_STORAGE_KEY = 'yfremote.serverConfig';
export const MOUSE_SENSITIVITY_STORAGE_KEY = 'yfremote.mouseSensitivity';
export const DEFAULT_MOUSE_SENSITIVITY = 1;
export const MOUSE_SENSITIVITY_MIN = 0.5;
export const MOUSE_SENSITIVITY_MAX = 4;
export const MOUSE_SENSITIVITY_STEP = 0.25;

const IPV4_SEGMENT_PATTERN =
  '(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])';
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

export const DEFAULT_SERVER_CONFIG: ServerConfig = {
  host: getDefaultServerHost(),
  port: 5050,
};

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

export function parseStoredServerConfig(rawValue: string | null): ServerConfig {
  if (rawValue === null) {
    return DEFAULT_SERVER_CONFIG;
  }

  try {
    const parsedValue: unknown = JSON.parse(rawValue);

    if (!isServerConfigLike(parsedValue)) {
      return DEFAULT_SERVER_CONFIG;
    }

    return normalizeServerConfig(parsedValue) ?? DEFAULT_SERVER_CONFIG;
  } catch {
    return DEFAULT_SERVER_CONFIG;
  }
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

function isServerConfigLike(value: unknown): value is ServerConfig {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<ServerConfig>;
  return typeof candidate.host === 'string' && typeof candidate.port === 'number';
}

function getDefaultServerHost(): string {
  try {
    const pageHost = globalThis.location?.hostname;
    return pageHost && isValidHost(pageHost) ? pageHost : 'localhost';
  } catch {
    return 'localhost';
  }
}
