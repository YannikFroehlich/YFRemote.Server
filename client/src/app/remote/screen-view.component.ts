import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  Injector,
  OnDestroy,
  signal,
  viewChild,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { liveTextActions } from './keyboard-keys';
import { REMOTE_ICON_PATHS } from './remote-icons';
import { RemoteService } from './remote.service';
import { playPcmStream, SCREEN_AUDIO_CONTEXT_FACTORY, ScreenAudioContext } from './screen-audio';
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
  host: { '(document:fullscreenchange)': 'onFullscreenChange()' },
})
export class ScreenViewComponent implements OnDestroy {
  private readonly remote = inject(RemoteService);
  protected readonly i18n = inject(TranslationService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly createAudioContext = inject(SCREEN_AUDIO_CONTEXT_FACTORY);
  protected readonly iconPaths = REMOTE_ICON_PATHS;
  protected readonly soundSupported = this.remote.audioAvailable;
  protected readonly fullscreenSupported = this.document.fullscreenEnabled === true;
  protected readonly frame = signal<string | null>(null);
  protected readonly blocked = signal(false);
  protected readonly soundOn = signal(false);
  protected readonly soundFailed = signal(false);
  protected readonly keyboardOpen = signal(false);
  protected readonly fullscreen = signal(false);
  private readonly keyboardInput = viewChild<ElementRef<HTMLInputElement>>('keyboardInput');
  private sound: { context: ScreenAudioContext; abort: AbortController } | null = null;
  private typedText = '';
  private stopped = false;

  constructor() {
    void this.run();
  }

  ngOnDestroy(): void {
    this.stopped = true;
    this.show(null);
    this.stopSound();
    if (this.fullscreen()) {
      void this.document.exitFullscreen?.().catch(() => undefined);
    }
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
    const image = event.currentTarget as HTMLImageElement;
    const box = image.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) {
      return;
    }

    // Im Vollbild zeigt object-fit: contain das Bild mit Raendern; gemeint ist nur das Bild selbst.
    const scale =
      image.naturalWidth > 0 && image.naturalHeight > 0
        ? Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight)
        : 0;
    const width = scale > 0 ? image.naturalWidth * scale : box.width;
    const height = scale > 0 ? image.naturalHeight * scale : box.height;
    const x = (event.clientX - box.left - (box.width - width) / 2) / width;
    const y = (event.clientY - box.top - (box.height - height) / 2) / height;
    if (scale > 0 && (x < 0 || x > 1 || y < 0 || y > 1)) {
      return;
    }

    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    this.remote.sendAction({ type: 'screenClick', x: clamp(x), y: clamp(y), button });
  }

  protected toggleSound(): void {
    if (this.sound !== null) {
      this.stopSound();
      return;
    }

    // Der AudioContext muss hier im Klick entstehen, sonst laesst ihn der Browser stumm.
    const context = this.createAudioContext();
    if (context === null) {
      this.soundFailed.set(true);
      return;
    }

    void context.resume().catch(() => undefined);
    const abort = new AbortController();
    this.sound = { context, abort };
    this.soundOn.set(true);
    this.soundFailed.set(false);
    void this.playSound(context, abort);
  }

  private async playSound(context: ScreenAudioContext, abort: AbortController): Promise<void> {
    const response = await this.remote.openScreenAudio(abort.signal);
    const sampleRate = Number(response?.headers.get('X-Sample-Rate'));
    const channels = Number(response?.headers.get('X-Channels'));
    if (response?.body && sampleRate > 0 && (channels === 1 || channels === 2)) {
      try {
        await playPcmStream(response.body, context, sampleRate, channels);
      } catch {
        // Abgebrochen oder Verbindung weg - beides endet unten.
      }
    } else if (!abort.signal.aborted) {
      this.soundFailed.set(true);
    }

    // Endet der Ton von selbst (PC neu gestartet, WLAN weg), geht der Schalter wieder aus.
    if (this.sound?.abort === abort) {
      this.stopSound();
    }
  }

  private stopSound(): void {
    const sound = this.sound;
    this.sound = null;
    this.soundOn.set(false);
    sound?.abort.abort();
    void sound?.context.close().catch(() => undefined);
  }

  protected toggleKeyboard(): void {
    this.typedText = '';
    if (this.keyboardOpen()) {
      this.keyboardOpen.set(false);
      return;
    }

    this.keyboardOpen.set(true);
    // Die Handy-Tastatur geht nur mit dem Fokus auf, und den kann das Feld erst nach dem Rendern.
    afterNextRender(() => this.keyboardInput()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  protected onKeyboardInput(input: HTMLInputElement): void {
    for (const action of liveTextActions(this.typedText, input.value)) {
      this.remote.sendAction(action);
    }
    this.typedText = input.value;
  }

  // Bei leerem Feld loest die Ruecktaste kein input-Event aus, soll am PC aber trotzdem loeschen.
  protected onKeyboardKeydown(event: KeyboardEvent, input: HTMLInputElement): void {
    if (event.key === 'Backspace' && input.value.length === 0) {
      event.preventDefault();
      this.remote.sendAction({ type: 'key', keys: ['BACKSPACE'] });
    }
  }

  protected submitKeyboard(event: Event, input: HTMLInputElement): void {
    event.preventDefault();
    this.remote.sendAction({ type: 'key', keys: ['ENTER'] });
    input.value = '';
    this.typedText = '';
  }

  protected async toggleFullscreen(): Promise<void> {
    if (this.fullscreen()) {
      await this.document.exitFullscreen?.().catch(() => undefined);
      return;
    }

    try {
      await this.host.nativeElement.requestFullscreen();
      // Der PC-Bildschirm ist quer. Die Android-App dreht im Vollbild selbst; Browser ohne
      // Ausrichtungssperre (Desktop, iOS) bleiben einfach, wie sie sind.
      const orientation = this.document.defaultView?.screen.orientation as
        { lock?: (orientation: string) => Promise<void> } | undefined;
      await orientation?.lock?.('landscape');
    } catch {
      // Kein Vollbild oder keine Ausrichtungssperre moeglich.
    }
  }

  protected onFullscreenChange(): void {
    this.fullscreen.set(this.document.fullscreenElement === this.host.nativeElement);
  }

  private show(src: string | null): void {
    const previous = this.frame();
    this.frame.set(src);
    if (previous !== null) {
      URL.revokeObjectURL(previous);
    }
  }
}
