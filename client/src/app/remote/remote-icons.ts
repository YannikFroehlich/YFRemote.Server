import { RemoteIcon } from './remote.models';

export const REMOTE_ICON_PATHS: Readonly<Record<RemoteIcon, string>> = {
  'arrow-up': 'M12 5 5 12h4v7h6v-7h4l-7-7Z',
  'arrow-down': 'M12 19 19 12h-4V5H9v7H5l7 7Z',
  'arrow-left': 'M5 12 12 5v4h7v6h-7v4l-7-7Z',
  'arrow-right': 'M19 12 12 5v4H5v6h7v4l7-7Z',
  check: 'M9.2 16.2 4.9 12l-2 2 6.3 6L21.3 7.6l-2-1.9-10.1 10.5Z',
  home: 'M12 3 2 12h3v9h6v-6h2v6h6v-9h3L12 3Z',
  recents: 'M4 5h16v2H4V5Zm2 4h12v2H6V9Zm-2 4h16v6H4v-6Z',
  back: 'M9 6 4 11l5 5v-3h6.1c1.8 0 3.4 1.2 3.9 2.9l.2.8 1.9-1.1-.1-.5c-.8-2.4-3.1-4.1-5.9-4.1H9V6Z',
  'next-tab': 'M13 5 21 12l-8 7v-5H3v-4h10V5Z',
  'previous-tab': 'M11 5 3 12l8 7v-5h10v-4H11V5Z',
  'close-tab':
    'M7 5.6 5.6 7l4.9 5-4.9 5 1.4 1.4 5-4.9 5 4.9 1.4-1.4-4.9-5 4.9-5-1.4-1.4-5 4.9-5-4.9Z',
  'restore-tab':
    'M12.5 8c-2.65 0-5.05 1-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8Z',
  fullscreen: 'M5 5h6v2H7v4H5V5Zm12 2h-4V5h6v6h-2V7ZM7 13v4h4v2H5v-6h2Zm12 0v6h-6v-2h4v-4h2Z',
  'play-pause': 'M5 4 14 12 5 20V4Zm11 1h3v14h-3V5Z',
  'volume-plus': 'M4 9v6h4l5 4V5L8 9H4Zm12-1h2v3h3v2h-3v3h-2v-3h-3v-2h3V8Z',
  'volume-minus': 'M4 9v6h4l5 4V5L8 9H4Zm10 2h7v2h-7v-2Z',
  'volume-mute': 'M4 9v6h4l5 4V5L8 9H4Zm12.3.3 2.2 2.2 2.2-2.2 1.4 1.4-2.2 2.2 2.2 2.2-1.4 1.4-2.2-2.2-2.2 2.2-1.4-1.4 2.2-2.2-2.2-2.2 1.4-1.4Z',
  'track-previous': 'M21 5v14l-7-7 7-7Zm-7 0v14l-7-7 7-7ZM6 5v14H3V5h3Z',
  'track-next': 'M3 5v14l7-7-7-7Zm7 0v14l7-7-7-7Zm8 0v14h3V5h-3Z',
  stop: 'M6 6h12v12H6V6Z',
  settings: 'M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.5-2.4 1a7.1 7.1 0 0 0-2.6-1.5L14 2h-4l-.4 3a7.1 7.1 0 0 0-2.6 1.5l-2.4-1-2 3.5 2 1.5c-.1.5-.1 1-.1 1.5s0 1 .1 1.5l-2 1.5 2 3.5 2.4-1a7.1 7.1 0 0 0 2.6 1.5l.4 3h4l.4-3a7.1 7.1 0 0 0 2.6-1.5l2.4 1 2-3.5-2-1.5ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z',
  refresh: 'M17.7 6.3A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.8-4.2L13 11h8V3l-3.3 3.3Z',
  disconnect: 'M7 7h4V3h2v18h-2v-4H7a5 5 0 0 1 0-10Zm10.6 1.4L20.2 11H14v2h6.2l-2.6 2.6L19 17l5-5-5-5-1.4 1.4Z',
  key: 'M9.5 2a5.5 5.5 0 0 0-5.4 6.6L2 10.7V13h2.3l1-1h1.8v-1.8l1-1h1.8v-1.8l1.3-1.3A5.5 5.5 0 1 0 9.5 2Zm3.5 4a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z',
  star: 'm12 2 2.9 6.6 7.1.6-5.4 4.7 1.6 7-6.2-3.8-6.2 3.8 1.6-7L2 9.2l7.1-.6L12 2Z',
  plus: 'M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7V4Z',
  power: 'M11 3h2v10h-2V3Zm5.1 2.2 1.4-1.5a9 9 0 1 1-13 0l1.4 1.5a7 7 0 1 0 10.2 0Z',
  restart: 'M12 5V2L7.5 6 12 10V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7Z',
  sleep: 'M11 4a9 9 0 1 0 9 9 7 7 0 0 1-9-9Zm5-2h6v1.7L18.4 6H22v2h-6V6.3L19.6 4H16V2Z',
  edit: 'M4 17.25V20h2.75l8.11-8.11-2.75-2.75L4 17.25ZM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 2.75 2.75 1.83-1.83Z',
  mic: 'M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2Z',
  upload: 'M5 20h14v-2H5v2Zm7-16-5.5 5.5 1.41 1.41L11 7.83V16h2V7.83l3.09 3.08L17.5 9.5 12 4Z',
  clipboard:
    'M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2Zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1Zm7 16H5V5h2v3h10V5h2v14Z',
};

export const REMOTE_ICONS: readonly RemoteIcon[] = Object.keys(
  REMOTE_ICON_PATHS,
) as readonly RemoteIcon[];
