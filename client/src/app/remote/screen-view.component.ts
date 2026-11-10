import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  OnDestroy,
  signal,
  viewChild,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { keyLabel, liveTextActions } from './keyboard-keys';
import { REMOTE_ICON_PATHS } from './remote-icons';
import { ScreenMonitor } from './remote.models';
import { RemoteService } from './remote.service';
import { SCREEN_QUALITIES, ScreenQuality } from './server-config';
import { distance, Point } from './screen-gestures';
import { playPcmStream, SCREEN_AUDIO_CONTEXT_FACTORY, ScreenAudioContext } from './screen-audio';
import { SCREEN_VIDEO_PLAYER } from './screen-video';
import { TranslationService } from './translation.service';
import { MAX_SCROLL_DELTA, SCROLL_SCALE } from './touchpad/touchpad.component';

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

// Ab dieser Strecke wird aus einem Tipp ein Ziehen.
const DRAG_THRESHOLD_PX = 8;
// Um so viel muss sich der Fingerabstand aendern, bis der PC eine Zoomstufe (Strg + Mausrad) bekommt.
const ZOOM_STEP = 1.15;
// Ein 120-Hz-Display soll beim Ziehen nicht an die 120 Nachrichten/s des Servers stossen.
const DRAG_MOVE_INTERVAL_MS = 16;

// Auch ein stehender Bildschirm liefert mindestens ein Bild pro Sekunde. Kommt laenger nichts,
// haengt die Verbindung und das sichtbare Bild ist alt.
const STALL_CHECK_MS = 1000;
const STALL_HINT_MS = 3000;
// Nach einem Netzwechsel warten der alte Strom und JPEG-Abrufe sonst ewig: TCP merkt das lange nicht.
const STALL_RECONNECT_MS = 10000;

// Leiste neben der Handy-Tastatur, die diese Tasten nicht hat. Strg/Alt/Win rasten bis zur
// naechsten Taste ein, auch einem getippten Buchstaben (Strg+C).
const HELD_KEYS = ['CTRL', 'ALT', 'WIN'] as const;
const EXTRA_KEYS = ['ESC', 'TAB', 'LEFT', 'UP', 'DOWN', 'RIGHT', 'DELETE'] as const;
const ARROWS: Readonly<Record<string, string>> = { LEFT: '←', UP: '↑', DOWN: '↓', RIGHT: '→' };

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
  protected readonly stalled = signal(false);
  protected readonly soundOn = signal(false);
  protected readonly soundFailed = signal(false);
  protected readonly keyboardOpen = signal(false);
  protected readonly heldKeys = HELD_KEYS;
  protected readonly extraKeys = EXTRA_KEYS;
  protected readonly held = signal<readonly string[]>([]);
  protected readonly fullscreen = signal(false);
  protected readonly menuOpen = signal(false);
  // Mitte des Logos im Vollbild, als Anteil der Ansicht: uebersteht auch das Drehen des Geraets.
  protected readonly handle = signal({ x: 0.95, y: 0.08 });
  // Vollbild bekommt das innere div, nicht der Host: nur dort greifen die :fullscreen-Regeln.
  private readonly view = viewChild.required<ElementRef<HTMLElement>>('view');
  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private readonly image = viewChild<ElementRef<HTMLImageElement>>('image');
  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');
  private readonly pointers = new Map<number, Point>();
  // Abstand der zwei Finger beim Aufsetzen, null ohne zwei Finger.
  private pinchStart: number | null = null;
  private pinchCenter: Point = { x: 0, y: 0 };
  // Die erste deutliche Bewegung entscheidet, ob zwei Finger am PC zoomen oder scrollen, und bleibt
  // dabei: Beim Scrollen aendert sich der Fingerabstand immer etwas, das soll nicht zoomen.
  private pinchMode: 'zoom' | 'scroll' | null = null;
  // Fingerabstand bei der letzten an den PC geschickten Zoomstufe.
  private zoomDistance = 0;
  // null: nichts auf der Seite zu scrollen (auch im Vollbild), dann scrollen zwei Finger am PC.
  private pinchScroller: Element | null = null;
  // Das Mausrad wirkt am PC auf das Fenster unter dem Zeiger: vor dem ersten Scrollen also dorthin,
  // wo die Finger aufsetzten. Erst dann, damit reines Zoomen den Zeiger nicht bewegt.
  private scrollTarget: { x: number; y: number } | null = null;
  private pendingScrollX = 0;
  private pendingScrollY = 0;
  private scrollFrame: number | null = null;
  // Der erste Finger, solange er noch Tipp oder Ziehen werden kann.
  private dragOrigin: Point | null = null;
  private dragging = false;
  private pendingMove: { x: number; y: number } | null = null;
  private moveFrame: number | null = null;
  private lastMoveAt = 0;
  // Nach Ziehen oder Zoomen meldet der Browser noch einen Klick, der keiner sein soll.
  private swallowClick = false;
  private handleOrigin: (Point & { pointerId: number }) | null = null;
  private handleMoved = false;
  private videoAbort: AbortController | null = null;
  // Gilt fuer alle laufenden JPEG-Abrufe; ein haengender fetch endet sonst nie.
  private jpegAbort = new AbortController();
  private sound: { context: ScreenAudioContext; abort: AbortController } | null = null;
  private typedText = '';
  private stopped = false;
  private requested = 0;
  private shown = 0;
  private lastDataAt = Date.now();
  private lastReconnectAt = 0;
  private readonly stallTimer = setInterval(() => this.checkStall(), STALL_CHECK_MS);

  constructor() {
    void this.start();
    void this.loadMonitors();
  }

  ngOnDestroy(): void {
    this.stopped = true;
    clearInterval(this.stallTimer);
    const video = this.video().nativeElement;
    video.removeAttribute('src');
    video.load();
    this.videoAbort?.abort();
    this.jpegAbort.abort();
    this.endDrag();
    if (this.scrollFrame !== null) {
      cancelAnimationFrame(this.scrollFrame);
    }
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
              this.noteData();
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

  private noteData(): void {
    this.lastDataAt = Date.now();
    this.stalled.set(false);
  }

  private checkStall(): void {
    const now = Date.now();
    // Vor dem ersten Bild und beim Sperrbildschirm steht schon ein eigener Hinweis da.
    const watching =
      !this.document.hidden && !this.blocked() && (this.videoShown() || this.frame() !== null);
    this.stalled.set(watching && now - this.lastDataAt >= STALL_HINT_MS);
    if (watching && now - Math.max(this.lastDataAt, this.lastReconnectAt) >= STALL_RECONNECT_MS) {
      this.lastReconnectAt = now;
      this.videoAbort?.abort();
      this.jpegAbort.abort();
      this.jpegAbort = new AbortController();
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
        this.jpegAbort.signal,
      );
      if (this.stopped) {
        return;
      }

      this.blocked.set(result === 'blocked');
      if (result instanceof Blob) {
        this.noteData();
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

  protected onHandleDown(event: PointerEvent): void {
    this.handleOrigin = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    this.handleMoved = false;
    try {
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    } catch {
      // Der Finger ist schon wieder weg - dann kommt auch kein weiteres Ereignis.
    }
  }

  protected onHandleMove(event: PointerEvent): void {
    const origin = this.handleOrigin;
    if (origin === null || origin.pointerId !== event.pointerId) {
      return;
    }

    const point = { x: event.clientX, y: event.clientY };
    if (!this.handleMoved && distance(origin, point) < DRAG_THRESHOLD_PX) {
      return;
    }

    this.handleMoved = true;
    const view = this.view().nativeElement.getBoundingClientRect();
    this.handle.set({
      x: Math.min(1, Math.max(0, (point.x - view.left) / view.width)),
      y: Math.min(1, Math.max(0, (point.y - view.top) / view.height)),
    });
  }

  protected onHandleEnd(): void {
    this.handleOrigin = null;
  }

  protected toggleMenu(): void {
    // Nach dem Verschieben meldet der Browser noch einen Klick, der keiner sein soll.
    if (this.handleMoved) {
      this.handleMoved = false;
      return;
    }

    this.menuOpen.update((open) => !open);
  }

  protected onPointerDown(event: PointerEvent): void {
    // Ein Tipp neben die offenen Optionen schliesst sie nur und klickt nicht am PC.
    if (this.menuOpen()) {
      this.menuOpen.set(false);
      this.swallowClick = true;
      return;
    }

    // Die rechte Maustaste laeuft ueber das Kontextmenue.
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    const stage = event.currentTarget as HTMLElement;
    try {
      stage.setPointerCapture?.(event.pointerId);
    } catch {
      // Der Finger ist schon wieder weg - dann kommt auch kein weiteres Ereignis.
    }

    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 1) {
      this.swallowClick = false;
      this.dragOrigin = { x: event.clientX, y: event.clientY };
    } else if (this.pointers.size === 2) {
      this.endDrag();
      this.dragOrigin = null;
      this.swallowClick = true;
      this.pinchStart = this.fingersDistance();
      this.zoomDistance = this.pinchStart;
      this.pinchCenter = this.fingersCenter();
      this.pinchMode = null;
      this.pinchScroller = this.fullscreen() ? null : this.findScroller();
      this.scrollTarget = this.toScreenPosition(this.pinchCenter.x, this.pinchCenter.y);
    }
  }

  protected onPointerMove(event: PointerEvent): void {
    if (!this.pointers.has(event.pointerId)) {
      return;
    }

    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pinchStart !== null) {
      if (this.pointers.size === 2) {
        const fingers = this.fingersDistance();
        const center = this.fingersCenter();
        if (this.pinchMode === null) {
          const zoomed = Math.abs(fingers - this.pinchStart);
          const moved = distance(this.pinchCenter, center);
          if (Math.max(zoomed, moved) < DRAG_THRESHOLD_PX) {
            return;
          }

          this.pinchMode = zoomed > moved ? 'zoom' : 'scroll';
        }

        if (this.pinchMode === 'zoom') {
          this.zoomPc(fingers);
        } else if (this.pinchScroller !== null) {
          // Zwei Finger scrollen die Seite, die ueber dem Bild sonst nicht mehr scrollen wuerde,
          // oder - hat sie nichts zu scrollen - den PC.
          this.pinchScroller.scrollTop += this.pinchCenter.y - center.y;
        } else {
          this.scrollPc(center.x - this.pinchCenter.x, center.y - this.pinchCenter.y);
        }
        this.pinchCenter = center;
      }
      return;
    }

    if (this.dragOrigin === null) {
      return;
    }

    if (!this.dragging) {
      const finger = { x: event.clientX, y: event.clientY };
      if (distance(this.dragOrigin, finger) < DRAG_THRESHOLD_PX) {
        return;
      }

      const start = this.toScreenPosition(this.dragOrigin.x, this.dragOrigin.y);
      if (start === null) {
        this.dragOrigin = null;
        return;
      }

      this.dragging = true;
      this.swallowClick = true;
      this.sendMove(start);
      this.remote.sendAction({ type: 'mouseDown', button: 'left' });
    }

    this.pendingMove = this.toScreenPosition(event.clientX, event.clientY, true);
    this.scheduleMove();
  }

  protected onPointerEnd(event: PointerEvent): void {
    if (!this.pointers.delete(event.pointerId)) {
      return;
    }

    if (this.pointers.size === 0) {
      this.endDrag();
      this.dragOrigin = null;
      this.pinchStart = null;
    } else if (this.pointers.size === 1) {
      // Ein Finger bleibt nach dem Zoomen liegen: er soll nicht ploetzlich ziehen.
      this.pinchStart = null;
    }
  }

  protected onClick(event: MouseEvent): void {
    event.preventDefault();
    if (this.swallowClick) {
      this.swallowClick = false;
      return;
    }

    this.sendClick(event, 'left');
  }

  // Langes Druecken klickt rechts; danach wird aus demselben Finger kein Ziehen mehr.
  protected onContextMenu(event: MouseEvent): void {
    event.preventDefault();
    if (this.dragging || this.pointers.size > 1 || this.swallowClick) {
      return;
    }

    this.dragOrigin = null;
    this.sendClick(event, 'right');
  }

  private sendClick(event: MouseEvent, button: 'left' | 'right'): void {
    const position = this.toScreenPosition(event.clientX, event.clientY);
    if (position !== null) {
      const monitor = this.remote.screenMonitor();
      this.remote.sendAction({
        type: 'screenClick',
        ...position,
        button,
        ...(monitor === null ? {} : { monitor }),
      });
    }
  }

  private sendMove(position: { x: number; y: number }): void {
    const monitor = this.remote.screenMonitor();
    this.lastMoveAt = performance.now();
    this.remote.sendAction({
      type: 'screenMove',
      ...position,
      ...(monitor === null ? {} : { monitor }),
    });
  }

  private scheduleMove(): void {
    if (this.moveFrame !== null) {
      return;
    }

    this.moveFrame = requestAnimationFrame(() => {
      this.moveFrame = null;
      if (performance.now() - this.lastMoveAt < DRAG_MOVE_INTERVAL_MS) {
        this.scheduleMove();
      } else if (this.pendingMove !== null) {
        this.sendMove(this.pendingMove);
        this.pendingMove = null;
      }
    });
  }

  private endDrag(): void {
    if (this.moveFrame !== null) {
      cancelAnimationFrame(this.moveFrame);
      this.moveFrame = null;
    }

    if (this.dragging) {
      if (this.pendingMove !== null) {
        this.sendMove(this.pendingMove);
      }

      this.remote.sendAction({ type: 'mouseUp', button: 'left' });
    }

    this.pendingMove = null;
    this.dragging = false;
  }

  private fingersDistance(): number {
    const [first, second] = this.pointers.values();
    return distance(first, second);
  }

  private fingersCenter(): Point {
    const [first, second] = this.pointers.values();
    return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
  }

  // Wie das Touchpad: der Inhalt folgt den Fingern, hoechstens eine Nachricht pro Bild.
  private scrollPc(deltaX: number, deltaY: number): void {
    this.moveToScrollTarget();

    const scale = SCROLL_SCALE * this.remote.scrollSpeed() * (this.remote.invertScroll() ? -1 : 1);
    this.pendingScrollX -= deltaX * scale;
    this.pendingScrollY += deltaY * scale;
    this.scrollFrame ??= requestAnimationFrame(() => {
      this.scrollFrame = null;
      const clamp = (value: number) =>
        Math.max(-MAX_SCROLL_DELTA, Math.min(MAX_SCROLL_DELTA, Math.round(value)));
      const x = clamp(this.pendingScrollX);
      const y = clamp(this.pendingScrollY);
      this.pendingScrollX -= x;
      this.pendingScrollY -= y;
      if (x !== 0 || y !== 0) {
        this.remote.sendAction({
          type: 'mouseScroll',
          ...(y !== 0 ? { delta: y } : {}),
          ...(x !== 0 ? { deltaX: x } : {}),
        });
      }
    });
  }

  // Wie Spreizen auf einem echten Touchpad: Strg + Mausrad, eine Stufe pro ZOOM_STEP Abstand.
  private zoomPc(fingers: number): void {
    this.moveToScrollTarget();
    while (fingers >= this.zoomDistance * ZOOM_STEP) {
      this.zoomDistance *= ZOOM_STEP;
      this.remote.sendAction({ type: 'mouseZoom', delta: 120 });
    }

    while (fingers <= this.zoomDistance / ZOOM_STEP) {
      this.zoomDistance /= ZOOM_STEP;
      this.remote.sendAction({ type: 'mouseZoom', delta: -120 });
    }
  }

  private moveToScrollTarget(): void {
    if (this.scrollTarget !== null) {
      this.sendMove(this.scrollTarget);
      this.scrollTarget = null;
    }
  }

  private findScroller(): Element | null {
    for (
      let element = this.stage().nativeElement.parentElement;
      element !== null;
      element = element.parentElement
    ) {
      const overflow = getComputedStyle(element).overflowY;
      if (
        (overflow === 'auto' || overflow === 'scroll') &&
        element.scrollHeight > element.clientHeight
      ) {
        return element;
      }
    }

    const page = this.document.scrollingElement;
    return (page?.scrollHeight ?? 0) > (page?.clientHeight ?? 0) ? page : null;
  }

  // x und y von 0 bis 1 im Bild; null neben dem Bild, ausser beim Ziehen (clampToPicture): dort
  // bleibt der Zeiger am Rand.
  private toScreenPosition(
    clientX: number,
    clientY: number,
    clampToPicture = false,
  ): { x: number; y: number } | null {
    const media = this.videoShown() ? this.video().nativeElement : this.image()?.nativeElement;
    if (media === undefined) {
      return null;
    }

    const box = media.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) {
      return null;
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
    const x = (clientX - box.left - (box.width - width) / 2) / width;
    const y = (clientY - box.top - (box.height - height) / 2) / height;
    if (!clampToPicture && scale > 0 && (x < 0 || x > 1 || y < 0 || y > 1)) {
      return null;
    }

    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    return { x: clamp(x), y: clamp(y) };
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
    this.held.set([]);
    input.value = '';
    this.typedText = '';
  }

  protected keyText(key: string): string {
    return ARROWS[key] ?? this.i18n.t(keyLabel(key));
  }

  protected toggleHeld(key: string): void {
    this.held.update((keys) =>
      keys.includes(key) ? keys.filter((held) => held !== key) : [...keys, key],
    );
  }

  protected pressKey(key: string): void {
    const held = this.held();
    this.held.set([]);
    this.remote.sendAction(
      held.length === 0 ? { type: 'key', keys: [key] } : { type: 'hotkey', keys: [...held, key] },
    );
  }

  protected onKeyboardInput(input: HTMLInputElement): void {
    // Mit eingerasteter Strg/Alt/Win wird ein Buchstabe zum Kuerzel statt zu Text.
    const typed = input.value.slice(this.typedText.length).toUpperCase();
    if (
      this.held().length > 0 &&
      input.value.startsWith(this.typedText) &&
      /^[A-Z0-9]$/.test(typed)
    ) {
      input.value = this.typedText;
      this.pressKey(typed);
      return;
    }

    for (const action of liveTextActions(this.typedText, input.value)) {
      this.remote.sendAction(action);
    }
    this.typedText = input.value;
  }

  // Bei leerem Feld loest die Ruecktaste kein input-Event aus, soll am PC aber trotzdem loeschen.
  protected onKeyboardKeydown(event: KeyboardEvent, input: HTMLInputElement): void {
    if (event.key === 'Backspace' && input.value.length === 0) {
      event.preventDefault();
      this.pressKey('BACKSPACE');
    }
  }

  protected submitKeyboard(event: Event, input: HTMLInputElement): void {
    event.preventDefault();
    this.pressKey('ENTER');
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
    this.menuOpen.set(false);
    // Im Vollbild ist die Ansicht breiter - das Video in passender Breite neu holen.
    this.videoAbort?.abort();
  }

  protected onVisibilityChange(): void {
    if (this.document.hidden) {
      this.videoAbort?.abort();
      // Im Hintergrund kommt kein pointerup mehr; die Maustaste am PC darf nicht haengen bleiben.
      this.endDrag();
      this.pointers.clear();
      this.dragOrigin = null;
      this.pinchStart = null;
    } else {
      // Die Zeit im Hintergrund zaehlt nicht: dort wird absichtlich nichts geholt.
      this.noteData();
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
