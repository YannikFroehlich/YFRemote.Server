import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy } from '@angular/core';
import { REMOTE_ICON_PATHS } from './remote-icons';
import { ObsMessage } from './remote.models';
import { RemoteService } from './remote.service';
import { TranslationService } from './translation.service';

// Der Tab "OBS": Stream und Aufnahme, Szenenwechsel und Stummschalten der Audioquellen. Wie der
// Mixer fragt der PC OBS nur, solange diese Ansicht offen ist.
@Component({
  selector: 'app-obs',
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './obs.component.html',
})
export class ObsComponent implements OnDestroy {
  private readonly remote = inject(RemoteService);
  protected readonly i18n = inject(TranslationService);
  protected readonly iconPaths = REMOTE_ICON_PATHS;

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

  protected selectScene(name: string): void {
    this.remote.setObsScene(name);
  }

  protected toggleMute(name: string): void {
    this.remote.toggleObsMute(name);
  }
}
