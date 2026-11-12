import {
  Component,
  computed,
  inject,
  OnDestroy,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { OpenWindow, PowerMode } from './remote.models';
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
    // Die Android-App darf CPU und GPU nicht messen - die Zeilen blieben immer leer.
    const android = this.remote.serverPlatform() === 'android';
    return [
      ...(android
        ? []
        : [
            { label: 'CPU', load: stats.cpuLoad, detail: this.temperature(stats.cpuTemperature) },
            { label: 'GPU', load: stats.gpuLoad, detail: this.temperature(stats.gpuTemperature) },
          ]),
      {
        label: this.i18n.t('stats.memory'),
        load:
          stats.memoryTotalMb > 0
            ? Math.round((stats.memoryUsedMb / stats.memoryTotalMb) * 100)
            : undefined,
        detail: `${gb(stats.memoryUsedMb)} / ${gb(stats.memoryTotalMb)} GB`,
      },
      ...(stats.batteryLevel === undefined
        ? []
        : [
            {
              label: this.i18n.t('stats.battery'),
              load: stats.batteryLevel,
              detail: [
                this.i18n.t(
                  stats.batteryCharging ? 'stats.battery.charging' : 'stats.battery.discharging',
                ),
                ...(stats.batteryTemperature === undefined
                  ? []
                  : [`${stats.batteryTemperature} °C`]),
              ].join(' · '),
            },
          ]),
    ];
  });
  protected readonly waitingKey = computed(() =>
    this.remote.serverPlatform() === 'android' ? 'stats.waiting.android' : 'stats.waiting',
  );

  // Fensterwechsel gibt es nur unter Windows; Wayland hat keinen desktopuebergreifenden Weg.
  // Bei "Nur Medien" lehnt der PC ihn ab.
  protected readonly windowsSupported = computed(
    () => this.remote.serverPlatform() === 'windows' && !this.remote.mediaOnly(),
  );
  // Nur wenn der PC einen umschaltbaren Energiemodus meldet; "Nur Medien" darf ihn nicht stellen.
  protected readonly powerMode = computed(() =>
    this.remote.mediaOnly() ? undefined : this.remote.systemStats()?.powerMode,
  );
  protected readonly powerModes: readonly PowerMode[] = ['efficiency', 'balanced', 'performance'];

  /** undefined = laedt noch, null = der PC hat nicht geantwortet. */
  protected readonly windows = signal<readonly OpenWindow[] | null | undefined>(undefined);

  constructor() {
    this.remote.watchSystemStats(true);
    if (this.windowsSupported()) {
      void this.refreshWindows();
    }
  }

  protected selectPowerMode(event: Event): void {
    this.remote.setPowerMode((event.target as HTMLSelectElement).value as PowerMode);
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

  protected minimizeWindow(window: OpenWindow): void {
    this.remote.sendAction({ type: 'minimizeWindow', id: window.id });
  }

  // Wie das X am Fenster: fragt die App noch nach ungespeicherten Aenderungen, bleibt es offen und
  // steht nach "Aktualisieren" wieder da.
  protected closeWindow(window: OpenWindow): void {
    if (this.remote.sendAction({ type: 'closeWindow', id: window.id })) {
      this.windows.update((current) => current?.filter((other) => other.id !== window.id));
    }
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
