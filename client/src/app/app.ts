import { Component } from '@angular/core';
import { RemoteControlComponent } from './remote/remote-control.component';

@Component({
  selector: 'app-root',
  imports: [RemoteControlComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {}
