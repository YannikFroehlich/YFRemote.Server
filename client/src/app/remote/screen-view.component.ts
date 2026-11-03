import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  OnDestroy,
  signal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { RemoteService } from './remote.service';
import { TranslationService } from './translation.service';

// Hoechstens 10 Bilder pro Sekunde; das naechste holt die Ansicht erst, wenn das letzte da ist,
// so staut sich bei langsamem WLAN nichts.
const FRAME_INTERVAL_MS = 100;
const RETRY_MS = 1000;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

@Component({
  selector: 'app-screen-view',
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './screen-view.component.html',
})
export class ScreenViewComponent implements OnDestroy {
  private readonly remote = inject(RemoteService);
  protected readonly i18n = inject(TranslationService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);
  protected readonly frame = signal<string | null>(null);
  protected readonly blocked = signal(false);
  private stopped = false;

  constructor() {
    void this.run();
  }

  ngOnDestroy(): void {
    this.stopped = true;
    this.show(null);
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      const started = Date.now();
      // Im Hintergrund (App verlassen, Bildschirm aus) braucht niemand Bilder.
      if (this.document.hidden) {
        await delay(RETRY_MS);
        continue;
      }

      const pixelRatio = this.document.defaultView?.devicePixelRatio ?? 1;
      const result = await this.remote.readScreen(this.host.nativeElement.clientWidth * pixelRatio);
      if (this.stopped) {
        return;
      }

      this.blocked.set(result === 'blocked');
      if (result instanceof Blob) {
        this.show(URL.createObjectURL(result));
        await delay(Math.max(0, FRAME_INTERVAL_MS - (Date.now() - started)));
      } else {
        await delay(RETRY_MS);
      }
    }
  }

  // Tippen klickt links, langes Druecken (Kontextmenue) rechts - jeweils an der Stelle im Bild.
  protected click(event: MouseEvent, button: 'left' | 'right'): void {
    event.preventDefault();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return;
    }

    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    this.remote.sendAction({
      type: 'screenClick',
      x: clamp((event.clientX - rect.left) / rect.width),
      y: clamp((event.clientY - rect.top) / rect.height),
      button,
    });
  }

  private show(src: string | null): void {
    const previous = this.frame();
    this.frame.set(src);
    if (previous !== null) {
      URL.revokeObjectURL(previous);
    }
  }
}
