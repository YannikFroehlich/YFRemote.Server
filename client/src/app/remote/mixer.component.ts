import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { REMOTE_ICON_PATHS } from './remote-icons';
import { VoicemeeterChannel } from './remote.models';
import { RemoteService } from './remote.service';
import { TranslationService } from './translation.service';

type MixerGroup = 'App' | 'Strip' | 'Bus';

/** Eine Zeile im Mixer, egal ob App (`value` 0-100 %) oder Voicemeeter-Kanal (`value` in dB). */
interface MixerRow {
  readonly id: string;
  readonly name: string;
  readonly muted: boolean;
  readonly value: number;
}

type MixerView =
  | { readonly state: 'waiting' | 'notRunning' | 'noApps' }
  | { readonly state: 'rows'; readonly rows: readonly MixerRow[] };

// Der Tab "Mixer": Lautstaerke pro App auf jedem PC, dazu Eingaenge und Busse von Voicemeeter, wo
// es installiert ist. Wie die Systemanzeige liest der PC nur, solange diese Ansicht offen ist.
@Component({
  selector: 'app-mixer',
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './mixer.component.html',
})
export class MixerComponent implements OnDestroy {
  private readonly remote = inject(RemoteService);
  protected readonly i18n = inject(TranslationService);
  protected readonly iconPaths = REMOTE_ICON_PATHS;

  // Die Gruppen sind umschaltbar statt untereinander: so passt eine meist ohne Scrollen aufs Telefon.
  private readonly selectedGroup = signal<MixerGroup>('App');
  protected readonly groups = computed(() =>
    (['App', 'Strip', 'Bus'] as const)
      .filter((kind) => kind === 'App' || this.remote.voicemeeterAvailable())
      .map((kind) => ({
        kind,
        title: { App: 'mixer.apps', Strip: 'mixer.inputs', Bus: 'mixer.outputs' }[kind],
        count:
          kind === 'App' ? (this.remote.apps()?.apps.length ?? 0) : this.channels(kind).length,
      })),
  );
  protected readonly group = computed(() =>
    this.groups().some((group) => group.kind === this.selectedGroup()) ? this.selectedGroup() : 'App',
  );
  protected readonly isApp = computed(() => this.group() === 'App');
  // Mit nur einem Geraet gibt es nichts zu waehlen.
  protected readonly outputs = computed(() => {
    const outputs = this.remote.apps()?.outputs ?? [];
    return outputs.length > 1 ? outputs : [];
  });
  protected readonly view = computed<MixerView>(() => {
    if (this.isApp()) {
      const apps = this.remote.apps()?.apps;
      if (apps === undefined) {
        return { state: 'waiting' };
      }
      return apps.length === 0
        ? { state: 'noApps' }
        : {
            state: 'rows',
            rows: apps.map((app) => ({
              id: app.id,
              name: app.id === 'system' ? this.i18n.t('mixer.systemSounds') : app.name,
              muted: app.muted,
              value: app.volume,
            })),
          };
    }

    const state = this.remote.voicemeeter();
    if (state === null) {
      return { state: 'waiting' };
    }
    return state.channels === undefined
      ? { state: 'notRunning' }
      : {
          state: 'rows',
          rows: this.channels(this.group() as 'Strip' | 'Bus').map((channel) => ({
            id: channel.id,
            name: channel.name,
            muted: channel.muted,
            value: channel.gain,
          })),
        };
  });

  constructor() {
    this.remote.watchApps(true);
    // Der Dienst schickt das nur, wo /health Voicemeeter meldet.
    this.remote.watchVoicemeeter(true);
  }

  ngOnDestroy(): void {
    this.remote.watchApps(false);
    this.remote.watchVoicemeeter(false);
  }

  protected selectGroup(kind: MixerGroup): void {
    this.selectedGroup.set(kind);
  }

  protected selectOutput(event: Event): void {
    this.remote.setAudioOutput((event.target as HTMLSelectElement).value);
  }

  protected toggleMute(row: MixerRow): void {
    if (this.isApp()) {
      this.remote.setApp(row.id, { muted: !row.muted });
    } else {
      this.remote.setVoicemeeterParameter(`${row.id}.Mute`);
    }
  }

  // (change) statt (input) wie beim Lautstaerke-Regler der Medienleiste: sonst setzt die
  // sekuendliche Meldung den Regler mitten im Ziehen zurueck.
  protected setValue(row: MixerRow, event: Event): void {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    if (this.isApp()) {
      this.remote.setApp(row.id, { volume: value });
    } else {
      this.remote.setVoicemeeterParameter(`${row.id}.Gain`, value);
    }
  }

  protected resetGain(row: MixerRow): void {
    this.remote.setVoicemeeterParameter(`${row.id}.Gain`, 0);
  }

  protected formatValue(row: MixerRow): string {
    if (this.isApp()) {
      return `${row.value} %`;
    }
    return `${row.value > 0 ? '+' : ''}${row.value.toFixed(1)} dB`;
  }

  private channels(kind: 'Strip' | 'Bus'): readonly VoicemeeterChannel[] {
    return (
      this.remote.voicemeeter()?.channels?.filter((channel) => channel.id.startsWith(`${kind}[`)) ??
      []
    );
  }
}
