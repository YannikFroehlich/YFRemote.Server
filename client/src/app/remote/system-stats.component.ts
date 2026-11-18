import {
  Component,
  computed,
  inject,
  OnDestroy,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FileTransferService } from './file-transfer.service';
import {
  DisplayMode,
  FolderFile,
  MonitorBrightness,
  OpenWindow,
  PowerMode,
  ProcessInfo,
} from './remote.models';
import { RemoteService } from './remote.service';
import { TranslationService } from './translation.service';

interface StatsRow {
  readonly label: string;
  readonly load?: number;
  /** Ersetzt die Prozentzahl im Kopf der Kachel (Netzwerk: Rate statt Auslastung). */
  readonly value?: string;
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
  private readonly fileTransfer = inject(FileTransferService);
  protected readonly i18n = inject(TranslationService);

  protected readonly rows = computed<readonly StatsRow[] | null>(() => {
    const stats = this.remote.systemStats();
    if (!stats) {
      return null;
    }

    const gb = (mb: number) => this.i18n.number(mb / 1024, 1);
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
      ...(stats.drives ?? []).map((drive) => ({
        label: drive.name,
        load:
          drive.totalMb > 0
            ? Math.round(((drive.totalMb - drive.freeMb) / drive.totalMb) * 100)
            : undefined,
        detail: this.i18n.t('stats.drive.free', {
          free: gb(drive.freeMb),
          total: gb(drive.totalMb),
        }),
      })),
      ...(stats.netDownKbps === undefined || stats.netUpKbps === undefined
        ? []
        : [
            {
              label: this.i18n.t('stats.network'),
              value: `↓ ${this.rate(stats.netDownKbps)}`,
              detail: `↑ ${this.rate(stats.netUpKbps)}`,
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

  // Wie der Energiemodus: nur wenn der PC ihn meldet, nie fuer "Nur Medien".
  protected readonly displayMode = computed(() =>
    this.remote.mediaOnly() ? undefined : this.remote.systemStats()?.displayMode,
  );
  protected readonly displayModes: readonly DisplayMode[] = [
    'internal',
    'clone',
    'extend',
    'external',
  ];
  protected readonly micMuted = computed(() =>
    this.remote.mediaOnly() ? undefined : this.remote.systemStats()?.micMuted,
  );
  // Den Empfangsordner hat nur der PC-Server; die Android-App legt Dateien in "Downloads" ab.
  protected readonly folderSupported = computed(
    () => this.remote.serverPlatform() !== 'android' && !this.remote.mediaOnly(),
  );
  /** null = der PC liefert keine Liste (aelterer Server) - dann fehlt der Abschnitt. */
  protected readonly folder = signal<readonly FolderFile[] | null>(null);
  protected readonly folderFailed = signal<string | null>(null);

  /** null = der PC liefert keine Prozessliste (aelterer Server) - dann fehlt der Abschnitt. */
  protected readonly processes = signal<readonly ProcessInfo[] | null>(null);

  /** undefined = laedt noch, null = der PC hat nicht geantwortet. */
  protected readonly windows = signal<readonly OpenWindow[] | null | undefined>(undefined);
  // Leer, solange der PC keinen regelbaren Bildschirm meldet - dann gibt es keinen Regler.
  protected readonly brightness = signal<readonly MonitorBrightness[]>([]);

  constructor() {
    this.remote.watchSystemStats(true);
    if (this.windowsSupported()) {
      void this.refreshWindows();
      void this.remote.readBrightness().then((monitors) => this.brightness.set(monitors));
    }
    if (this.folderSupported()) {
      void this.refreshFolder();
      void this.refreshProcesses();
    }
  }

  protected async refreshProcesses(): Promise<void> {
    this.processes.set(await this.remote.readProcesses());
  }

  // Wie killWindow: sofort und ohne Rueckfrage der App, deshalb erst nach Bestaetigung.
  protected killProcess(process: ProcessInfo): void {
    if (
      globalThis.confirm(this.i18n.t('stats.windows.kill.confirm', { app: process.name })) &&
      this.remote.sendAction({ type: 'killProcess', id: String(process.id), name: process.name })
    ) {
      this.processes.update(
        (current) => current?.filter((other) => other.id !== process.id) ?? null,
      );
    }
  }

  protected selectDisplayMode(event: Event): void {
    this.remote.setDisplayMode((event.target as HTMLSelectElement).value as DisplayMode);
  }

  protected toggleMic(): void {
    this.remote.setMicMuted(!this.micMuted());
  }

  protected async refreshFolder(): Promise<void> {
    this.folder.set(await this.remote.readFolder());
  }

  protected async downloadFolderFile(file: FolderFile): Promise<void> {
    this.folderFailed.set(null);
    if (!(await this.fileTransfer.downloadFolderFile(file.name))) {
      this.folderFailed.set(file.name);
    }
  }

  protected fileSize(bytes: number): string {
    return bytes < 1024 * 1024
      ? `${Math.max(1, Math.round(bytes / 1024))} KB`
      : `${this.i18n.number(bytes / 1024 / 1024, 1)} MB`;
  }

  /** Kilobit pro Sekunde als "850 kbit/s" bzw. ab 1000 als "12,3 Mbit/s". */
  private rate(kbps: number): string {
    return kbps < 1000 ? `${kbps} kbit/s` : `${this.i18n.number(kbps / 1000, 1)} Mbit/s`;
  }

  // Bei einem Bildschirm reicht "Helligkeit"; sonst Laptop-Display und externe Monitore durchgezaehlt.
  protected brightnessLabel(monitor: MonitorBrightness): string {
    const monitors = this.brightness();
    if (monitors.length === 1) {
      return this.i18n.t('stats.brightness');
    }
    if (monitor.id === 'internal') {
      return this.i18n.t('stats.brightness.internal');
    }
    const external = monitors.filter((other) => other.id !== 'internal');
    return this.i18n.t('stats.brightness.monitor', { number: external.indexOf(monitor) + 1 });
  }

  // Waehrend des Ziehens nur die Anzeige; gesendet wird beim Loslassen, weil DDC/CI je Wert
  // einige 10 ms braucht.
  protected previewBrightness(monitor: MonitorBrightness, event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.brightness.update((current) =>
      current.map((other) => (other.id === monitor.id ? { ...other, brightness: value } : other)),
    );
  }

  protected setBrightness(monitor: MonitorBrightness, event: Event): void {
    this.previewBrightness(monitor, event);
    this.remote.sendAction({
      type: 'brightness',
      id: monitor.id,
      value: Number((event.target as HTMLInputElement).value),
    });
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

  // Fuer ein haengendes Programm: beendet den ganzen Prozess, ungespeicherte Aenderungen sind weg.
  // Deshalb erst nach Rueckfrage.
  protected killWindow(window: OpenWindow): void {
    if (
      globalThis.confirm(this.i18n.t('stats.windows.kill.confirm', { app: window.app })) &&
      this.remote.sendAction({ type: 'killWindow', id: window.id })
    ) {
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
