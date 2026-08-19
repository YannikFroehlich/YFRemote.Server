import { Component, inject, signal } from '@angular/core';
import {
  BROWSER_ACTIONS,
  D_PAD_ACTIONS,
  MEDIA_ACTIONS,
  SYSTEM_ACTIONS,
} from './remote-actions';
import { REMOTE_ICON_PATHS } from './remote-icons';
import { ConnectionStatus, RemoteButtonConfig } from './remote.models';
import { RemoteService } from './remote.service';
import { SettingsDialogComponent } from './settings-dialog.component';
import { TouchpadComponent } from './touchpad/touchpad.component';

type RemoteView = 'remote' | 'touchpad';

@Component({
  selector: 'app-remote-control',
  imports: [SettingsDialogComponent, TouchpadComponent],
  templateUrl: './remote-control.component.html',
})
export class RemoteControlComponent {
  private readonly remote = inject(RemoteService);

  protected readonly config = this.remote.config;
  protected readonly status = this.remote.status;
  protected readonly lastError = this.remote.lastError;
  protected readonly iconPaths = REMOTE_ICON_PATHS;
  protected readonly dPadActions = D_PAD_ACTIONS;
  protected readonly browserActions = BROWSER_ACTIONS;
  protected readonly systemActions = SYSTEM_ACTIONS;
  protected readonly mediaActions = MEDIA_ACTIONS;
  protected readonly settingsOpen = signal(false);
  protected readonly activeView = signal<RemoteView>('remote');

  protected sendAction(button: RemoteButtonConfig): void {
    if (button.disabled === true || button.action === undefined) {
      return;
    }

    this.remote.sendAction(button.action);
  }

  protected openSettings(): void {
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
    this.activeView.set(view);
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
