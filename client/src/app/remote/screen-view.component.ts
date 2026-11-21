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
import { ClipboardSyncService } from './clipboard-sync.service';
import { ClipboardService } from './clipboard.service';
import { keepScreenAwake } from './device';
import { FILE_SAVER, FileTransferService } from './file-transfer.service';
import { keyLabel, liveTextActions, physicalKeyAction } from './keyboard-keys';
import { REMOTE_ICON_PATHS } from './remote-icons';
import { KeyboardAction, RemoteAction, ScreenMonitor } from './remote.models';
import { RemoteService } from './remote.service';
import { SCREEN_QUALITIES, ScreenQuality } from './server-config';
import { distance, Point } from './screen-gestures';
import {
  playPcmStream,
  SCREEN_AUDIO_CONTEXT_FACTORY,
  ScreenAudioContext,
  usePlaybackAudioSession,
} from './screen-audio';
import { SCREEN_VIDEO_PLAYER } from './screen-video';
import { TranslationService } from './translation.service';
import { MAX_SCROLL_DELTA, SCROLL_SCALE } from './touchpad/touchpad.component';

// Die Obergrenzen von GET /screen: so breit und so gut, wie der PC ein Standbild liefert.
const SCREENSHOT_WIDTH = 3840;
const SCREENSHOT_QUALITY = 95;

// Nur fuer den JPEG-Rueckweg (Server ohne Hardware-Encoder, Browser ohne MediaSource):
// zwei Abrufe gleichzeitig, jeder hoechstens alle 33 ms: waehrend ein Bild uebers WLAN kommt,
// nimmt der PC schon das naechste auf. Jeder Abruf wartet aufs letzte, so staut sich bei
// langsamem WLAN nichts; ein stehendes Bild haelt der Server ohnehin bis zu 100 ms zurueck.
const PARALLEL_REQUESTS = 2;
const FRAME_INTERVAL_MS = 33;
const RETRY_MS = 1000;
// Bildpixel je Pixel der Ansicht, JPEG-Qualitaet und Video-Bitrate je Einstellung. Bewusst nicht
// auf die Pixeldichte des Geraets begrenzt: H.264 und JPEG speichern Farbe nur in halber
// Aufloesung, erst mit mehr Pixeln als die Ansicht bleibt farbige Schrift scharf. Mit der Grenze
// lieferten alle drei Einstellungen am Desktop (Pixeldichte 1) dasselbe unscharfe Bild.
const SCREEN_PROFILES: Readonly<
  Record<ScreenQuality, { pixelRatio: number; jpegQuality: number; videoKbps: number }>
> = {
  performance: { pixelRatio: 1, jpegQuality: 50, videoKbps: 4000 },
  balanced: { pixelRatio: 1.5, jpegQuality: 70, videoKbps: 8000 },
  quality: { pixelRatio: 3, jpegQuality: 85, videoKbps: 16000 },
};
// Breiter als 1080p dekodieren manche Handys H.264 nicht mehr fluessig (Level 4.2). Ein Rechner
// mit Maus schafft die volle Breite des PCs, die der Server ohnehin auf dessen Monitor begrenzt.
// ponytail: Maus = Desktop; ein Handy mit Maus bekaeme auch die volle Breite.
const MAX_PHONE_VIDEO_WIDTH = 1920;
const MAX_DESKTOP_VIDEO_WIDTH = 3840;

// Ab dieser Strecke wird aus einem Tipp ein Ziehen.
const DRAG_THRESHOLD_PX = 8;
// Um so viel muss sich der Fingerabstand aendern, bis der PC eine Zoomstufe (Strg + Mausrad) bekommt.
const ZOOM_STEP = 1.15;
// Ein 120-Hz-Display soll beim Ziehen nicht an die 120 Nachrichten/s des Servers stossen.
const DRAG_MOVE_INTERVAL_MS = 16;
// So viele Finger nimmt InjectTouchInput am PC (WindowsTouchService.MaxContacts).
const MAX_TOUCH_POINTS = 10;
// PointerEvent.buttons eines Stifts, der das Display beruehrt: Spitze (1) oder Radierer (32).
const PEN_CONTACT = 1 | 32;
// PointerEvent.buttons einer Maus am Geraet -> Taste am PC.
const MOUSE_BUTTONS = [
  [1, 'left'],
  [2, 'right'],
  [4, 'middle'],
] as const;
// Mausrad am Geraet -> Raddelta am PC (120 je Raste) je deltaMode: Pixel (Chrome: 100 je Raste),
// Zeilen (Firefox: 3 je Raste), Seiten.
const WHEEL_UNITS = [1.2, 40, 400];

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

// So lange bleibt ein Hinweis zu Dateien oder Zwischenablage stehen.
const STATUS_MS = 5000;
// Strg+Umschalt+V fuegt in vielen Programmen ohne Formatierung ein.
const PASTE_SHORTCUTS = ['CTRL+V', 'CTRL+SHIFT+V'];

function isPasteShortcut(action: RemoteAction): action is KeyboardAction {
  return action.type === 'hotkey' && PASTE_SHORTCUTS.includes(action.keys.join('+'));
}

// ponytail: Chrome nennt ein eingefuegtes Bild (Bildschirmfoto, "Bild kopieren") "image.png";
// eine kopierte Datei gleichen Namens geht deshalb als Bild statt als Datei an den PC.
function isPastedBitmap(files: readonly File[]): boolean {
  return files.length === 1 && files[0].type === 'image/png' && files[0].name === 'image.png';
}

@Component({
  selector: 'app-screen-view',
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './screen-view.component.html',
  host: {
    '(document:fullscreenchange)': 'onFullscreenChange()',
    '(document:visibilitychange)': 'onVisibilityChange()',
    '(document:paste)': 'onPaste($event)',
  },
})
export class ScreenViewComponent implements OnDestroy {
  private readonly remote = inject(RemoteService);
  protected readonly screenCursor = this.remote.screenCursor;
  private readonly saveFile = inject(FILE_SAVER);
  protected readonly i18n = inject(TranslationService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);
  private readonly createAudioContext = inject(SCREEN_AUDIO_CONTEXT_FACTORY);
  private readonly videoPlayer = inject(SCREEN_VIDEO_PLAYER);
  private readonly clipboardSync = inject(ClipboardSyncService);
  private readonly clipboard = inject(ClipboardService);
  private readonly fileTransfer = inject(FileTransferService);
  protected readonly iconPaths = REMOTE_ICON_PATHS;
  protected readonly clipboardSyncSupported = this.remote.clipboardSyncSupported;
  protected readonly clipboardSyncOn = computed(
    () => this.remote.clipboardSync() && this.clipboardSync.available(),
  );
  protected readonly uploadProgress = this.fileTransfer.uploadProgress;
  protected readonly dropping = signal(false);
  protected readonly status = signal<string | null>(null);
  private statusTimer: ReturnType<typeof setTimeout> | null = null;
  // Strg+V, bis das paste-Ereignis des Browsers zeigt, was am Geraet kopiert ist.
  private pendingPaste: KeyboardAction | null = null;
  // Solange Strg+V erst abgleicht, warten spaetere Tasten dahinter; sonst gehen sie sofort raus.
  private keysBehind: Promise<void> | null = null;
  private fileQueue: Promise<unknown> = Promise.resolve();

  // Ein eigenes Standbild in voller Breite und hoher Qualitaet, unabhaengig vom laufenden Strom.
  protected async saveScreenshot(): Promise<void> {
    const image = await this.remote.readScreen(
      SCREENSHOT_WIDTH,
      SCREENSHOT_QUALITY,
      this.remote.screenMonitor(),
    );
    if (image instanceof Blob) {
      const stamp = new Date().toISOString().slice(0, 19).replace('T', '_').replaceAll(':', '-');
      await this.saveFile(image, `YFRemote_${stamp}.jpg`);
    }
  }
  protected readonly soundSupported = this.remote.audioAvailable;
  protected readonly qualities = SCREEN_QUALITIES;
  protected readonly quality = this.remote.screenQuality;
  // Auf dem iPhone gibt es kein Element-Vollbild; dort fuellt die Ansicht per CSS den sichtbaren
  // Bereich (.screen-view--fullscreen), und fullscreen() steht fuer beides.
  protected readonly fullscreenSupported = this.document.fullscreenEnabled === true;
  private readonly maxVideoWidth =
    this.document.defaultView?.matchMedia?.('(pointer: fine)').matches === true
      ? MAX_DESKTOP_VIDEO_WIDTH
      : MAX_PHONE_VIDEO_WIDTH;
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
  private readonly optionalView = viewChild<ElementRef<HTMLElement>>('view');
  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private readonly image = viewChild<ElementRef<HTMLImageElement>>('image');
  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');
  private readonly pointers = new Map<number, Point>();
  protected readonly touchSupported = this.remote.touchAvailable;
  protected readonly touchMode = computed(() => this.remote.touchAvailable() && this.remote.screenTouch());
  // pointerId -> Id des Fingers am PC, nur mit "Touch".
  private readonly touchSlots = new Map<number, number>();
  private touchFrame: number | null = null;
  private lastTouchAt = 0;
  // Der Stift mit "Touch": true, solange er am PC in Reichweite ist.
  private penInRange = false;
  private pendingPen: PointerEvent | null = null;
  private penFrame: number | null = null;
  private lastPenAt = 0;
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
  private pendingZoom = 0;
  private scrollFrame: number | null = null;
  // Eine Maus am Geraet klickt ueber mouseDown/mouseUp; click und contextmenu des Browsers
  // gehen dann nicht noch einmal an den PC.
  private lastPointerType = '';
  // Die am PC gedrueckten Tasten der Maus am Geraet, als Bits wie PointerEvent.buttons.
  private mouseButtons = 0;
  // Win allein oeffnet am PC das Startmenue, als Teil eines Kuerzels nicht.
  private winAlone = false;
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
    keepScreenAwake();
    void this.start();
    void this.loadMonitors();
  }

  ngOnDestroy(): void {
    this.stopped = true;
    clearInterval(this.stallTimer);
    if (this.statusTimer !== null) {
      clearTimeout(this.statusTimer);
    }
    const video = this.video().nativeElement;
    video.removeAttribute('src');
    video.load();
    this.videoAbort?.abort();
    this.jpegAbort.abort();
    this.endDrag();
    this.releaseMouse();
    this.remote.watchScreenCursor(false);
    this.liftAllTouches();
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
  // wenn der Server kein Video liefert - dann JPEG. Das gilt auch nach schon gespieltem Video
  // (Server aktualisiert, anderer oder gedrehter Monitor), sonst bliebe das letzte Bild stehen.
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
      const width = Math.min(this.maxVideoWidth, this.viewWidth() * profile.pixelRatio);
      // Die Bitraten gelten fuer bis zu 1080p; mehr Pixel brauchen beim Scrollen mehr Bitrate. Bei
      // 4K sind das 64 Mbit/s, die Obergrenze des Servers (ScreenEndpoints.MaxBitrateKbps).
      const kbps = Math.round(profile.videoKbps * Math.max(1, (width / MAX_PHONE_VIDEO_WIDTH) ** 2));
      const stream = await this.remote.openScreenVideo(
        width,
        kbps,
        abort.signal,
        this.remote.screenMonitor(),
      );
      if (this.stopped) {
        return true;
      }

      this.blocked.set(stream === 'blocked');
      if (stream === 'blocked') {
        this.videoShown.set(false);
        // Sperrbildschirm oder UAC-Abfrage: mit dem Dienst am PC gibt es dort Standbilder statt Video.
        const still = await this.remote.readScreen(
          width,
          profile.jpegQuality,
          this.remote.screenMonitor(),
          this.jpegAbort.signal,
        );
        if (this.stopped) {
          return true;
        }

        if (still instanceof Blob) {
          this.blocked.set(false);
          this.noteData();
          this.show(URL.createObjectURL(still));
          await delay(FRAME_INTERVAL_MS);
          continue;
        }
      }

      if (!abort.signal.aborted && (stream === 'unsupported' || (stream === null && !played))) {
        this.videoShown.set(false);
        return false;
      }

      if (stream !== null && stream !== 'blocked' && stream !== 'unsupported') {
        try {
          await this.videoPlayer!.play(
            stream.body,
            this.video().nativeElement,
            stream.codec,
            abort.signal,
            () => {
              played = true;
              this.videoShown.set(true);
              // Das Standbild vom Sperrbildschirm darf nicht unter dem Video stehen bleiben.
              this.show(null);
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

  // Im Vollbild ist nur die innere Ansicht so breit wie der Bildschirm, der Host behaelt die Breite
  // der Seite - nach ihm geholt, kam das Bild am Desktop in halber Breite und unscharf.
  private viewWidth(): number {
    // Der erste JPEG-Abruf startet schon im Konstruktor, vor der Ansicht.
    return this.optionalView()?.nativeElement.clientWidth || this.host.nativeElement.clientWidth;
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
      const sequence = ++this.requested;
      const result = await this.remote.readScreen(
        this.viewWidth() * profile.pixelRatio,
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

    this.lastPointerType = event.pointerType;
    const isMouse = event.pointerType === 'mouse';
    // Mit "Touch" laeuft die rechte Maustaste ueber das Kontextmenue.
    if (isMouse && this.touchMode() && event.button !== 0) {
      return;
    }

    const stage = event.currentTarget as HTMLElement;
    try {
      stage.setPointerCapture?.(event.pointerId);
    } catch {
      // Der Finger ist schon wieder weg - dann kommt auch kein weiteres Ereignis.
    }

    if (isMouse && !this.touchMode()) {
      this.mouseInput(event);
      return;
    }

    if (this.touchMode()) {
      if (event.pointerType === 'pen') {
        this.sendPen(event);
      } else {
        this.touchDown(event);
      }
      return;
    }

    // Seitentaste + Tippen klickt rechts wie langes Druecken; dieser Stift zieht dann nicht.
    if (event.pointerType === 'pen' && (event.buttons & 2) !== 0) {
      this.swallowClick = true;
      this.sendClick(event, 'right');
      return;
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
    if (event.pointerType === 'mouse' && !this.touchMode()) {
      this.mouseInput(event);
      return;
    }

    if (event.pointerType === 'pen' && this.touchMode()) {
      this.pendingPen = event;
      this.schedulePen();
      return;
    }

    if (!this.pointers.has(event.pointerId)) {
      // Ein Stift (S Pen) meldet schon das Schweben ueber dem Display, auch mit gedrueckter
      // Seitentaste (buttons 2): der Zeiger am PC folgt ihm. Nur die aufgesetzte Spitze zieht.
      if (event.pointerType === 'pen' && (event.buttons & 1) === 0 && this.pointers.size === 0) {
        const position = this.toScreenPosition(event.clientX, event.clientY);
        if (position !== null) {
          this.pendingMove = position;
          this.scheduleMove();
        }
      }
      return;
    }

    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.touchSlots.size > 0) {
      this.scheduleTouch();
      return;
    }

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
    if (event.pointerType === 'mouse' && !this.touchMode()) {
      if (event.type === 'pointercancel') {
        this.releaseMouse();
      } else {
        this.mouseInput(event);
      }
      return;
    }

    if (event.pointerType === 'pen' && this.touchMode()) {
      this.sendPen(event.type === 'pointercancel' ? null : event);
      return;
    }

    if (!this.pointers.delete(event.pointerId)) {
      return;
    }

    if (this.touchSlots.delete(event.pointerId)) {
      this.sendTouch();
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
    // Mit "Touch" tippt der Finger selbst, die Maus klickt ueber mouseDown/mouseUp; der Klick des
    // Browsers waere ein zweiter.
    if (this.swallowClick || this.touchMode() || this.lastPointerType === 'mouse') {
      this.swallowClick = false;
      return;
    }

    this.sendClick(event, 'left');
  }

  // Langes Druecken klickt rechts; danach wird aus demselben Finger kein Ziehen mehr.
  protected onContextMenu(event: MouseEvent): void {
    event.preventDefault();
    // Mit "Touch" erkennt Windows langes Druecken selbst.
    if (
      this.dragging ||
      this.pointers.size > 1 ||
      this.swallowClick ||
      this.touchMode() ||
      this.lastPointerType === 'mouse'
    ) {
      return;
    }

    this.dragOrigin = null;
    this.sendClick(event, 'right');
  }

  // Maus am Geraet: der Zeiger am PC folgt ihr auch ohne gedrueckte Taste, und jede Taste geht
  // einzeln an den PC - so klappen Doppelklick, Ziehen und die mittlere Taste wie direkt am PC.
  private mouseInput(event: PointerEvent): void {
    // Wie Parsec: ueber dem Bild nur ein Zeiger - der eigene in der Form des PC-Zeigers, der PC
    // laesst seinen weg. Bis onPointerLeave.
    this.remote.watchScreenCursor(true);
    const pressed = event.buttons & 7;
    // Gedrueckt bleibt der Zeiger am Bildrand; ausserhalb des Bildes beginnt kein Klick.
    const position = this.toScreenPosition(event.clientX, event.clientY, this.mouseButtons !== 0);
    if (position === null && this.mouseButtons === 0) {
      return;
    }

    if (position !== null) {
      this.pendingMove = position;
    }

    if (pressed === this.mouseButtons) {
      this.scheduleMove();
      return;
    }

    this.flushMove();
    this.setMouseButtons(pressed);
  }

  private setMouseButtons(pressed: number): void {
    for (const [bit, button] of MOUSE_BUTTONS) {
      if ((pressed & bit) !== (this.mouseButtons & bit)) {
        this.remote.sendAction({ type: pressed & bit ? 'mouseDown' : 'mouseUp', button });
      }
    }

    this.mouseButtons = pressed;
  }

  private releaseMouse(): void {
    if (this.mouseButtons !== 0) {
      this.flushMove();
      this.setMouseButtons(0);
    }
  }

  private flushMove(): void {
    if (this.moveFrame !== null) {
      cancelAnimationFrame(this.moveFrame);
      this.moveFrame = null;
    }

    if (this.pendingMove !== null) {
      this.sendMove(this.pendingMove);
      this.pendingMove = null;
    }
  }

  // Mausrad und Touchpad am Geraet scrollen am PC; Strg + Rad (auch Spreizen auf dem Touchpad,
  // das der Browser so meldet) zoomt.
  protected onWheel(event: WheelEvent): void {
    event.preventDefault();
    this.flushMove();
    const unit = (WHEEL_UNITS[event.deltaMode] ?? WHEEL_UNITS[0]) * this.remote.scrollSpeed();
    if (event.ctrlKey) {
      this.pendingZoom -= event.deltaY * unit;
    } else {
      this.pendingScrollX += event.deltaX * unit;
      this.pendingScrollY -= event.deltaY * unit;
    }
    this.scheduleScroll();
  }

  // Echte Tastatur am Geraet, solange das Bild den Fokus hat (nach einem Klick hinein).
  protected onStageKeydown(event: KeyboardEvent): void {
    if (event.isComposing) {
      return;
    }

    if (event.key === 'Meta' || event.key === 'OS') {
      this.winAlone = true;
      return;
    }

    this.winAlone = false;
    const action = physicalKeyAction(event);
    if (action === null) {
      return;
    }

    // Mit Abgleich nicht abfangen: erst das paste-Ereignis liefert, was am Geraet kopiert ist,
    // auch Bilder und Dateien, ohne Rueckfrage. Kommt keins, geht Strg+V gleich so raus.
    if (isPasteShortcut(action) && this.clipboardSync.active()) {
      this.pendingPaste = action;
      setTimeout(() => {
        if (this.pendingPaste === action) {
          this.pendingPaste = null;
          this.sendKeys(action);
        }
      });
      return;
    }

    event.preventDefault();
    this.sendKeys(action);
  }

  protected onStageKeyup(event: KeyboardEvent): void {
    if ((event.key === 'Meta' || event.key === 'OS') && this.winAlone) {
      this.winAlone = false;
      this.sendKeys({ type: 'key', keys: ['WIN'] });
    }
  }

  private sendKeys(action: RemoteAction): void {
    if (this.keysBehind === null) {
      this.remote.sendAction(action);
    } else {
      this.queueKeys(async () => {
        this.remote.sendAction(action);
      });
    }
  }

  private queueKeys(task: () => Promise<void>): void {
    const run = (this.keysBehind ?? Promise.resolve()).then(task).catch(() => undefined);
    this.keysBehind = run;
    void run.then(() => {
      if (this.keysBehind === run) {
        this.keysBehind = null;
      }
    });
  }

  // Erst den Inhalt des Geraets an den PC, dann Strg+V - wie eine gemeinsame Zwischenablage.
  protected onPaste(event: ClipboardEvent): void {
    const action = this.pendingPaste;
    if (action === null) {
      return;
    }

    this.pendingPaste = null;
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') ?? '';
    const files = Array.from(event.clipboardData?.files ?? []);
    this.queueKeys(async () => {
      if (text === '' && files.length > 0 && !isPastedBitmap(files)) {
        // Im Explorer kopierte Dateien: hochladen und am PC in die Zwischenablage legen. Das kann
        // nur der Windows-Server; sonst bliebe jedes Strg+V ein neuer Upload ohne Einfuegen.
        if (
          this.remote.serverPlatform() === 'windows' &&
          this.clipboardSync.deviceFilesChanged(files)
        ) {
          if (!(await this.queueFiles(files, true))) {
            return;
          }
          this.clipboardSync.noteDeviceFiles(files);
        }
      } else {
        await this.clipboardSync.syncPasted(text || (files[0] ?? ''));
      }
      this.remote.sendAction(action);
    });
  }

  protected toggleClipboardSync(): void {
    if (this.clipboardSync.available()) {
      this.remote.saveClipboardSync(!this.remote.clipboardSync());
    } else {
      this.showStatus(
        this.clipboardSync.secureContextAvailable
          ? 'settings.clipboardSync.browserUnsupported'
          : 'settings.clipboardSync.httpsHint',
      );
    }
  }

  // Ohne preventDefault oeffnet der Browser eine fallengelassene Datei selbst und verlaesst die App.
  protected onDragOver(event: DragEvent): void {
    if (event.dataTransfer?.types.includes('Files')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      this.dropping.set(true);
    }
  }

  protected onDragLeave(event: DragEvent): void {
    if (!this.view().nativeElement.contains(event.relatedTarget as Node | null)) {
      this.dropping.set(false);
    }
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dropping.set(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) {
      void this.queueFiles(files, false);
    }
  }

  private queueFiles(files: readonly File[], paste: boolean): Promise<boolean> {
    const run = this.fileQueue.then(() => this.sendFiles(files, paste));
    this.fileQueue = run;
    return run;
  }

  // In den Empfangsordner des PCs und dort in die Zwischenablage, so fuegt Strg+V sie in jeden
  // Ordner oder Chat ein. Nur der Windows-Server kann Dateien in die Zwischenablage legen.
  private async sendFiles(files: readonly File[], paste: boolean): Promise<boolean> {
    const names: string[] = [];
    for (const [index, file] of files.entries()) {
      this.showStatus(
        'screen.files.sending',
        { name: file.name, current: index + 1, total: files.length },
        false,
      );
      const result = await this.fileTransfer.sendFile(file);
      if (!result.success || !result.fileName) {
        this.showStatus('screen.files.failed', { name: file.name });
        return false;
      }
      names.push(result.fileName);
    }

    const copied =
      this.remote.serverPlatform() === 'windows' &&
      (await this.clipboard.sendFiles(names)).success;
    if (paste && copied) {
      this.showStatus(null);
    } else {
      this.showStatus(copied ? 'screen.files.ready' : 'screen.files.saved', {
        count: names.length,
      });
    }
    return copied;
  }

  private showStatus(
    key: string | null,
    params?: Record<string, string | number>,
    autoHide = true,
  ): void {
    if (this.statusTimer !== null) {
      clearTimeout(this.statusTimer);
      this.statusTimer = null;
    }

    this.status.set(key === null ? null : this.i18n.t(key, params));
    if (key !== null && autoHide) {
      this.statusTimer = setTimeout(() => {
        this.statusTimer = null;
        this.status.set(null);
      }, STATUS_MS);
    }
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

  // "Touch": jeder Finger bekommt eine feste Id 0-9, solange er liegt; der PC bekommt immer alle
  // liegenden Finger auf einmal, sodass eine verlorene Meldung keinen Finger haengen laesst.
  private touchDown(event: PointerEvent): void {
    const used = new Set(this.touchSlots.values());
    const slot = Array.from({ length: MAX_TOUCH_POINTS }, (_, index) => index).find((index) => !used.has(index));
    if (slot === undefined || this.toScreenPosition(event.clientX, event.clientY) === null) {
      return;
    }

    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.touchSlots.set(event.pointerId, slot);
    this.sendTouch();
  }

  private scheduleTouch(): void {
    if (this.touchFrame !== null) {
      return;
    }

    this.touchFrame = requestAnimationFrame(() => {
      this.touchFrame = null;
      if (performance.now() - this.lastTouchAt < DRAG_MOVE_INTERVAL_MS) {
        this.scheduleTouch();
      } else {
        this.sendTouch();
      }
    });
  }

  private sendTouch(): void {
    if (this.touchFrame !== null) {
      cancelAnimationFrame(this.touchFrame);
      this.touchFrame = null;
    }

    const points = [...this.touchSlots].flatMap(([pointerId, id]) => {
      const finger = this.pointers.get(pointerId);
      const position = finger && this.toScreenPosition(finger.x, finger.y, true);
      return position ? [{ id, ...position }] : [];
    });
    const monitor = this.remote.screenMonitor();
    this.lastTouchAt = performance.now();
    this.remote.sendAction({ type: 'touch', points, ...(monitor === null ? {} : { monitor }) });
  }

  // Schwebt der Stift aus dem Bild, ist er auch am PC ausser Reichweite.
  protected onPointerLeave(event: PointerEvent): void {
    if (event.pointerType === 'mouse') {
      this.remote.watchScreenCursor(false);
    }

    if (event.pointerType === 'pen' && this.touchMode() && (event.buttons & PEN_CONTACT) === 0) {
      this.sendPen(null);
    }
  }

  // "Touch": der Stift geht als echter Stift an den PC - Schweben, Druck, Neigung, Seitentaste
  // (buttons 2) und Radierer (buttons 32). null nimmt ihn aus der Reichweite.
  private sendPen(event: PointerEvent | null): void {
    if (this.penFrame !== null) {
      cancelAnimationFrame(this.penFrame);
      this.penFrame = null;
    }

    this.pendingPen = null;
    const contact = event !== null && (event.buttons & PEN_CONTACT) !== 0;
    const position =
      event === null ? null : this.toScreenPosition(event.clientX, event.clientY, contact);
    if (position === null && !this.penInRange) {
      return;
    }

    const pen =
      event === null || position === null
        ? null
        : {
            ...position,
            // Ohne Drucksensor meldet der Browser 0.5 beim Beruehren, manche Geraete auch 0.
            pressure: contact ? event.pressure || 0.5 : 0,
            tiltX: event.tiltX ?? 0,
            tiltY: event.tiltY ?? 0,
            contact,
            barrel: (event.buttons & 2) !== 0,
            eraser: (event.buttons & 32) !== 0,
          };
    const monitor = this.remote.screenMonitor();
    this.penInRange = pen !== null;
    this.lastPenAt = performance.now();
    this.remote.sendAction({ type: 'pen', pen, ...(monitor === null ? {} : { monitor }) });
  }

  private schedulePen(): void {
    if (this.penFrame !== null) {
      return;
    }

    this.penFrame = requestAnimationFrame(() => {
      this.penFrame = null;
      if (performance.now() - this.lastPenAt < DRAG_MOVE_INTERVAL_MS) {
        this.schedulePen();
      } else if (this.pendingPen !== null) {
        this.sendPen(this.pendingPen);
      }
    });
  }

  private liftAllTouches(): void {
    if (this.penInRange) {
      this.sendPen(null);
    }

    if (this.touchSlots.size === 0) {
      return;
    }

    this.touchSlots.clear();
    this.sendTouch();
  }

  protected toggleTouch(): void {
    this.liftAllTouches();
    this.remote.watchScreenCursor(false);
    this.remote.saveScreenTouch(!this.remote.screenTouch());
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
    this.scheduleScroll();
  }

  private scheduleScroll(): void {
    this.scrollFrame ??= requestAnimationFrame(() => {
      this.scrollFrame = null;
      const clamp = (value: number) =>
        Math.max(-MAX_SCROLL_DELTA, Math.min(MAX_SCROLL_DELTA, Math.round(value)));
      const x = clamp(this.pendingScrollX);
      const y = clamp(this.pendingScrollY);
      const zoom = clamp(this.pendingZoom);
      this.pendingScrollX -= x;
      this.pendingScrollY -= y;
      this.pendingZoom -= zoom;
      if (x !== 0 || y !== 0) {
        this.remote.sendAction({
          type: 'mouseScroll',
          ...(y !== 0 ? { delta: y } : {}),
          ...(x !== 0 ? { deltaX: x } : {}),
        });
      }
      if (zoom !== 0) {
        this.remote.sendAction({ type: 'mouseZoom', delta: zoom });
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
    usePlaybackAudioSession(true);
    const context = this.createAudioContext();
    if (context === null) {
      usePlaybackAudioSession(false);
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
    usePlaybackAudioSession(false);
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
    if (!this.fullscreenSupported) {
      this.fullscreen.update((on) => !on);
      this.menuOpen.set(false);
      // Wie beim echten Vollbild: das Video in der neuen Breite holen.
      this.videoAbort?.abort();
      return;
    }

    if (this.fullscreen()) {
      await this.document.exitFullscreen?.().catch(() => undefined);
      return;
    }

    try {
      await this.view().nativeElement.requestFullscreen();
      // Am Desktop gehen Tasten im Bild an den PC. Im Vollbild faengt Chrome/Edge dafuer auch Esc
      // (gehalten beendet es das Vollbild), Alt+Tab und Win ab, statt sie selbst auszufuehren.
      this.stage().nativeElement.focus({ preventScroll: true });
      const navigator = this.document.defaultView?.navigator as
        { keyboard?: { lock?: () => Promise<void> } } | undefined;
      await navigator?.keyboard?.lock?.().catch(() => undefined);
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
      this.releaseMouse();
      this.liftAllTouches();
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
