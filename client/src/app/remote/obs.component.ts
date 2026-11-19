import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy } from '@angular/core';
import { formatDuration } from './duration';
import { REMOTE_ICON_PATHS } from './remote-icons';
import { ObsInput, ObsMessage, ObsSceneItem } from './remote.models';
import { RemoteService } from './remote.service';
import { TranslationService } from './translation.service';

/** Unterer Rand des Faders; leiser regelt man in OBS selbst oder schaltet stumm. */
const MIN_FADER_DB = -60;
// Auge offen/durchgestrichen wie in der Quellenliste von OBS.
const EYE_PATH =
  'M12 5c5 0 9 4.5 10 7-1 2.5-5 7-10 7S3 14.5 2 12c1-2.5 5-7 10-7Zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z';
const EYE_OFF_PATH =
  'm3.3 2 18.7 18.7-1.4 1.4-3.3-3.3A10.8 10.8 0 0 1 12 19c-5 0-9-4.5-10-7a14 14 0 0 1 4-5L1.9 3.4 3.3 2ZM12 5c5 0 9 4.5 10 7a13.6 13.6 0 0 1-2.9 4L16 12.9A4 4 0 0 0 11.1 8L9 5.9c1-.6 2-.9 3-.9Z';

// Der Tab "OBS": Stream, Aufnahme, Wiederholungspuffer und virtuelle Kamera, Szenenwechsel, Quellen
// der aktuellen Szene und die Audioquellen. Wie der Mixer fragt der PC OBS nur, solange diese
// Ansicht offen ist.
@Component({
  selector: 'app-obs',
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './obs.component.html',
  styleUrl: './obs.component.scss',
})
export class ObsComponent implements OnDestroy {
  private readonly remote = inject(RemoteService);
  protected readonly i18n = inject(TranslationService);
  protected readonly iconPaths = REMOTE_ICON_PATHS;
  protected readonly eyePath = EYE_PATH;
  protected readonly eyeOffPath = EYE_OFF_PATH;
  protected readonly minFaderDb = MIN_FADER_DB;

  protected readonly status = this.remote.obs;
  protected readonly hintKey = computed(() => {
    const state = this.status()?.state;
    return state === undefined ? 'obs.waiting' : state === 'connected' ? null : `obs.${state}`;
  });

  constructor() {
    this.remote.watchObs(true);
  }

  ngOnDestroy(): void {
    this.remote.watchObs(false);
  }

  // Start und Stopp ausdruecklich statt Umschalten: ein doppelter Tipp oder eine veraltete Anzeige
  // schaltet so nicht versehentlich zurueck. Ein laufender Stream endet erst nach Rueckfrage.
  protected toggleStream(status: ObsMessage): void {
    if (status.streaming && !globalThis.confirm(this.i18n.t('obs.confirmStopStream'))) {
      return;
    }
    this.remote.sendAction({ type: 'obsStream', mode: status.streaming ? 'stop' : 'start' });
  }

  protected toggleRecord(status: ObsMessage): void {
    this.remote.sendAction({ type: 'obsRecord', mode: status.recording ? 'stop' : 'start' });
  }

  protected togglePause(status: ObsMessage): void {
    this.remote.sendAction({ type: 'obsRecord', mode: status.recordPaused ? 'resume' : 'pause' });
  }

  protected toggleReplay(status: ObsMessage): void {
    this.remote.sendAction({ type: 'obsReplay', mode: status.replayBuffer ? 'stop' : 'start' });
  }

  protected saveReplay(): void {
    this.remote.sendAction({ type: 'obsReplay', mode: 'save' });
  }

  protected toggleVirtualCam(status: ObsMessage): void {
    this.remote.sendAction({ type: 'obsVirtualCam', mode: status.virtualCam ? 'stop' : 'start' });
  }

  protected selectScene(name: string): void {
    this.remote.setObsScene(name);
  }

  protected toggleSource(source: ObsSceneItem): void {
    this.remote.setObsSource(source.id, !source.enabled);
  }

  protected toggleMute(name: string): void {
    this.remote.toggleObsMute(name);
  }

  // (change) statt (input) wie im Mixer: sonst setzt die sekuendliche Meldung den Fader mitten im
  // Ziehen zurueck.
  protected setVolume(input: ObsInput, event: Event): void {
    this.remote.setObsVolume(input.name, (event.target as HTMLInputElement).valueAsNumber);
  }

  protected faderValue(input: ObsInput): number {
    return Math.max(MIN_FADER_DB, input.volume);
  }

  protected formatVolume(input: ObsInput): string {
    return input.volume <= MIN_FADER_DB ? '-∞ dB' : `${this.i18n.number(input.volume, 1)} dB`;
  }

  protected formatTime(seconds: number | undefined): string {
    return seconds === undefined ? '' : ` · ${formatDuration(seconds)}`;
  }
}
