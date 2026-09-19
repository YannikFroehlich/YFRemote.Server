import { Component, inject } from '@angular/core';
import { RemoteControlComponent } from './remote/remote-control.component';
import { PairingGateComponent } from './remote/pairing-gate.component';
import { PairingService } from './remote/pairing.service';
import { ThemeService } from './remote/theme.service';

@Component({
  selector: 'app-root',
  imports: [RemoteControlComponent, PairingGateComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly pairing = inject(PairingService);
  // Früh erzeugen, damit Hell/Dunkel und Stil auch vor dem Koppeln gelten.
  private readonly theme = inject(ThemeService);
}
