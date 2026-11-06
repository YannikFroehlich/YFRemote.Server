import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  OnDestroy,
  signal,
  viewChild,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { liveTextActions } from './keyboard-keys';
import { REMOTE_ICON_PATHS } from './remote-icons';
import { ScreenMonitor } from './remote.models';
import { RemoteService } from './remote.service';
import { SCREEN_QUALITIES, ScreenQuality } from './server-config';
import { playPcmStream, SCREEN_AUDIO_CONTEXT_FACTORY, ScreenAudioContext } from './screen-audio';
import { SCREEN_VIDEO_PLAYER } from './screen-video';
import { TranslationService } from './translation.service';

// Nur fuer den JPEG-Rueckweg (Server ohne Hardware-Encoder, Browser ohne MediaSource):
// zwei Abrufe gleichzeitig, jeder hoechstens alle 33 ms: waehrend ein Bild uebers WLAN kommt,
// nimmt der PC schon das naechste auf. Jeder Abruf wartet aufs letzte, so staut sich bei
// langsamem WLAN nichts; ein stehendes Bild haelt der Server ohnehin bis zu 100 ms zurueck.
const PARALLEL_REQUESTS = 2;
const FRAME_INTERVAL_MS = 33;
const RETRY_MS = 1000;
// Pixeldichte (hoechstens so viel wie das Geraet hat), JPEG-Qualitaet und Video-Bitrate je
// Einstellung; mehr als 1,5-fach sieht man auf dem Handy kaum, es kostet aber WLAN.
const SCREEN_PROFILES: Readonly<
  Record<ScreenQuality, { pixelRatio: number; jpegQuality: number; videoKbps: number }>
> = {
  performance: { pixelRatio: 1, jpegQuality: 50, videoKbps: 4000 },
  balanced: { pixelRatio: 1.5, jpegQuality: 70, videoKbps: 8000 },
  quality: { pixelRatio: 3, jpegQuality: 85, videoKbps: 16000 },
};
// Breiter als 1080p dekodieren manche Handys H.264 nicht mehr fluessig (Level 4.2).
const MAX_VIDEO_WIDTH = 1920;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

@Component({
  selector: 'app-screen-view',
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './screen-view.component.html',
  host: {
    '(document:fullscreenchange)': 'onFullscreenChange()',
    '(document:visibilitychange)': 'onVisibilityChange()',
  },
})
export class ScreenViewComponent implements OnDestroy {
  private readonly remote = inject(RemoteService);
  protected readonly i18n = inject(TranslationService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);
  private readonly createAudioContext = inject(SCREEN_AUDIO_CONTEXT_FACTORY);
  private readonly videoPlayer = inject(SCREEN_VIDEO_PLAYER);
  protected readonly iconPaths = REMOTE_ICON_PATHS;
  protected readonly soundSupported = this.remote.audioAvailable;
  protected readonly qualities = SCREEN_QUALITIES;
  protected readonly quality = this.remote.screenQuality;
  protected readonly fullscreenSupported = this.document.fullscreenEnabled === true;
  protected readonly monitors = signal<readonly ScreenMonitor[]>([]);
  protected readonly frame = signal<string | null>(null);
  protected readonly videoShown = signal(false);
  protected readonly blocked = signal(false);
  protected readonly soundOn = signal(false);
  protected readonly soundFailed = signal(false);
  protected readonly keyboardOpen = signal(false);
  protected readonly fullscreen = signal(false);
  // Vollbild bekommt das innere div, nicht der Host: nur dort greifen die :fullscreen-Regeln.
  private readonly view = viewChild.required<ElementRef<HTMLElement>>('view');
  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private videoAbort: AbortController | null = null;
  private sound: { context: ScreenAudioContext; abort: AbortController } | null = null;
  private typedText = '';
  private stopped = false;
  private requested = 0;
  private shown = 0;

  constructor() {
    void this.start();
    void this.loadMonitors();
  }

  ngOnDestroy(): void {
    this.stopped = true;
    this.videoAbort?.abort();
    this.show(null);
    this.stopSound();
    if (this.fullscreen()) {
      void this.document.exitFullscreen?.().catch(() => undefined);
    }
  }

  private async loadMonitors(): Promise<void> {
    const monitors = await this.remote.readScreenMonitors();
    if (monitors !== null && !this.stopped) {
      this.monitors.set(monitors);
    }
  }

  // Die gemerkte Kennung, wenn es den Monitor noch gibt, sonst wie am PC der Hauptbildschirm.
  protected isSelectedMonitor(monitor: ScreenMonitor): boolean {
    const selected = this.remote.screenMonitor();
    return this.monitors().some((candidate) => candidate.id === selected)
      ? monitor.id === selected
      : monitor.primary;
  }

  protected selectMonitor(event: Event): void {
    this.remote.saveScreenMonitor((event.target as HTMLSelectElement).value);
    this.videoAbort?.abort();
  }

  private async start(): Promise<void> {
    if (this.videoPlayer !== null && (await this.runVideo())) {
      return;
    }

    for (let index = 0; index < PARALLEL_REQUESTS; index++) {
      void this.run();
    }
  }

  // H.264 vom Hardware-Encoder des PCs: hohe Bildrate bei wenig WLAN und Prozessorlast. false,
  // wenn der Server gleich beim ersten Versuch kein Video liefert - dann JPEG.
  private async runVideo(): Promise<boolean> {
    let played = false;
    while (!this.stopped) {
      if (this.document.hidden) {
        await delay(RETRY_MS);
        continue;
      }

      // Direkt nach dem Erzeugen ist die Ansicht noch nicht eingehaengt und 0 Pixel breit.
      if (this.host.nativeElement.clientWidth === 0) {
        await delay(50);
        continue;
      }

      const abort = new AbortController();
      this.videoAbort = abort;
      const profile = SCREEN_PROFILES[this.quality()];
      const pixelRatio = Math.min(
        profile.pixelRatio,
        this.document.defaultView?.devicePixelRatio ?? 1,
      );
      const width = Math.min(MAX_VIDEO_WIDTH, this.host.nativeElement.clientWidth * pixelRatio);
      const stream = await this.remote.openScreenVideo(
        width,
        profile.videoKbps,
        abort.signal,
        this.remote.screenMonitor(),
      );
      if (this.stopped) {
        return true;
      }

      this.blocked.set(stream === 'blocked');
      if (stream === 'blocked') {
        this.videoShown.set(false);
      }

      if (stream === null && !played && !abort.signal.aborted) {
        return false;
      }

      if (stream !== null && stream !== 'blocked') {
        try {
          await this.videoPlayer!.play(
            stream.body,
            this.video().nativeElement,
            stream.codec,
            abort.signal,
            () => {
              played = true;
              this.videoShown.set(true);
            },
          );
        } catch {
          // Strom abgerissen oder Format abgelehnt - unten entscheiden.
        }

        if (!played) {
          return false;
        }
      }

      // Abgebrochen (Qualitaet, Vollbild, Hintergrund): gleich neu, sonst kurz warten.
      if (!abort.signal.aborted) {
        await delay(RETRY_MS);
      }
    }

    return true;
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      const started = Date.now();
      // Im Hintergrund (App verlassen, Bildschirm aus) braucht niemand Bilder.
      if (this.document.hidden) {
        await delay(RETRY_MS);
        continue;
      }

      const profile = SCREEN_PROFILES[this.quality()];
      const pixelRatio = Math.min(
        profile.pixelRatio,
        this.document.defaultView?.devicePixelRatio ?? 1,
      );
      const sequence = ++this.requested;
      const result = await this.remote.readScreen(
        this.host.nativeElement.clientWidth * pixelRatio,
        profile.jpegQuality,
        this.remote.screenMonitor(),
      );
      if (this.stopped) {
        return;
      }

      this.blocked.set(result === 'blocked');
      if (result instanceof Blob) {
        // Ueberholt ein spaeter gestarteter Abruf diesen, waere sein Bild schon wieder alt.
        if (sequence > this.shown) {
          this.shown = sequence;
          this.show(URL.createObjectURL(result));
        }
        await delay(Math.max(0, FRAME_INTERVAL_MS - (Date.now() - started)));
      } else {
        await delay(RETRY_MS);
      }
    }
  }

  // Tippen klickt links, langes Druecken (Kontextmenue) rechts - jeweils an der Stelle im Bild.
  protected click(event: MouseEvent, button: 'left' | 'right'): void {
    event.preventDefault();
    const media = event.currentTarget as HTMLImageElement | HTMLVideoElement;
    const box = media.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) {
      return;
    }

    // Im Vollbild zeigt object-fit: contain das Bild mit Raendern; gemeint ist nur das Bild selbst.
    const [naturalWidth, naturalHeight] =
      media instanceof HTMLVideoElement
        ? [media.videoWidth, media.videoHeight]
        : [media.naturalWidth, media.naturalHeight];
    const scale =
      naturalWidth > 0 && naturalHeight > 0
        ? Math.min(box.width / naturalWidth, box.height / naturalHeight)
        : 0;
    const width = scale > 0 ? naturalWidth * scale : box.width;
    const height = scale > 0 ? naturalHeight * scale : box.height;
    const x = (event.clientX - box.left - (box.width - width) / 2) / width;
    const y = (event.clientY - box.top - (box.height - height) / 2) / height;
    if (scale > 0 && (x < 0 || x > 1 || y < 0 || y > 1)) {
      return;
    }

    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    const monitor = this.remote.screenMonitor();
    this.remote.sendAction({
      type: 'screenClick',
      x: clamp(x),
      y: clamp(y),
      button,
      ...(monitor === null ? {} : { monitor }),
    });
  }

  protected selectQuality(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const quality = this.qualities.find((candidate) => candidate === value);
    if (quality !== undefined) {
      this.remote.saveScreenQuality(quality);
      // Den Strom mit neuer Breite und Bitrate aufbauen.
      this.videoAbort?.abort();
    }
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

  // Fokus direkt im Klick, sonst oeffnet Android die Tastatur nicht. mousedown am Schalter ist
  // abgefangen, damit der Klick das Feld nicht erst entfokussiert und gleich wieder oeffnet.
  protected toggleKeyboard(input: HTMLInputElement): void {
    if (this.keyboardOpen()) {
      input.blur();
    } else {
      input.focus();
    }
  }

  // Tastatur zu (Zurueck-Taste, Tipp daneben): Schalter aus, beim naechsten Mal leeres Feld.
  protected closeKeyboard(input: HTMLInputElement): void {
    this.keyboardOpen.set(false);
    input.value = '';
    this.typedText = '';
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
      await this.view().nativeElement.requestFullscreen();
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
    this.fullscreen.set(this.document.fullscreenElement === this.view().nativeElement);
    // Im Vollbild ist die Ansicht breiter - das Video in passender Breite neu holen.
    this.videoAbort?.abort();
  }

  protected onVisibilityChange(): void {
    if (this.document.hidden) {
      this.videoAbort?.abort();
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
