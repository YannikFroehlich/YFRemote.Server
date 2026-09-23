import { Component, effect, inject, signal } from '@angular/core';
import { ButtonCanvasComponent } from './button-canvas.component';
import { ButtonEditorDialogComponent } from './button-editor-dialog.component';
import { ButtonLayoutService } from './button-layout.service';
import { KeyboardPadComponent } from './keyboard-pad.component';
import { REMOTE_ICON_PATHS } from './remote-icons';
import { ConnectionStatus } from './remote.models';
import { RemoteService } from './remote.service';
import { SettingsDialogComponent } from './settings-dialog.component';
import { TouchpadComponent } from './touchpad/touchpad.component';
import { TranslationService } from './translation.service';

type RemoteView = 'remote' | 'touchpad' | 'keyboard';

@Component({
  selector: 'app-remote-control',
  imports: [
    SettingsDialogComponent,
    TouchpadComponent,
    ButtonCanvasComponent,
    ButtonEditorDialogComponent,
    KeyboardPadComponent,
  ],
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
  protected readonly iconPaths = REMOTE_ICON_PATHS;
  protected readonly settingsOpen = signal(false);
  protected readonly activeView = signal<RemoteView>('remote');
  protected readonly editMode = signal(false);
  protected readonly editorOpen = signal(false);
  protected readonly editorTargetId = signal<string | null>(null);
  protected readonly resetPending = signal(false);

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
