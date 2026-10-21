import { Component, computed, inject, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
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

  constructor() {
    this.remote.watchSystemStats(true);
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
