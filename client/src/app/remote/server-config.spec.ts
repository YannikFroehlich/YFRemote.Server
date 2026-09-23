import {
  getServerConfigFromLocation,
  getServerHttpBaseUrl,
  getServerPageUrl,
  getServerWebSocketBaseUrl,
  isTrustworthyOrigin,
  parseStoredFlag,
  parseStoredScrollSpeed,
  ServerLocation,
} from './server-config';

function createLocation(url: string): ServerLocation {
  const parsedUrl = new URL(url);
  return {
    protocol: parsedUrl.protocol,
    hostname: parsedUrl.hostname,
    port: parsedUrl.port,
    origin: parsedUrl.origin,
    assign: () => undefined,
  };
}

describe('same-origin server config', () => {
  it('uses the host and non-default port that served the page', () => {
    const location = createLocation('http://desk.local:6060/remote');

    expect(getServerConfigFromLocation(location)).toEqual({ host: 'desk.local', port: 6060 });
    expect(getServerHttpBaseUrl(location)).toBe('http://desk.local:6060');
    expect(getServerWebSocketBaseUrl(location)).toBe('ws://desk.local:6060');
  });

  it('maps HTTPS pages to the default HTTPS port and secure WebSockets', () => {
    const location = createLocation('https://remote.example/');

    expect(getServerConfigFromLocation(location)).toEqual({ host: 'remote.example', port: 443 });
    expect(getServerHttpBaseUrl(location)).toBe('https://remote.example');
    expect(getServerWebSocketBaseUrl(location)).toBe('wss://remote.example');
  });

  it('builds a full-page server switch URL with the current page protocol', () => {
    const location = createLocation('https://remote.example/');

    expect(getServerPageUrl({ host: 'living-room.local', port: 7443 }, location)).toBe(
      'https://living-room.local:7443/',
    );
  });
});

describe('stored input preferences', () => {
  it('falls back to defaults for missing or invalid scroll speeds', () => {
    expect(parseStoredScrollSpeed(null)).toBe(1);
    expect(parseStoredScrollSpeed('2.25')).toBe(2.25);
    expect(parseStoredScrollSpeed('9')).toBe(1);
    expect(parseStoredScrollSpeed('abc')).toBe(1);
  });

  it('reads stored flags with a fallback for missing values', () => {
    expect(parseStoredFlag(null, true)).toBe(true);
    expect(parseStoredFlag('false', true)).toBe(false);
    expect(parseStoredFlag('true', false)).toBe(true);
  });
});

describe('trustworthy origin', () => {
  it('accepts HTTPS and the local host names, but not a plain-HTTP LAN address', () => {
    expect(isTrustworthyOrigin(createLocation('https://192.168.178.41:5443/'))).toBe(true);
    expect(isTrustworthyOrigin(createLocation('http://localhost:5050/'))).toBe(true);
    expect(isTrustworthyOrigin(createLocation('http://127.0.0.1:5050/'))).toBe(true);
    expect(isTrustworthyOrigin(createLocation('http://[::1]:5050/'))).toBe(true);
    expect(isTrustworthyOrigin(createLocation('http://192.168.178.41:5050/'))).toBe(false);
    expect(isTrustworthyOrigin(createLocation('http://desk.local:5050/'))).toBe(false);
  });
});
