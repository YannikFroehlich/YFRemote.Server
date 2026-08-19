import { RemoteButtonConfig } from './remote.models';

export const D_PAD_ACTIONS: readonly RemoteButtonConfig[] = [
  {
    id: 'up',
    label: 'Hoch',
    ariaLabel: 'Nach oben',
    icon: 'arrow-up',
    gridArea: 'up',
    action: { type: 'key', keys: ['UP'] },
  },
  {
    id: 'left',
    label: 'Links',
    ariaLabel: 'Nach links',
    icon: 'arrow-left',
    gridArea: 'left',
    action: { type: 'key', keys: ['LEFT'] },
  },
  {
    id: 'ok',
    label: 'OK',
    ariaLabel: 'OK',
    icon: 'check',
    gridArea: 'ok',
    action: { type: 'key', keys: ['ENTER'] },
  },
  {
    id: 'right',
    label: 'Rechts',
    ariaLabel: 'Nach rechts',
    icon: 'arrow-right',
    gridArea: 'right',
    action: { type: 'key', keys: ['RIGHT'] },
  },
  {
    id: 'down',
    label: 'Runter',
    ariaLabel: 'Nach unten',
    icon: 'arrow-down',
    gridArea: 'down',
    action: { type: 'key', keys: ['DOWN'] },
  },
];

export const BROWSER_ACTIONS: readonly RemoteButtonConfig[] = [
  {
    id: 'previous-tab',
    label: 'Tab zurück',
    ariaLabel: 'Vorheriger Tab',
    icon: 'previous-tab',
    action: { type: 'hotkey', keys: ['CTRL', 'SHIFT', 'TAB'] },
  },
  {
    id: 'next-tab',
    label: 'Tab weiter',
    ariaLabel: 'Nächster Tab',
    icon: 'next-tab',
    action: { type: 'hotkey', keys: ['CTRL', 'TAB'] },
  },
  {
    id: 'close-tab',
    label: 'Tab schließen',
    ariaLabel: 'Tab schließen',
    icon: 'close-tab',
    action: { type: 'hotkey', keys: ['CTRL', 'W'] },
  },
  {
    id: 'restore-tab',
    label: 'Tab wiederherstellen',
    ariaLabel: 'Geschlossenen Tab wiederherstellen',
    icon: 'restore-tab',
    action: { type: 'hotkey', keys: ['CTRL', 'SHIFT', 'T'] },
  },
];

export const SYSTEM_ACTIONS: readonly RemoteButtonConfig[] = [
  {
    id: 'back',
    label: 'Zurück',
    ariaLabel: 'Zurück',
    icon: 'back',
    action: { type: 'key', keys: ['ESC'] },
  },
  {
    id: 'fullscreen',
    label: 'Vollbild',
    ariaLabel: 'Vollbild umschalten',
    icon: 'fullscreen',
    action: { type: 'key', keys: ['F11'] },
  },
];

export const MEDIA_ACTIONS: readonly RemoteButtonConfig[] = [
  {
    id: 'play-pause',
    label: 'Play',
    ariaLabel: 'Play Pause',
    icon: 'play-pause',
    disabled: true,
    unavailableText: 'Noch nicht verfügbar',
  },
  {
    id: 'volume-down',
    label: 'Leiser',
    ariaLabel: 'Leiser',
    icon: 'volume-minus',
    disabled: true,
    unavailableText: 'Noch nicht verfügbar',
  },
  {
    id: 'volume-up',
    label: 'Lauter',
    ariaLabel: 'Lauter',
    icon: 'volume-plus',
    disabled: true,
    unavailableText: 'Noch nicht verfügbar',
  },
  {
    id: 'mute',
    label: 'Stumm',
    ariaLabel: 'Stumm',
    icon: 'volume-mute',
    disabled: true,
    unavailableText: 'Noch nicht verfügbar',
  },
];
