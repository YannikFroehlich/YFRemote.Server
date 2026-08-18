import { RemoteIcon } from './remote.models';

export const REMOTE_ICON_PATHS: Readonly<Record<RemoteIcon, string>> = {
  'arrow-up': 'M12 5 5 12h4v7h6v-7h4l-7-7Z',
  'arrow-down': 'M12 19 19 12h-4V5H9v7H5l7 7Z',
  'arrow-left': 'M5 12 12 5v4h7v6h-7v4l-7-7Z',
  'arrow-right': 'M19 12 12 5v4H5v6h7v4l7-7Z',
  check: 'M9.2 16.2 4.9 12l-2 2 6.3 6L21.3 7.6l-2-1.9-10.1 10.5Z',
  back: 'M9 6 4 11l5 5v-3h6.1c1.8 0 3.4 1.2 3.9 2.9l.2.8 1.9-1.1-.1-.5c-.8-2.4-3.1-4.1-5.9-4.1H9V6Z',
  'next-tab': 'M13 5 21 12l-8 7v-5H3v-4h10V5Z',
  'previous-tab': 'M11 5 3 12l8 7v-5h10v-4H11V5Z',
  fullscreen: 'M5 5h6v2H7v4H5V5Zm12 2h-4V5h6v6h-2V7ZM7 13v4h4v2H5v-6h2Zm12 0v6h-6v-2h4v-4h2Z',
  'play-pause': 'M5 4 14 12 5 20V4Zm11 1h3v14h-3V5Z',
  'volume-plus': 'M4 9v6h4l5 4V5L8 9H4Zm12-1h2v3h3v2h-3v3h-2v-3h-3v-2h3V8Z',
  'volume-minus': 'M4 9v6h4l5 4V5L8 9H4Zm10 2h7v2h-7v-2Z',
  'volume-mute': 'M4 9v6h4l5 4V5L8 9H4Zm12.3.3 2.2 2.2 2.2-2.2 1.4 1.4-2.2 2.2 2.2 2.2-1.4 1.4-2.2-2.2-2.2 2.2-1.4-1.4 2.2-2.2-2.2-2.2 1.4-1.4Z',
  settings: 'M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.5-2.4 1a7.1 7.1 0 0 0-2.6-1.5L14 2h-4l-.4 3a7.1 7.1 0 0 0-2.6 1.5l-2.4-1-2 3.5 2 1.5c-.1.5-.1 1-.1 1.5s0 1 .1 1.5l-2 1.5 2 3.5 2.4-1a7.1 7.1 0 0 0 2.6 1.5l.4 3h4l.4-3a7.1 7.1 0 0 0 2.6-1.5l2.4 1 2-3.5-2-1.5ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z',
  refresh: 'M17.7 6.3A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.8-4.2L13 11h8V3l-3.3 3.3Z',
  disconnect: 'M7 7h4V3h2v18h-2v-4H7a5 5 0 0 1 0-10Zm10.6 1.4L20.2 11H14v2h6.2l-2.6 2.6L19 17l5-5-5-5-1.4 1.4Z',
};
