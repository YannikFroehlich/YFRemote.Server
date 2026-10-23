import {
  Component,
  computed,
  effect,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ButtonCanvasComponent } from './button-canvas.component';
import { ButtonEditorDialogComponent } from './button-editor-dialog.component';
import { ButtonLayoutService } from './button-layout.service';
import { ClipboardSyncService } from './clipboard-sync.service';
import { FileTransferService } from './file-transfer.service';
import { GamepadComponent } from './gamepad/gamepad.component';
import { KeyboardPadComponent } from './keyboard-pad.component';
import { REMOTE_ICON_PATHS } from './remote-icons';
import { ConnectionStatus, FileOfferMessage } from './remote.models';
import { RemoteService } from './remote.service';
import { SettingsDialogComponent } from './settings-dialog.component';
import { SystemStatsComponent } from './system-stats.component';
import { TouchpadComponent } from './touchpad/touchpad.component';
import { TranslationService } from './translation.service';
import { VoicemeeterComponent } from './voicemeeter.component';

type RemoteView = 'remote' | 'touchpad' | 'keyboard' | 'gamepad' | 'system' | 'mixer';

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
    VoicemeeterComponent,
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
  protected readonly mediaStatus = this.remote.mediaStatus;
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
  protected readonly shutdownCountdown = computed(() => {
    const deadline = this.remote.shutdownDeadline();
    const seconds = deadline === null ? 0 : Math.ceil((deadline - this.now()) / 1000);
    return seconds > 0 ? formatCountdown(seconds) : null;
  });
  // Lebt, solange die Fernbedienung offen ist - sonst haette niemand die Zwischenablage im Blick.
  private readonly clipboardSync = inject(ClipboardSyncService);
  protected readonly fileOfferTitleKey = computed(() =>
    this.remote.serverPlatform() === 'android' ? 'fileOffer.title.android' : 'fileOffer.title',
  );
  protected readonly fileDownloading = this.fileTransfer.downloading;
  protected readonly fileOfferError = signal(false);
  // Windows braucht dafuer den ViGEmBus-Treiber, Linux /dev/uinput; der Android-Server meldet es nie.
  protected readonly gamepadAvailable = this.remote.gamepadAvailable;
  protected readonly systemStatsSupported = this.remote.systemStatsSupported;
  protected readonly voicemeeterAvailable = this.remote.voicemeeterAvailable;
  protected readonly iconPaths = REMOTE_ICON_PATHS;
  protected readonly settingsOpen = signal(false);
  protected readonly activeView = signal<RemoteView>('remote');
  // Faellt die Systemanzeige oder Voicemeeter weg (Android-Server, /health fehlgeschlagen),
  // verschwindet ihr Tab - ohne Wechsel bliebe die Ansicht leer und kein Tab ausgewaehlt.
  private readonly systemViewEffect = effect(() => {
    if (
      (!this.systemStatsSupported() && this.activeView() === 'system') ||
      (!this.voicemeeterAvailable() && this.activeView() === 'mixer')
    ) {
      this.activeView.set('remote');
    }
  });
  protected readonly editMode = signal(false);
  protected readonly editorOpen = signal(false);
  protected readonly editorTargetId = signal<string | null>(null);
  protected readonly resetPending = signal(false);

  protected async downloadFileOffer(offer: FileOfferMessage): Promise<void> {
    const downloaded = await this.fileTransfer.downloadFile(offer);
    this.fileOfferError.set(!downloaded);
    if (downloaded) {
      this.remote.dismissFileOffer();
    }
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

  protected setVolume(event: Event): void {
    const volume = (event.target as HTMLInputElement).valueAsNumber;
    this.remote.sendAction({ type: 'volume', volume });
  }

  protected openSettings(): void {
    this.editMode.set(false);
    this.settingsOpen.set(true);
  }

  protected closeSettings(): void {
    this.settingsOpen.set(false);
  }

  protected reconnect(): void {
    this.remote.reconnect();
  }

  protected disconnect(): void {
    this.remote.disconnect();
  }

  protected selectView(view: RemoteView): void {
    this.editMode.set(false);
    this.activeView.set(view);
  }

  protected toggleEditMode(): void {
    this.editMode.update((current) => !current);
    this.resetPending.set(false);
  }

  protected toggleSnapToGrid(): void {
    this.layout.setSnapToGrid(!this.layout.snapToGrid());
  }

  protected openButtonEditor(id: string | null): void {
    this.editorTargetId.set(id);
    this.editorOpen.set(true);
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

function formatCountdown(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}
