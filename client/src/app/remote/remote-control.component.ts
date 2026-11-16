import {
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ButtonCanvasComponent } from './button-canvas.component';
import { ButtonEditorDialogComponent } from './button-editor-dialog.component';
import { ButtonLayoutService } from './button-layout.service';
import { PROFILE_VIEWS, ProfileView } from './button-layout-profiles';
import { ClipboardSyncService } from './clipboard-sync.service';
import { MediaBridgeService } from './media-bridge.service';
import { FileTransferService } from './file-transfer.service';
import { GamepadComponent } from './gamepad/gamepad.component';
import { KeyboardPadComponent } from './keyboard-pad.component';
import { REMOTE_ICON_PATHS } from './remote-icons';
import { MAX_MACRO_STEPS } from './button-layout';
import { formatDuration } from './duration';
import { ConnectionStatus, FileOfferMessage, MacroStep } from './remote.models';
import { REMOTE_STORAGE, RemoteService } from './remote.service';
import { IS_IOS, IS_STANDALONE } from './device';
import { HOME_SCREEN_HINT_STORAGE_KEY } from './server-config';
import { SettingsDialogComponent } from './settings-dialog.component';
import { SystemStatsComponent } from './system-stats.component';
import { TouchpadComponent } from './touchpad/touchpad.component';
import { TranslationService } from './translation.service';
import { MixerComponent } from './mixer.component';
import { PresentationComponent } from './presentation.component';
import { ScreenViewComponent } from './screen-view.component';
import { RING_PLAYER } from './ring-player';

type RemoteView = ProfileView;
// "Nur Medien": Eingaben ausser Medientasten und den Bildschirm lehnt der PC ab.
const INPUT_VIEWS: ReadonlySet<RemoteView> = new Set([
  'touchpad',
  'screen',
  'keyboard',
  'presentation',
  'gamepad',
]);

// Etwas laenger als der Sekundentakt der Medienmeldung, damit die neue Position schon da ist.
const SEEK_SETTLE_MS = 1500;

@Component({
  selector: 'app-remote-control',
  imports: [
    SettingsDialogComponent,
    TouchpadComponent,
    ButtonCanvasComponent,
    ButtonEditorDialogComponent,
    KeyboardPadComponent,
    GamepadComponent,
    SystemStatsComponent,
    MixerComponent,
    PresentationComponent,
    ScreenViewComponent,
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './remote-control.component.html',
})
export class RemoteControlComponent {
  private readonly remote = inject(RemoteService);
  protected readonly i18n = inject(TranslationService);

  protected readonly layout = inject(ButtonLayoutService);

  // Ein Android-Server kann andere Aktionen als ein PC, deshalb haengt das Button-Profil an der
  // Plattform der Gegenstelle (siehe ButtonLayoutService.applyServerPlatform).
  private readonly platformEffect = effect(() =>
    this.layout.applyServerPlatform(this.remote.serverPlatform()),
  );
  protected readonly config = this.remote.config;
  protected readonly status = this.remote.status;
  protected readonly lastError = this.remote.lastError;
  private readonly fileTransfer = inject(FileTransferService);
  protected readonly fileOffer = this.remote.fileOffer;
  protected readonly ringing = this.remote.ringing;
  private readonly ringPlayer = inject(RING_PLAYER);
  private readonly ringStopped = this.ringPlayer.onStopped(() => this.remote.stopRinging());
  private readonly ringEffect = effect((onCleanup) => {
    if (!this.remote.ringing()) {
      return;
    }

    this.ringPlayer.start();
    onCleanup(() => this.ringPlayer.stop());
  });
  protected readonly pcNotification = this.remote.pcNotification;
  private readonly storage = inject(REMOTE_STORAGE);
  // Safari loescht die Kopplung nach 7 Tagen ohne Besuch, die Home-Bildschirm-App nicht. iOS fragt
  // nie von selbst nach der Installation, deshalb einmal ein Hinweis, bis er weggeklickt wird.
  protected readonly homeScreenHint = signal(
    inject(IS_IOS) &&
      !inject(IS_STANDALONE) &&
      this.storage?.getItem(HOME_SCREEN_HINT_STORAGE_KEY) !== 'dismissed',
  );
  protected readonly mediaStatus = this.remote.mediaStatus;
  protected readonly mediaCover = this.remote.mediaCover;
  protected readonly formatTime = formatDuration;
  // Waehrend des Ziehens und kurz danach zeigt die Zeitleiste die Zielstelle: die sekuendliche
  // Meldung setzte den Regler sonst mitten im Ziehen zurueck, und die neue Position kommt erst mit
  // der naechsten Meldung.
  protected readonly seekPreview = signal<number | null>(null);
  private seekSettleTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly now = signal(Date.now());
  // Tickt nur, solange am PC ein Herunterfahren geplant ist.
  private readonly shutdownTickEffect = effect((onCleanup) => {
    if (this.remote.shutdownDeadline() === null) {
      return;
    }

    this.now.set(Date.now());
    const interval = setInterval(() => this.now.set(Date.now()), 1000);
    onCleanup(() => clearInterval(interval));
  });
  protected readonly shutdownTimerKey = computed(() => {
    const power = this.remote.shutdownTimerPower();
    return power === 'shutdown' ? 'shutdownTimer.remaining' : `shutdownTimer.remaining.${power}`;
  });
  protected readonly shutdownCountdown = computed(() => {
    const deadline = this.remote.shutdownDeadline();
    const seconds = deadline === null ? 0 : Math.ceil((deadline - this.now()) / 1000);
    return seconds > 0 ? formatDuration(seconds) : null;
  });
  // Lebt, solange die Fernbedienung offen ist - sonst haette niemand die Zwischenablage im Blick.
  private readonly clipboardSync = inject(ClipboardSyncService);
  // Media-Benachrichtigung der Android-App; ausserhalb der App tut der Dienst nichts.
  private readonly mediaBridge = inject(MediaBridgeService);
  protected dismissHomeScreenHint(): void {
    this.homeScreenHint.set(false);
    this.storage?.setItem(HOME_SCREEN_HINT_STORAGE_KEY, 'dismissed');
  }

  protected readonly fileOfferTitleKey = computed(() =>
    this.remote.serverPlatform() === 'android' ? 'fileOffer.title.android' : 'fileOffer.title',
  );
  protected readonly mediaKeySuffix = computed(() =>
    this.remote.serverPlatform() === 'android' ? '.android' : '',
  );
  protected readonly fileDownloading = this.fileTransfer.downloading;
  protected readonly fileOfferError = signal(false);
  // Windows braucht dafuer den ViGEmBus-Treiber, Linux /dev/uinput; der Android-Server meldet es nie.
  protected readonly gamepadAvailable = this.remote.gamepadAvailable;
  protected readonly systemStatsSupported = this.remote.systemStatsSupported;
  protected readonly mixerSupported = this.remote.mixerSupported;
  // Bildschirmaufnahme kann nur der Windows-Server, und erst ab der Version mit GET /screen.
  protected readonly screenSupported = this.remote.screenAvailable;
  protected readonly systemTabKey = computed(() =>
    this.remote.serverPlatform() === 'android' ? 'shell.tabSystem.android' : 'shell.tabSystem',
  );
  // "Nur Medien": Touchpad, Tastatur und Controller lehnt der PC ohnehin ab.
  protected readonly mediaOnly = this.remote.mediaOnly;
  protected readonly iconPaths = REMOTE_ICON_PATHS;
  protected readonly settingsOpen = signal(false);
  /** Klein unter der Statusanzeige: Adresse, Neu verbinden, Trennen - frueher eine eigene Zeile. */
  protected readonly connectionMenuOpen = signal(false);
  protected readonly serverName = this.remote.serverName;
  protected readonly activeView = signal<RemoteView>('remote');
  /** Richtung des letzten Tabwechsels fuer die Einblendung; null bis zum ersten Wechsel, dann
   *  laufen die Remote-Tasten noch als Welle ein (nur beim Start, nicht bei jeder Rueckkehr). */
  protected readonly viewEnter = signal<'forward' | 'back' | null>(null);
  // Den Mixer gibt es nur auf PC-Servern, die Systemanzeige nur mit bekanntem Server. Fallen sie weg
  // (Android-Server, /health fehlgeschlagen) oder sperrt der PC Eingaben, verschwinden Tabs - ohne
  // Wechsel bliebe die Ansicht leer.
  private readonly hiddenViewEffect = effect(() => {
    const view = this.activeView();
    if (
      (!this.systemStatsSupported() && view === 'system') ||
      (!this.mixerSupported() && view === 'mixer') ||
      (!this.screenSupported() && view === 'screen') ||
      (this.mediaOnly() && INPUT_VIEWS.has(view))
    ) {
      untracked(() => this.showView('remote'));
    }
  });
  protected readonly editMode = signal(false);
  // Nur bei neuem Programm vorne, nicht bei jedem Profilwechsel (untracked): ein Wechsel von Hand
  // bleibt so stehen, bis ein anderes Programm nach vorne kommt. Beim Bearbeiten springt nichts.
  private readonly autoProfileEffect = effect(() => {
    const app = this.remote.foregroundApp();
    if (this.remote.autoProfile() && !this.editMode()) {
      untracked(() => this.applyProfileView(this.layout.applyForegroundApp(app)?.view));
    }
  });
  /** Tab von vor dem ersten automatischen Tabwechsel; ein Tabwechsel von Hand loescht ihn. */
  private viewBeforeAuto: RemoteView | null = null;
  protected readonly editorOpen = signal(false);
  protected readonly editorTargetId = signal<string | null>(null);
  protected readonly editorInitialSteps = signal<readonly MacroStep[]>([]);
  protected readonly recordedSteps = this.remote.recordedSteps;
  protected readonly maxMacroSteps = MAX_MACRO_STEPS;
  protected readonly resetPending = signal(false);

  protected async downloadFileOffer(offer: FileOfferMessage): Promise<void> {
    const downloaded = await this.fileTransfer.downloadFile(offer);
    this.fileOfferError.set(!downloaded);
    if (downloaded) {
      this.remote.dismissFileOffer();
    }
  }

  protected dismissPcNotification(): void {
    this.remote.dismissPcNotification();
  }

  protected removePcNotification(): void {
    this.remote.removePcNotification();
  }

  protected stopRinging(): void {
    this.remote.stopRinging();
  }

  protected dismissFileOffer(): void {
    this.fileOfferError.set(false);
    this.remote.dismissFileOffer();
  }

  protected formatFileSize(bytes: number): string {
    return bytes < 1024 * 1024
      ? `${Math.max(1, Math.round(bytes / 1024))} KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  protected cancelShutdownTimer(): void {
    this.remote.sendAction({ type: 'shutdownTimer', minutes: 0 });
  }

  protected sendMediaKey(
    key: 'MEDIA_PREVIOUS' | 'MEDIA_PLAY_PAUSE' | 'MEDIA_NEXT' | 'VOLUME_MUTE',
  ): void {
    this.remote.sendAction({ type: 'key', keys: [key] });
  }

  protected setVolume(event: Event): void {
    const volume = (event.target as HTMLInputElement).valueAsNumber;
    this.remote.sendAction({ type: 'volume', volume });
  }

  protected previewSeek(event: Event): void {
    clearTimeout(this.seekSettleTimer);
    this.seekPreview.set((event.target as HTMLInputElement).valueAsNumber);
  }

  protected seek(event: Event): void {
    const position = (event.target as HTMLInputElement).valueAsNumber;
    this.remote.sendAction({ type: 'mediaSeek', position });
    clearTimeout(this.seekSettleTimer);
    this.seekSettleTimer = setTimeout(() => this.seekPreview.set(null), SEEK_SETTLE_MS);
  }

  protected openSettings(): void {
    this.editMode.set(false);
    this.settingsOpen.set(true);
  }

  protected closeSettings(): void {
    this.settingsOpen.set(false);
  }

  protected reconnect(): void {
    this.connectionMenuOpen.set(false);
    this.remote.reconnect();
  }

  protected disconnect(): void {
    this.connectionMenuOpen.set(false);
    this.remote.disconnect();
  }

  protected toggleConnectionMenu(): void {
    this.connectionMenuOpen.update((open) => !open);
  }

  protected closeConnectionMenu(): void {
    this.connectionMenuOpen.set(false);
  }

  protected selectView(view: RemoteView): void {
    this.editMode.set(false);
    this.showView(view);
    this.viewBeforeAuto = null;
  }

  // Der neue Inhalt kommt von der Seite herein, auf der sein Tab liegt - wie beim Wischen.
  private showView(view: RemoteView): void {
    const from = PROFILE_VIEWS.indexOf(this.activeView());
    const to = PROFILE_VIEWS.indexOf(view);
    if (from !== to) {
      this.viewEnter.set(to > from ? 'forward' : 'back');
    }
    this.activeView.set(view);
  }

  // Wie beim Profil: Tab des passenden Profils, ohne einen zurueck zum Tab von vorher. Einen Tab, den
  // dieses Geraet gerade nicht hat (kein Controller-Treiber, "Nur Medien"), laesst es aus.
  private applyProfileView(view: RemoteView | undefined): void {
    if (view !== undefined && this.viewAvailable(view)) {
      if (view !== this.activeView()) {
        this.viewBeforeAuto ??= this.activeView();
        this.showView(view);
      }
      return;
    }

    if (this.viewBeforeAuto !== null) {
      this.showView(this.viewBeforeAuto);
      this.viewBeforeAuto = null;
    }
  }

  private viewAvailable(view: RemoteView): boolean {
    return !(
      (this.mediaOnly() && INPUT_VIEWS.has(view)) ||
      (view === 'gamepad' && !this.gamepadAvailable()) ||
      (view === 'system' && !this.systemStatsSupported()) ||
      (view === 'mixer' && !this.mixerSupported()) ||
      (view === 'screen' && !this.screenSupported())
    );
  }

  protected toggleEditMode(): void {
    this.editMode.update((current) => !current);
    this.resetPending.set(false);
  }

  protected toggleSnapToGrid(): void {
    this.layout.setSnapToGrid(!this.layout.snapToGrid());
  }

  protected openButtonEditor(id: string | null, initialSteps: readonly MacroStep[] = []): void {
    this.editorTargetId.set(id);
    this.editorInitialSteps.set(initialSteps);
    this.editorOpen.set(true);
  }

  // Waehrend der Aufnahme bedient man die Fernbedienung ganz normal, also ohne Bearbeitungsmodus.
  protected startRecording(): void {
    this.editMode.set(false);
    this.remote.startRecording();
  }

  protected stopRecording(): void {
    const steps = this.remote.stopRecording();
    if (steps.length > 0) {
      this.openButtonEditor(null, steps);
    }
  }

  protected discardRecording(): void {
    this.remote.stopRecording();
  }

  protected onEditButtonRequested(id: string): void {
    this.openButtonEditor(id);
  }

  protected closeButtonEditor(): void {
    this.editorOpen.set(false);
  }

  protected restoreButton(id: string): void {
    this.layout.restoreButton(id);
  }

  protected requestReset(): void {
    this.resetPending.set(true);
  }

  protected cancelReset(): void {
    this.resetPending.set(false);
  }

  protected confirmReset(): void {
    this.layout.resetLayout();
    this.resetPending.set(false);
  }

  protected statusLabel(status: ConnectionStatus): string {
    switch (status) {
      case 'connected':
        return this.i18n.t('status.connected');
      case 'connecting':
        return this.i18n.t('status.connecting');
      case 'disconnected':
        return this.i18n.t('status.disconnected');
    }
  }
}
