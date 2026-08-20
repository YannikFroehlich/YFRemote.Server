import { Component, inject, signal } from '@angular/core';
import { ButtonCanvasComponent } from './button-canvas.component';
import { ButtonEditorDialogComponent } from './button-editor-dialog.component';
import { ButtonLayoutService } from './button-layout.service';
import { REMOTE_ICON_PATHS } from './remote-icons';
import { ConnectionStatus } from './remote.models';
import { RemoteService } from './remote.service';
import { SettingsDialogComponent } from './settings-dialog.component';
import { TouchpadComponent } from './touchpad/touchpad.component';

type RemoteView = 'remote' | 'touchpad';

@Component({
  selector: 'app-remote-control',
  imports: [
    SettingsDialogComponent,
    TouchpadComponent,
    ButtonCanvasComponent,
    ButtonEditorDialogComponent,
  ],
  templateUrl: './remote-control.component.html',
})
export class RemoteControlComponent {
  private readonly remote = inject(RemoteService);

  protected readonly layout = inject(ButtonLayoutService);
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
        return 'Verbunden';
      case 'connecting':
        return 'Verbinde';
      case 'disconnected':
        return 'Getrennt';
    }
  }
}
