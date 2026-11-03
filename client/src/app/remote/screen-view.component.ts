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

  private show(src: string | null): void {
    const previous = this.frame();
    this.frame.set(src);
    if (previous !== null) {
      URL.revokeObjectURL(previous);
    }
  }
}
