import {
  Component,
  computed,
  inject,
  OnDestroy,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { OpenWindow } from './remote.models';
import { RemoteService } from './remote.service';
import { TranslationService } from './translation.service';

interface StatsRow {
  readonly label: string;
  readonly load?: number;
  readonly detail: string;
}

// Der PC misst nur, solange diese Ansicht offen ist: Einschalten beim Erzeugen, Ausschalten beim
// Verlassen des Tabs.
@Component({
  selector: 'app-system-stats',
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './system-stats.component.html',
})
export class SystemStatsComponent implements OnDestroy {
  private readonly remote = inject(RemoteService);
  protected readonly i18n = inject(TranslationService);

  protected readonly rows = computed<readonly StatsRow[] | null>(() => {
    const stats = this.remote.systemStats();
    if (!stats) {
      return null;
    }

    const gb = (mb: number) => (mb / 1024).toFixed(1);
    return [
      { label: 'CPU', load: stats.cpuLoad, detail: this.temperature(stats.cpuTemperature) },
      { label: 'GPU', load: stats.gpuLoad, detail: this.temperature(stats.gpuTemperature) },
      {
        label: this.i18n.t('stats.memory'),
        load:
          stats.memoryTotalMb > 0
            ? Math.round((stats.memoryUsedMb / stats.memoryTotalMb) * 100)
            : undefined,
        detail: `${gb(stats.memoryUsedMb)} / ${gb(stats.memoryTotalMb)} GB`,
      },
    ];
  });

  // Fensterwechsel gibt es nur unter Windows; Wayland hat keinen desktopuebergreifenden Weg.
  protected readonly windowsSupported = computed(() => this.remote.serverPlatform() === 'windows');
  /** undefined = laedt noch, null = der PC hat nicht geantwortet. */
  protected readonly windows = signal<readonly OpenWindow[] | null | undefined>(undefined);

  constructor() {
    this.remote.watchSystemStats(true);
    if (this.windowsSupported()) {
      void this.refreshWindows();
    }
  }

  protected async refreshWindows(): Promise<void> {
    this.windows.set(await this.remote.readWindows());
  }

  // Das gewaehlte Fenster rueckt sofort nach oben, wie es Alt+Tab danach auch zeigt.
  protected focusWindow(window: OpenWindow): void {
    if (!this.remote.sendAction({ type: 'focusWindow', id: window.id })) {
      return;
    }
    this.windows.update((current) =>
      current ? [window, ...current.filter((other) => other.id !== window.id)] : current,
    );
  }

  ngOnDestroy(): void {
    this.remote.watchSystemStats(false);
  }

  // Unter Windows liefert erst ein laufendes LibreHardwareMonitor die CPU-Temperatur - der Hinweis
  // sagt, wie man sie bekommt.
  private temperature(celsius: number | undefined): string {
    if (celsius !== undefined) {
      return `${celsius} °C`;
    }
    return this.i18n.t(
      this.remote.serverPlatform() === 'windows'
        ? 'stats.noTemperature.windows'
        : 'stats.noTemperature',
    );
  }
}
