import type { ButtonPlacement } from './button-layout';
import { RemoteButtonConfig } from './remote.models';

export const D_PAD_ACTIONS: readonly RemoteButtonConfig[] = [
  {
    id: 'up',
    label: 'Hoch',
    ariaLabel: 'Nach oben',
    icon: 'arrow-up',
    action: { type: 'key', keys: ['UP'] },
    showLabel: false,
  },
  {
    id: 'left',
    label: 'Links',
    ariaLabel: 'Nach links',
    icon: 'arrow-left',
    action: { type: 'key', keys: ['LEFT'] },
    showLabel: false,
  },
  {
    id: 'ok',
    label: 'OK',
    ariaLabel: 'OK',
    icon: 'check',
    action: { type: 'key', keys: ['ENTER'] },
  },
  {
    id: 'right',
    label: 'Rechts',
    ariaLabel: 'Nach rechts',
    icon: 'arrow-right',
    action: { type: 'key', keys: ['RIGHT'] },
    showLabel: false,
  },
  {
    id: 'down',
    label: 'Runter',
    ariaLabel: 'Nach unten',
    icon: 'arrow-down',
    action: { type: 'key', keys: ['DOWN'] },
    showLabel: false,
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
    action: { type: 'key', keys: ['MEDIA_PLAY_PAUSE'] },
  },
  {
    id: 'volume-down',
    label: 'Leiser',
    ariaLabel: 'Leiser',
    icon: 'volume-minus',
    action: { type: 'key', keys: ['VOLUME_DOWN'] },
  },
  {
    id: 'volume-up',
    label: 'Lauter',
    ariaLabel: 'Lauter',
    icon: 'volume-plus',
    action: { type: 'key', keys: ['VOLUME_UP'] },
  },
  {
    id: 'mute',
    label: 'Stumm',
    ariaLabel: 'Stumm',
    icon: 'volume-mute',
    action: { type: 'key', keys: ['VOLUME_MUTE'] },
  },
];

/** Alle eingebauten Buttons, flach, für Id-Auflösung im Layout. */
export const BUILT_IN_BUTTONS: readonly RemoteButtonConfig[] = [
  ...D_PAD_ACTIONS,
  ...SYSTEM_ACTIONS,
  ...BROWSER_ACTIONS,
  ...MEDIA_ACTIONS,
];

/** Bildet das bisherige feste Layout in Zellen-Koordinaten nach (12 Spalten). */
export const DEFAULT_PLACEMENTS: readonly ButtonPlacement[] = [
  { id: 'up', col: 3, row: 0, colSpan: 3, rowSpan: 2 },
  { id: 'left', col: 0, row: 2, colSpan: 3, rowSpan: 2 },
  { id: 'ok', col: 3, row: 2, colSpan: 3, rowSpan: 2 },
  { id: 'right', col: 6, row: 2, colSpan: 3, rowSpan: 2 },
  { id: 'down', col: 3, row: 4, colSpan: 3, rowSpan: 2 },
  { id: 'back', col: 9, row: 0, colSpan: 3, rowSpan: 3 },
  { id: 'fullscreen', col: 9, row: 3, colSpan: 3, rowSpan: 3 },
  { id: 'previous-tab', col: 0, row: 6, colSpan: 6, rowSpan: 2 },
  { id: 'next-tab', col: 6, row: 6, colSpan: 6, rowSpan: 2 },
  { id: 'close-tab', col: 0, row: 8, colSpan: 6, rowSpan: 2 },
  { id: 'restore-tab', col: 6, row: 8, colSpan: 6, rowSpan: 2 },
  { id: 'play-pause', col: 0, row: 10, colSpan: 3, rowSpan: 2 },
  { id: 'volume-down', col: 3, row: 10, colSpan: 3, rowSpan: 2 },
  { id: 'volume-up', col: 6, row: 10, colSpan: 3, rowSpan: 2 },
  { id: 'mute', col: 9, row: 10, colSpan: 3, rowSpan: 2 },
];
