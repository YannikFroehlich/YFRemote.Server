import { Component, computed, inject, InjectionToken, OnDestroy, signal } from '@angular/core';
import { ClipboardService, DEVICE_CLIPBOARD_WRITER } from '../clipboard.service';
import { FileTransferService } from '../file-transfer.service';
import { RemoteAction } from '../remote.models';
import { REMOTE_ICON_PATHS } from '../remote-icons';
import { RemoteService } from '../remote.service';
import { isTrustworthyOrigin, SERVER_LOCATION } from '../server-config';
import { TranslationService } from '../translation.service';

/** Minimale eigene Abbildung der Web-Speech-API - es gibt keine offiziellen TypeScript-Typen
 *  dafuer, und wir brauchen ohnehin nur diesen Ausschnitt. */
export interface SpeechRecognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: { readonly error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

export interface SpeechRecognitionResultEvent {
  readonly results: {
    readonly length: number;
    readonly [index: number]: {
      readonly [index: number]: { readonly transcript: string };
    };
  };
}

export type SpeechRecognizerFactory = () => SpeechRecognizer | null;

/** Wie REMOTE_WEBSOCKET_FACTORY/REMOTE_VIBRATE in remote.service.ts: jede Browser-API hinter
 *  einem Token, damit Tests eine Fake-Erkennung einsetzen koennen. null bedeutet "Browser kann
 *  das nicht" (z. B. Firefox) - der Diktier-Knopf bleibt dann einfach unsichtbar. */
export const SPEECH_RECOGNIZER_FACTORY = new InjectionToken<SpeechRecognizerFactory>(
  'SPEECH_RECOGNIZER_FACTORY',
  { providedIn: 'root', factory: () => createBrowserSpeechRecognizer },
);

function createBrowserSpeechRecognizer(): SpeechRecognizer | null {
  const globalWithSpeech = globalThis as unknown as {
    SpeechRecognition?: new () => SpeechRecognizer;
    webkitSpeechRecognition?: new () => SpeechRecognizer;
  };
  const RecognizerCtor = globalWithSpeech.SpeechRecognition ?? globalWithSpeech.webkitSpeechRecognition;

  return RecognizerCtor ? new RecognizerCtor() : null;
}

interface PointerPosition {
  x: number;
  y: number;
  startX: number;
  startY: number;
  totalMovement: number;
  startedAt: number;
  lastEventAt: number;
  canTap: boolean;
}

interface MultiFingerTap {
  readonly fingers: 2 | 3;
  readonly startedAt: number;
}

type PointerMode = 'idle' | 'move' | 'scroll' | 'ignore';
type MouseButtonName = 'left' | 'right' | 'middle';

const TAP_MAX_DURATION_MS = 260;
const TAP_MAX_MOVEMENT_PX = 8;
// So lange nach einem Tipp wird auf erneutes Aufsetzen gewartet (Tippen, halten, ziehen);
// um genau diese Zeit kommt der Linksklick eines einzelnen Tipps verzögert an.
const TAP_DRAG_WINDOW_MS = 180;
const SCROLL_SCALE = 6;
const MAX_SCROLL_DELTA = 1200;
// Zeiger-Beschleunigung: bis ACCEL_THRESHOLD px/ms bleibt die Bewegung 1:1, darüber wächst
// der Faktor linear bis ACCEL_MAX_FACTOR. Kürzere Event-Abstände als MIN_EVENT_INTERVAL_MS
// (zusammengefasste Events) würden sonst eine absurde Geschwindigkeit ergeben.
const ACCEL_THRESHOLD_PX_PER_MS = 0.25;
const ACCEL_GAIN = 1.5;
const ACCEL_MAX_FACTOR = 3;
const MIN_EVENT_INTERVAL_MS = 8;
const DICTATION_ERROR_VISIBLE_MS = 4200;
const FILE_STATUS_VISIBLE_MS = 4200;
const CLIPBOARD_STATUS_VISIBLE_MS = 4200;
// Genug Zeit, um nach dem Fokussieren zum System-"Einfügen" zu greifen; ohne Paste blendet sich
// das Feld danach wieder aus, statt dauerhaft im Weg zu stehen.
const CLIPBOARD_PASTE_TARGET_TIMEOUT_MS = 15000;

@Component({
  selector: 'app-touchpad',
  templateUrl: './touchpad.component.html',
  styleUrl: './touchpad.component.scss',
})
export class TouchpadComponent implements OnDestroy {
  private readonly remote = inject(RemoteService);
  private readonly fileTransfer = inject(FileTransferService);
  private readonly clipboard = inject(ClipboardService);
  private readonly writeDeviceClipboard = inject(DEVICE_CLIPBOARD_WRITER);
  private readonly createRecognizer = inject(SPEECH_RECOGNIZER_FACTORY);
  private readonly location = inject(SERVER_LOCATION);
  protected readonly i18n = inject(TranslationService);
  private readonly pointers = new Map<number, PointerPosition>();
  private readonly heldButtons = new Map<MouseButtonName, number>();

  protected readonly liveTyping = this.remote.liveTyping;
  protected readonly iconPaths = REMOTE_ICON_PATHS;
  // Nur einmalig geprueft: Instanziieren allein fragt noch keine Mikrofon-Berechtigung an
  // (das passiert erst bei start()), daher ist ein Wegwerf-Objekt zum Testen unbedenklich.
  protected readonly dictationSupported = this.createRecognizer() !== null;
  protected readonly dictating = signal(false);
  protected readonly dictationError = signal<string | null>(null);
  protected readonly fileSending = this.fileTransfer.sending;
  protected readonly fileStatus = signal<{ key: string; params?: Record<string, string> } | null>(
    null,
  );
  protected readonly clipboardPasteTargetVisible = signal(false);
  protected readonly clipboardStatus = signal<string | null>(null);
  // Nur der Windows-Server kann die Zwischenablage lesen: Linux antwortet 501, der
  // Android-Server kennt den Endpunkt gar nicht.
  protected readonly pcClipboardReadable = computed(() => this.remote.serverPlatform() === 'windows');
  // Nur wenn beide Richtungen moeglich sind, fragt der Zwischenablage-Knopf nach der Richtung -
  // sonst fuehrt er wie bisher direkt zum Einfuege-Feld, ohne zusaetzlichen Tipp.
  protected readonly clipboardMenuOpen = signal(false);
  protected readonly pcClipboardLoading = signal(false);
  protected readonly pcClipboardText = signal<string | null>(null);
  protected readonly canCopyToDevice = this.writeDeviceClipboard !== null;

  private recognizer: SpeechRecognizer | null = null;
  private dictationBaseText = '';
  private dictationErrorTimer: ReturnType<typeof setTimeout> | null = null;
  private fileStatusTimer: ReturnType<typeof setTimeout> | null = null;
  private clipboardStatusTimer: ReturnType<typeof setTimeout> | null = null;
  private clipboardPasteTargetTimer: ReturnType<typeof setTimeout> | null = null;

  private pointerMode: PointerMode = 'idle';
  private lastScrollCenterX: number | null = null;
  private lastScrollCenterY: number | null = null;
  private multiFingerTap: MultiFingerTap | null = null;
  private pendingTapClick: ReturnType<typeof setTimeout> | null = null;
  private tapDragPointerId: number | null = null;
  private liveTypedText = '';
  private pendingMoveX = 0;
  private pendingMoveY = 0;
  private pendingScrollDeltaX = 0;
  private pendingScrollDeltaY = 0;
  private animationFrameId: number | null = null;

  protected pointerDown(event: PointerEvent): void {
    this.preventBrowserGesture(event);
    this.capturePointer(event);

    if (this.tapDragPointerId !== null) {
      this.endTapDrag();
    } else if (this.pendingTapClick !== null && this.pointers.size === 0) {
      this.startTapDrag(event.pointerId);
    }

    this.pointers.set(event.pointerId, this.createPointerPosition(event));
    this.resolveModeAfterPointerChange();
  }

  protected pointerMove(event: PointerEvent): void {
    const pointer = this.pointers.get(event.pointerId);

    if (pointer === undefined) {
      return;
    }

    this.preventBrowserGesture(event);

    if (this.pointerMode === 'move' && this.pointers.size === 1) {
      this.collectMove(pointer, event);
      return;
    }

    this.updatePointerPosition(pointer, event);

    if (pointer.totalMovement > TAP_MAX_MOVEMENT_PX) {
      this.multiFingerTap = null;
    }

    if (this.pointerMode === 'scroll' && this.pointers.size === 2) {
      this.collectScroll();
    }
  }

  protected pointerUp(event: PointerEvent): void {
    const pointer = this.pointers.get(event.pointerId);

    if (pointer === undefined) {
      return;
    }

    this.preventBrowserGesture(event);
    this.releasePointer(event);
    this.updatePointerPosition(pointer, event);

    const isTap = this.shouldClick(pointer);
    const multiFingerButton = this.multiFingerTapButton(pointer);
    const endsTapDrag = this.tapDragPointerId === event.pointerId;

    this.flushPendingActions();
    this.pointers.delete(event.pointerId);

    if (endsTapDrag) {
      this.tapDragPointerId = null;
      this.sendAction({ type: 'mouseUp', button: 'left' });

      // Zweiter kurzer Tipp statt Ziehen: Drücken+Loslassen war der erste Klick, das hier
      // macht daraus einen Doppelklick.
      if (isTap) {
        this.sendAction({ type: 'mouseClick', button: 'left' });
      }
    } else if (isTap) {
      this.schedulePendingTapClick();
    }

    if (multiFingerButton !== null) {
      this.sendAction({ type: 'mouseClick', button: multiFingerButton });
    }

    this.resolveModeAfterPointerChange();
  }

  protected pointerCancel(event: PointerEvent): void {
    this.preventBrowserGesture(event);
    this.releasePointer(event);
    this.resetPointers();
  }

  protected lostPointerCapture(event: PointerEvent): void {
    if (this.tapDragPointerId === event.pointerId) {
      this.endTapDrag();
    }

    this.pointers.delete(event.pointerId);
    this.resolveModeAfterPointerChange();
  }

  protected preventContextMenu(event: Event): void {
    event.preventDefault();
  }

  /** Antippen und Halten hält die Maustaste gedrückt (wie eine echte Maustaste), sodass
   *  parallel auf der Touchpad-Fläche gezogen werden kann; Loslassen gibt sie wieder frei. */
  protected mouseButtonDown(button: MouseButtonName, event: PointerEvent): void {
    event.preventDefault();

    if (this.heldButtons.has(button)) {
      return;
    }

    this.capturePointer(event);
    this.heldButtons.set(button, event.pointerId);
    this.sendAction({ type: 'mouseDown', button });
  }

  protected mouseButtonRelease(button: MouseButtonName, event: PointerEvent): void {
    if (this.heldButtons.get(button) !== event.pointerId) {
      return;
    }

    event.preventDefault();
    this.releasePointer(event);
    this.heldButtons.delete(button);
    this.sendAction({ type: 'mouseUp', button });
  }

  /** Sicherheitsnetz: eine unterbrochene Geste (z. B. Browser übernimmt den Pointer) darf
   *  die Maustaste auf dem PC nicht für immer gedrückt lassen. */
  protected mouseButtonCancel(button: MouseButtonName, event: PointerEvent): void {
    if (this.heldButtons.get(button) !== event.pointerId) {
      return;
    }

    this.heldButtons.delete(button);
    this.sendAction({ type: 'mouseUp', button });
  }

  protected isButtonHeld(button: MouseButtonName): boolean {
    return this.heldButtons.has(button);
  }

  protected submitText(event: Event, input: HTMLInputElement): void {
    event.preventDefault();
    this.stopDictation();

    if (this.liveTyping()) {
      this.sendAction({ type: 'key', keys: ['ENTER'] });
      this.clearLiveText(input);
      return;
    }

    const text = input.value;

    if (text.length === 0) {
      return;
    }

    this.sendAction({ type: 'text', text });
    input.value = '';
  }

  protected toggleLiveTyping(input: HTMLInputElement): void {
    this.stopDictation();
    this.remote.saveLiveTyping(!this.liveTyping());
    this.clearLiveText(input);

    if (this.liveTyping()) {
      input.focus();
    }
  }

  protected toggleDictation(input: HTMLInputElement): void {
    if (this.dictating()) {
      this.stopDictation();
    } else {
      this.startDictation(input);
    }
  }

  protected async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';

    if (file === undefined) {
      return;
    }

    const result = await this.fileTransfer.sendFile(file);

    if (result.success) {
      this.showFileStatus('touchpad.file.success', { fileName: result.fileName ?? file.name });
    } else {
      this.showFileStatus('touchpad.file.error');
    }
  }

  private showFileStatus(key: string, params?: Record<string, string>): void {
    if (this.fileStatusTimer !== null) {
      clearTimeout(this.fileStatusTimer);
    }

    this.fileStatus.set({ key, params });
    this.fileStatusTimer = setTimeout(() => this.fileStatus.set(null), FILE_STATUS_VISIBLE_MS);
  }

  /** Zeigt das Einfüge-Feld (der eigentliche Fokus kommt vom nativen autofocus-Attribut im
   *  Template, sobald @if es einfügt), statt selbst die - durch den sicheren Kontext gesperrte -
   *  Async-Clipboard-API zu lesen. Der Nutzer löst das eigentliche Einfügen über die native
   *  Geste seines Geräts aus. */
  protected showClipboardPasteTarget(): void {
    this.clipboardPasteTargetVisible.set(true);

    if (this.clipboardPasteTargetTimer !== null) {
      clearTimeout(this.clipboardPasteTargetTimer);
    }

    this.clipboardPasteTargetTimer = setTimeout(
      () => this.hideClipboardPasteTarget(),
      CLIPBOARD_PASTE_TARGET_TIMEOUT_MS,
    );
  }

  protected hideClipboardPasteTarget(): void {
    this.clipboardPasteTargetVisible.set(false);

    if (this.clipboardPasteTargetTimer !== null) {
      clearTimeout(this.clipboardPasteTargetTimer);
      this.clipboardPasteTargetTimer = null;
    }
  }

  protected async onClipboardPaste(event: ClipboardEvent): Promise<void> {
    event.preventDefault();
    this.hideClipboardPasteTarget();
    (event.currentTarget as HTMLElement).textContent = '';

    const items = Array.from(event.clipboardData?.items ?? []);
    const imageItem = items.find((item) => item.kind === 'file' && item.type.startsWith('image/'));
    const textItem = items.find((item) => item.kind === 'string' && item.type === 'text/plain');

    if (imageItem) {
      const file = imageItem.getAsFile();
      const result = file ? await this.clipboard.sendImage(file) : { success: false };
      this.showSendStatus(result.success);
      return;
    }

    if (textItem) {
      const text = await new Promise<string>((resolve) => textItem.getAsString(resolve));
      this.showSendStatus((await this.clipboard.sendText(text)).success);
    }
  }

  protected onClipboardButton(): void {
    if (!this.pcClipboardReadable()) {
      this.showClipboardPasteTarget();
      return;
    }

    this.clipboardMenuOpen.update((open) => !open);
  }

  protected chooseSendClipboard(): void {
    this.clipboardMenuOpen.set(false);
    this.showClipboardPasteTarget();
  }

  protected async fetchPcClipboard(): Promise<void> {
    this.clipboardMenuOpen.set(false);
    this.pcClipboardLoading.set(true);
    const result = await this.clipboard.readText();
    this.pcClipboardLoading.set(false);

    if (!result.success) {
      this.showClipboardStatus('touchpad.pcClipboard.error');
    } else if (!result.text) {
      this.pcClipboardText.set(null);
      this.showClipboardStatus('touchpad.pcClipboard.empty');
    } else {
      this.pcClipboardText.set(result.text);
    }
  }

  protected async copyPcClipboard(text: string): Promise<void> {
    try {
      await this.writeDeviceClipboard!(text);
      this.pcClipboardText.set(null);
      this.showClipboardStatus('touchpad.pcClipboard.copied');
    } catch {
      this.showClipboardStatus('touchpad.pcClipboard.copyError');
    }
  }

  protected closePcClipboard(): void {
    this.pcClipboardText.set(null);
  }

  private showSendStatus(success: boolean): void {
    this.showClipboardStatus(success ? 'touchpad.clipboard.success' : 'touchpad.clipboard.error');
  }

  private showClipboardStatus(key: string): void {
    if (this.clipboardStatusTimer !== null) {
      clearTimeout(this.clipboardStatusTimer);
    }

    this.clipboardStatus.set(key);
    this.clipboardStatusTimer = setTimeout(
      () => this.clipboardStatus.set(null),
      CLIPBOARD_STATUS_VISIBLE_MS,
    );
  }

  private startDictation(input: HTMLInputElement): void {
    // Ueber http://<LAN-IP> verweigert der Browser das Mikrofon grundsaetzlich und bietet dafuer
    // auch keine Freigabe an - ohne eigenen Hinweis stuende hier nur "Zugriff verweigert".
    if (!isTrustworthyOrigin(this.location)) {
      this.showDictationError('touchpad.dictationError.insecureOrigin');
      return;
    }

    const recognizer = this.createRecognizer();

    if (recognizer === null) {
      return;
    }

    this.recognizer = recognizer;
    this.dictationError.set(null);
    recognizer.lang = 'de-DE';
    recognizer.continuous = false;
    recognizer.interimResults = true;

    recognizer.onresult = (event) => {
      const result = event.results[event.results.length - 1];
      const transcript = result[0].transcript;
      input.value = this.joinDictationText(this.dictationBaseText, transcript);
      this.onTextInput(input);
    };

    recognizer.onerror = (event) => {
      this.showDictationError(this.describeDictationError(event.error));
      this.dictating.set(false);
    };

    // Eine Aeusserung endet, sobald der Browser eine Pause erkennt (continuous = false); solange
    // der Knopf noch aktiv ist, direkt die naechste Aeusserung anhaengen statt aufzuhoeren.
    recognizer.onend = () => {
      if (!this.dictating()) {
        return;
      }

      this.dictationBaseText = input.value;

      try {
        recognizer.start();
      } catch {
        this.showDictationError(this.describeDictationError(null));
        this.dictating.set(false);
      }
    };

    this.dictationBaseText = input.value;
    this.dictating.set(true);
    recognizer.start();
  }

  private stopDictation(): void {
    if (!this.dictating()) {
      return;
    }

    // Reihenfolge wichtig: erst das Flag loeschen, sonst startet onend das Diktat gleich neu.
    this.dictating.set(false);
    this.recognizer?.stop();
    this.recognizer = null;
  }

  private joinDictationText(base: string, transcript: string): string {
    if (base.length === 0 || base.endsWith(' ')) {
      return `${base}${transcript}`;
    }

    return `${base} ${transcript}`;
  }

  /** Liefert einen Key ins Uebersetzungs-Dictionary, keinen Anzeigetext - das Template loest
   *  ihn ueber i18n.t() auf, damit ein Sprachwechsel auch eine gerade sichtbare Fehlermeldung
   *  trifft. */
  private describeDictationError(error: string | null): string {
    switch (error) {
      case 'not-allowed':
      case 'permission-denied':
        return 'touchpad.dictationError.notAllowed';
      case 'no-speech':
        return 'touchpad.dictationError.noSpeech';
      default:
        return 'touchpad.dictationError.failed';
    }
  }

  private showDictationError(key: string): void {
    if (this.dictationErrorTimer !== null) {
      clearTimeout(this.dictationErrorTimer);
    }

    this.dictationError.set(key);
    this.dictationErrorTimer = setTimeout(() => this.dictationError.set(null), DICTATION_ERROR_VISIBLE_MS);
  }

  /** Live-Eingabe: vergleicht das Feld mit dem zuletzt gesendeten Stand und schickt nur die
   *  Differenz (Rücktasten + neuer Text). So funktionieren auch Autokorrektur und
   *  Wortvorschläge der Handy-Tastatur, die ganze Wörter auf einmal ersetzen. */
  protected onTextInput(input: HTMLInputElement): void {
    if (!this.liveTyping()) {
      return;
    }

    // ponytail: eine Rücktaste pro Codepoint. Löscht die PC-Anwendung zusammengesetzte Emoji
    // am Stück, gehen dabei zu viele Zeichen weg; dann auf Intl.Segmenter (Grapheme) umstellen.
    const previous = Array.from(this.liveTypedText);
    const next = Array.from(input.value);
    let common = 0;

    while (common < previous.length && common < next.length && previous[common] === next[common]) {
      common++;
    }

    for (let index = common; index < previous.length; index++) {
      this.sendAction({ type: 'key', keys: ['BACKSPACE'] });
    }

    const inserted = next.slice(common).join('');

    if (inserted.length > 0) {
      this.sendAction({ type: 'text', text: inserted });
    }

    this.liveTypedText = input.value;
  }

  /** Bei leerem Feld löst die Rücktaste kein input-Event aus, soll im Live-Modus aber trotzdem
   *  bereits gesendeten Text auf dem PC löschen. */
  protected onTextKeydown(event: KeyboardEvent, input: HTMLInputElement): void {
    if (this.liveTyping() && event.key === 'Backspace' && input.value.length === 0) {
      event.preventDefault();
      this.sendAction({ type: 'key', keys: ['BACKSPACE'] });
    }
  }

  ngOnDestroy(): void {
    this.resetPointers();
    this.releaseAllHeldButtons();
    this.stopDictation();

    if (this.dictationErrorTimer !== null) {
      clearTimeout(this.dictationErrorTimer);
    }

    if (this.fileStatusTimer !== null) {
      clearTimeout(this.fileStatusTimer);
    }

    if (this.clipboardStatusTimer !== null) {
      clearTimeout(this.clipboardStatusTimer);
    }

    if (this.clipboardPasteTargetTimer !== null) {
      clearTimeout(this.clipboardPasteTargetTimer);
    }
  }

  private clearLiveText(input: HTMLInputElement): void {
    input.value = '';
    this.liveTypedText = '';
  }

  private collectMove(pointer: PointerPosition, event: PointerEvent): void {
    const deltaX = event.clientX - pointer.x;
    const deltaY = event.clientY - pointer.y;
    const elapsedMs = event.timeStamp - pointer.lastEventAt;

    this.updatePointerPosition(pointer, event);

    if (deltaX === 0 && deltaY === 0) {
      return;
    }

    const acceleration = this.remote.pointerAcceleration()
      ? accelerationFactor(Math.hypot(deltaX, deltaY), elapsedMs)
      : 1;
    const scale = this.remote.mouseSensitivity() * acceleration;

    this.pendingMoveX += deltaX * scale;
    this.pendingMoveY += deltaY * scale;
    this.scheduleFlush();
  }

  private collectScroll(): void {
    const scrollCenterX = this.getAverageX();
    const scrollCenterY = this.getAverageY();

    if (scrollCenterX === null || scrollCenterY === null) {
      return;
    }

    if (this.lastScrollCenterX === null || this.lastScrollCenterY === null) {
      this.lastScrollCenterX = scrollCenterX;
      this.lastScrollCenterY = scrollCenterY;
      return;
    }

    const deltaX = scrollCenterX - this.lastScrollCenterX;
    const deltaY = scrollCenterY - this.lastScrollCenterY;
    this.lastScrollCenterX = scrollCenterX;
    this.lastScrollCenterY = scrollCenterY;

    // Solange es noch ein Zwei-Finger-Tipp werden kann, kein Scrollen: sonst scrollt das
    // Zittern beim Tippen die Seite ein Stück, bevor der Rechtsklick kommt.
    if (this.multiFingerTap !== null || (deltaX === 0 && deltaY === 0)) {
      return;
    }

    const scale = SCROLL_SCALE * this.remote.scrollSpeed() * (this.remote.invertScroll() ? -1 : 1);

    // Der Inhalt folgt den Fingern: Wischen nach unten scrollt nach oben (positives Mausrad), nach
    // links wischen scrollt nach rechts - dort ist das positive Vorzeichen das Gegenteil der
    // Fingerbewegung, daher nur X umdrehen. Vorher lief horizontal der Inhalt den Fingern entgegen.
    this.pendingScrollDeltaX -= deltaX * scale;
    this.pendingScrollDeltaY += deltaY * scale;
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.animationFrameId !== null) {
      return;
    }

    this.animationFrameId = requestAnimationFrame(() => {
      this.animationFrameId = null;
      this.flushPendingActions();

      if (
        Math.abs(this.pendingMoveX) >= 1 ||
        Math.abs(this.pendingMoveY) >= 1 ||
        Math.abs(this.pendingScrollDeltaX) >= 1 ||
        Math.abs(this.pendingScrollDeltaY) >= 1
      ) {
        this.scheduleFlush();
      }
    });
  }

  private flushPendingActions(): void {
    this.flushPendingMove();
    this.flushPendingScroll();
  }

  private flushPendingMove(): void {
    const deltaX = Math.round(this.pendingMoveX);
    const deltaY = Math.round(this.pendingMoveY);

    if (deltaX === 0 && deltaY === 0) {
      return;
    }

    this.pendingMoveX -= deltaX;
    this.pendingMoveY -= deltaY;
    this.sendAction({ type: 'mouseMove', deltaX, deltaY });
  }

  private flushPendingScroll(): void {
    const deltaX = this.clampScrollDelta(Math.round(this.pendingScrollDeltaX));
    const deltaY = this.clampScrollDelta(Math.round(this.pendingScrollDeltaY));

    if (deltaX === 0 && deltaY === 0) {
      return;
    }

    this.pendingScrollDeltaX -= deltaX;
    this.pendingScrollDeltaY -= deltaY;

    this.sendAction({
      type: 'mouseScroll',
      ...(deltaY !== 0 ? { delta: deltaY } : {}),
      ...(deltaX !== 0 ? { deltaX } : {}),
    });
  }

  private resolveModeAfterPointerChange(): void {
    const pointerCount = this.pointers.size;
    const pointers = Array.from(this.pointers.values());

    // Nur frisch nacheinander aufgesetzte Finger (1→2, dann ggf. 2→3) sind ein Tipp-Kandidat;
    // bei 3→2 oder nach Bewegung ist canTap bzw. der Kandidat bereits verworfen.
    if (pointerCount === 2 && pointers.every((pointer) => pointer.canTap)) {
      this.multiFingerTap = {
        fingers: 2,
        startedAt: Math.min(...pointers.map((pointer) => pointer.startedAt)),
      };
    } else if (pointerCount === 3 && this.multiFingerTap?.fingers === 2) {
      this.multiFingerTap = { ...this.multiFingerTap, fingers: 3 };
    } else {
      this.multiFingerTap = null;
    }

    if (pointerCount === 0) {
      this.pointerMode = 'idle';
      this.lastScrollCenterX = null;
      this.lastScrollCenterY = null;
      return;
    }

    if (pointerCount === 1) {
      this.pointerMode = 'move';
      this.lastScrollCenterX = null;
      this.lastScrollCenterY = null;
      this.resetRemainingPointerBaseline();
      return;
    }

    this.flushPendingActions();
    this.markAllPointersAsNonTap();

    if (pointerCount === 2) {
      this.pointerMode = 'scroll';
      this.lastScrollCenterX = this.getAverageX();
      this.lastScrollCenterY = this.getAverageY();
      return;
    }

    this.pointerMode = 'ignore';
    this.lastScrollCenterX = null;
    this.lastScrollCenterY = null;
  }

  private shouldClick(pointer: PointerPosition): boolean {
    return (
      this.pointerMode === 'move' &&
      this.pointers.size === 1 &&
      pointer.canTap &&
      pointer.totalMovement <= TAP_MAX_MOVEMENT_PX &&
      performance.now() - pointer.startedAt <= TAP_MAX_DURATION_MS
    );
  }

  private multiFingerTapButton(pointer: PointerPosition): 'right' | 'middle' | null {
    const tap = this.multiFingerTap;

    if (
      tap === null ||
      this.pointers.size !== tap.fingers ||
      pointer.totalMovement > TAP_MAX_MOVEMENT_PX ||
      performance.now() - tap.startedAt > TAP_MAX_DURATION_MS
    ) {
      return null;
    }

    return tap.fingers === 2 ? 'right' : 'middle';
  }

  private schedulePendingTapClick(): void {
    this.cancelPendingTapClick();
    this.pendingTapClick = setTimeout(() => {
      this.pendingTapClick = null;
      this.sendAction({ type: 'mouseClick', button: 'left' });
    }, TAP_DRAG_WINDOW_MS);
  }

  private cancelPendingTapClick(): void {
    if (this.pendingTapClick !== null) {
      clearTimeout(this.pendingTapClick);
      this.pendingTapClick = null;
    }
  }

  private startTapDrag(pointerId: number): void {
    this.cancelPendingTapClick();
    this.tapDragPointerId = pointerId;
    this.sendAction({ type: 'mouseDown', button: 'left' });
  }

  /** Beendet ein Tippen-Halten-Ziehen vorzeitig (weiterer Finger, abgebrochene Geste), damit
   *  die linke Maustaste auf dem PC nie gedrückt hängen bleibt. */
  private endTapDrag(): void {
    if (this.tapDragPointerId === null) {
      return;
    }

    const pointer = this.pointers.get(this.tapDragPointerId);

    if (pointer !== undefined) {
      pointer.canTap = false;
    }

    this.tapDragPointerId = null;
    this.flushPendingActions();
    this.sendAction({ type: 'mouseUp', button: 'left' });
  }

  private resetRemainingPointerBaseline(): void {
    const remainingPointer = Array.from(this.pointers.values())[0];

    if (remainingPointer === undefined) {
      return;
    }

    remainingPointer.startX = remainingPointer.x;
    remainingPointer.startY = remainingPointer.y;
    remainingPointer.totalMovement = 0;
  }

  private markAllPointersAsNonTap(): void {
    for (const pointer of this.pointers.values()) {
      pointer.canTap = false;
    }
  }

  private updatePointerPosition(pointer: PointerPosition, event: PointerEvent): void {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.lastEventAt = event.timeStamp;
    pointer.totalMovement = Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY);

    if (pointer.totalMovement > TAP_MAX_MOVEMENT_PX) {
      pointer.canTap = false;
    }
  }

  private createPointerPosition(event: PointerEvent): PointerPosition {
    return {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      totalMovement: 0,
      startedAt: performance.now(),
      lastEventAt: event.timeStamp,
      canTap: true,
    };
  }

  private getAverageX(): number | null {
    if (this.pointers.size === 0) {
      return null;
    }

    let totalX = 0;

    for (const pointer of this.pointers.values()) {
      totalX += pointer.x;
    }

    return totalX / this.pointers.size;
  }

  private getAverageY(): number | null {
    if (this.pointers.size === 0) {
      return null;
    }

    let totalY = 0;

    for (const pointer of this.pointers.values()) {
      totalY += pointer.y;
    }

    return totalY / this.pointers.size;
  }

  private clampScrollDelta(delta: number): number {
    return Math.max(-MAX_SCROLL_DELTA, Math.min(MAX_SCROLL_DELTA, delta));
  }

  private sendAction(action: RemoteAction): void {
    this.remote.sendAction(action);
  }

  private resetPointers(): void {
    this.endTapDrag();
    this.cancelPendingTapClick();
    this.pointers.clear();
    this.pointerMode = 'idle';
    this.lastScrollCenterX = null;
    this.lastScrollCenterY = null;
    this.multiFingerTap = null;
    this.pendingMoveX = 0;
    this.pendingMoveY = 0;
    this.pendingScrollDeltaX = 0;
    this.pendingScrollDeltaY = 0;

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private releaseAllHeldButtons(): void {
    for (const button of this.heldButtons.keys()) {
      this.sendAction({ type: 'mouseUp', button });
    }

    this.heldButtons.clear();
  }

  private capturePointer(event: PointerEvent): void {
    const target = event.currentTarget;

    if (target instanceof Element && typeof target.setPointerCapture === 'function') {
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        return;
      }
    }
  }

  private releasePointer(event: PointerEvent): void {
    const target = event.currentTarget;

    if (target instanceof Element && typeof target.releasePointerCapture === 'function') {
      try {
        target.releasePointerCapture(event.pointerId);
      } catch {
        return;
      }
    }
  }

  private preventBrowserGesture(event: PointerEvent): void {
    event.preventDefault();
  }
}

function accelerationFactor(distancePx: number, elapsedMs: number): number {
  const speed = distancePx / Math.max(elapsedMs, MIN_EVENT_INTERVAL_MS);

  return Math.min(
    ACCEL_MAX_FACTOR,
    1 + Math.max(0, speed - ACCEL_THRESHOLD_PX_PER_MS) * ACCEL_GAIN,
  );
}
