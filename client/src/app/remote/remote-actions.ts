import type { ButtonPlacement } from './button-layout';
import { RemoteButtonConfig } from './remote.models';

/** label/ariaLabel/confirm sind Keys ins Uebersetzungs-Dictionary (translation.ts), keine
 *  Anzeigetexte - aufgeloest erst beim Rendern ueber TranslationService.t(). */
export const D_PAD_ACTIONS: readonly RemoteButtonConfig[] = [
  {
    id: 'up',
    label: 'button.up.label',
    ariaLabel: 'button.up.ariaLabel',
    icon: 'arrow-up',
    action: { type: 'key', keys: ['UP'] },
    showLabel: false,
  },
  {
    id: 'left',
    label: 'button.left.label',
    ariaLabel: 'button.left.ariaLabel',
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
    label: 'button.right.label',
    ariaLabel: 'button.right.ariaLabel',
    icon: 'arrow-right',
    action: { type: 'key', keys: ['RIGHT'] },
    showLabel: false,
  },
  {
    id: 'down',
    label: 'button.down.label',
    ariaLabel: 'button.down.ariaLabel',
    icon: 'arrow-down',
    action: { type: 'key', keys: ['DOWN'] },
    showLabel: false,
  },
];

export const BROWSER_ACTIONS: readonly RemoteButtonConfig[] = [
  {
    id: 'previous-tab',
    label: 'button.previous-tab.label',
    ariaLabel: 'button.previous-tab.ariaLabel',
    icon: 'previous-tab',
    action: { type: 'hotkey', keys: ['CTRL', 'SHIFT', 'TAB'] },
  },
  {
    id: 'next-tab',
    label: 'button.next-tab.label',
    ariaLabel: 'button.next-tab.ariaLabel',
    icon: 'next-tab',
    action: { type: 'hotkey', keys: ['CTRL', 'TAB'] },
  },
  {
    id: 'close-tab',
    label: 'button.close-tab.label',
    ariaLabel: 'button.close-tab.ariaLabel',
    icon: 'close-tab',
    action: { type: 'hotkey', keys: ['CTRL', 'W'] },
  },
  {
    id: 'restore-tab',
    label: 'button.restore-tab.label',
    ariaLabel: 'button.restore-tab.ariaLabel',
    icon: 'restore-tab',
    action: { type: 'hotkey', keys: ['CTRL', 'SHIFT', 'T'] },
  },
];

export const SYSTEM_ACTIONS: readonly RemoteButtonConfig[] = [
  {
    id: 'back',
    label: 'button.back.label',
    ariaLabel: 'button.back.ariaLabel',
    icon: 'back',
    action: { type: 'key', keys: ['ESC'] },
  },
  {
    id: 'fullscreen',
    label: 'button.fullscreen.label',
    ariaLabel: 'button.fullscreen.ariaLabel',
    icon: 'fullscreen',
    action: { type: 'key', keys: ['F11'] },
  },
];

export const MEDIA_ACTIONS: readonly RemoteButtonConfig[] = [
  {
    id: 'play-pause',
    label: 'Play',
    ariaLabel: 'button.play-pause.ariaLabel',
    icon: 'play-pause',
    action: { type: 'key', keys: ['MEDIA_PLAY_PAUSE'] },
  },
  {
    id: 'volume-down',
    label: 'button.volume-down.label',
    ariaLabel: 'button.volume-down.ariaLabel',
    icon: 'volume-minus',
    action: { type: 'key', keys: ['VOLUME_DOWN'] },
  },
  {
    id: 'volume-up',
    label: 'button.volume-up.label',
    ariaLabel: 'button.volume-up.ariaLabel',
    icon: 'volume-plus',
    action: { type: 'key', keys: ['VOLUME_UP'] },
  },
  {
    id: 'mute',
    label: 'button.mute.label',
    ariaLabel: 'button.mute.ariaLabel',
    icon: 'volume-mute',
    action: { type: 'key', keys: ['VOLUME_MUTE'] },
  },
  {
    id: 'previous-track',
    label: 'button.previous-track.label',
    ariaLabel: 'button.previous-track.ariaLabel',
    icon: 'track-previous',
    action: { type: 'key', keys: ['MEDIA_PREVIOUS'] },
  },
  {
    id: 'stop',
    label: 'button.stop.label',
    ariaLabel: 'button.stop.ariaLabel',
    icon: 'stop',
    action: { type: 'key', keys: ['MEDIA_STOP'] },
  },
  {
    id: 'next-track',
    label: 'button.next-track.label',
    ariaLabel: 'button.next-track.ariaLabel',
    icon: 'track-next',
    action: { type: 'key', keys: ['MEDIA_NEXT'] },
  },
];

export const POWER_ACTIONS: readonly RemoteButtonConfig[] = [
  {
    id: 'sleep',
    label: 'button.sleep.label',
    ariaLabel: 'button.sleep.ariaLabel',
    icon: 'sleep',
    action: { type: 'sleep' },
    confirm: 'button.sleep.confirm',
  },
  {
    id: 'restart',
    label: 'button.restart.label',
    ariaLabel: 'button.restart.ariaLabel',
    icon: 'restart',
    action: { type: 'restart' },
    confirm: 'button.restart.confirm',
  },
  {
    id: 'shutdown',
    label: 'button.shutdown.label',
    ariaLabel: 'button.shutdown.ariaLabel',
    icon: 'power',
    action: { type: 'shutdown' },
    confirm: 'button.shutdown.confirm',
  },
];

/** Alle eingebauten Buttons, flach, für Id-Auflösung im Layout. */
export const BUILT_IN_BUTTONS: readonly RemoteButtonConfig[] = [
  ...D_PAD_ACTIONS,
  ...SYSTEM_ACTIONS,
  ...BROWSER_ACTIONS,
  ...MEDIA_ACTIONS,
  ...POWER_ACTIONS,
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
  { id: 'previous-track', col: 0, row: 12, colSpan: 4, rowSpan: 2 },
  { id: 'stop', col: 4, row: 12, colSpan: 4, rowSpan: 2 },
  { id: 'next-track', col: 8, row: 12, colSpan: 4, rowSpan: 2 },
  { id: 'sleep', col: 0, row: 14, colSpan: 4, rowSpan: 2 },
  { id: 'restart', col: 4, row: 14, colSpan: 4, rowSpan: 2 },
  { id: 'shutdown', col: 8, row: 14, colSpan: 4, rowSpan: 2 },
];
