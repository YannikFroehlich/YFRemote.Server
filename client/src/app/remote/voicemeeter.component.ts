import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { REMOTE_ICON_PATHS } from './remote-icons';
import { VoicemeeterChannel } from './remote.models';
import { RemoteService } from './remote.service';
import { TranslationService } from './translation.service';

type ChannelKind = 'Strip' | 'Bus';

// Der Tab "Mixer": Eingaenge und Busse von Voicemeeter mit Stumm-Schalter, Fader und Ruecksprung
// auf 0 dB. Wie die Systemanzeige liest der PC Voicemeeter nur, solange diese Ansicht offen ist.
@Component({
  selector: 'app-voicemeeter',
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './voicemeeter.component.html',
})
export class VoicemeeterComponent implements OnDestroy {
  private readonly remote = inject(RemoteService);
  protected readonly i18n = inject(TranslationService);
  protected readonly iconPaths = REMOTE_ICON_PATHS;

  protected readonly state = this.remote.voicemeeter;
  // Eingaenge und Ausgaenge getrennt umschaltbar statt untereinander: so passt eine Gruppe meist
  // ohne Scrollen auf ein Telefon.
  protected readonly kind = signal<ChannelKind>('Strip');
  protected readonly groups = computed(() =>
    (['Strip', 'Bus'] as const).map((kind) => ({
      kind,
      title: kind === 'Strip' ? 'mixer.inputs' : 'mixer.outputs',
      count: this.channels(kind).length,
    })),
  );
  protected readonly visibleChannels = computed(() => this.channels(this.kind()));

  constructor() {
    this.remote.watchVoicemeeter(true);
  }

  ngOnDestroy(): void {
    this.remote.watchVoicemeeter(false);
  }

  protected toggleMute(channel: VoicemeeterChannel): void {
    this.remote.setVoicemeeterParameter(`${channel.id}.Mute`);
  }

  // (change) statt (input) wie beim Lautstaerke-Regler der Medienleiste: sonst setzt die
  // sekuendliche Meldung den Fader mitten im Ziehen zurueck.
  protected setGain(channel: VoicemeeterChannel, event: Event): void {
    this.remote.setVoicemeeterParameter(
      `${channel.id}.Gain`,
      (event.target as HTMLInputElement).valueAsNumber,
    );
  }

  protected resetGain(channel: VoicemeeterChannel): void {
    this.remote.setVoicemeeterParameter(`${channel.id}.Gain`, 0);
  }

  protected formatGain(gain: number): string {
    return `${gain > 0 ? '+' : ''}${gain.toFixed(1)} dB`;
  }

  private channels(kind: ChannelKind): readonly VoicemeeterChannel[] {
    return this.state()?.channels?.filter((channel) => channel.id.startsWith(`${kind}[`)) ?? [];
  }
}
