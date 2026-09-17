import {
  getServerConfigFromLocation,
  getServerHttpBaseUrl,
  getServerPageUrl,
  getServerWebSocketBaseUrl,
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
