import { TestBed } from '@angular/core/testing';
import {
  REMOTE_AUTO_CONNECT,
  REMOTE_STORAGE,
  REMOTE_WEBSOCKET_FACTORY,
  RemoteService,
  RemoteSocket,
} from '../remote.service';
import {
  INVERT_SCROLL_STORAGE_KEY,
  LIVE_TYPING_STORAGE_KEY,
  MOUSE_SENSITIVITY_STORAGE_KEY,
  POINTER_ACCELERATION_STORAGE_KEY,
  SCROLL_SPEED_STORAGE_KEY,
  SERVER_LOCATION,
  ServerLocation,
} from '../server-config';
import {
  SPEECH_RECOGNIZER_FACTORY,
  SpeechRecognitionResultEvent,
  SpeechRecognizer,
  TouchpadComponent,
} from './touchpad.component';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class MockRemoteSocket implements RemoteSocket {
  readonly sentMessages: string[] = [];

  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  closed = false;

  constructor(readonly url: string) {}

  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
  }
}

class MockSpeechRecognizer implements SpeechRecognizer {
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null = null;
  onerror: ((event: { readonly error: string }) => void) | null = null;
  onend: (() => void) | null = null;

  startCount = 0;
  stopped = false;

  start(): void {
    this.startCount++;
  }

  stop(): void {
    this.stopped = true;
  }

  result(transcript: string): void {
    this.onresult?.({ results: { length: 1, 0: { 0: { transcript } } } });
  }

  error(error: string): void {
    this.onerror?.({ error });
  }

  end(): void {
    this.onend?.();
  }
}

interface TouchpadHarness {
  readonly fixture: ReturnType<typeof TestBed.createComponent<TouchpadComponent>>;
  readonly surface: HTMLElement;
  readonly sockets: MockRemoteSocket[];
  readonly flushRaf: () => void;
}

describe('TouchpadComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('batches one-finger movement per animation frame and applies sensitivity', async () => {
    const { surface, sockets, flushRaf } = await setupTouchpad({ sensitivity: 2 });

    dispatchPointer(surface, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
    dispatchPointer(surface, 'pointermove', { pointerId: 1, clientX: 102, clientY: 101 });
    dispatchPointer(surface, 'pointermove', { pointerId: 1, clientX: 105, clientY: 99 });

    expect(sockets[0].sentMessages).toEqual([]);

    flushRaf();

    expect(sockets[0].sentMessages).toEqual(['{"type":"mouseMove","deltaX":10,"deltaY":-2}']);
  });

  it('turns a short tap into left click but does not click after a drag', async () => {
    const { surface, sockets, flushRaf } = await setupTouchpad();
    useFakeTapTimers();

    dispatchPointer(surface, 'pointerdown', { pointerId: 1, clientX: 10, clientY: 10 });
    dispatchPointer(surface, 'pointerup', { pointerId: 1, clientX: 10, clientY: 10 });

    // Der Klick wartet das Tippen-Halten-Ziehen-Fenster ab.
    expect(sockets[0].sentMessages).toEqual([]);
    vi.advanceTimersByTime(180);
    expect(sockets[0].sentMessages).toEqual(['{"type":"mouseClick","button":"left"}']);

    dispatchPointer(surface, 'pointerdown', { pointerId: 2, clientX: 20, clientY: 20 });
    dispatchPointer(surface, 'pointermove', { pointerId: 2, clientX: 45, clientY: 20 });
    flushRaf();
    dispatchPointer(surface, 'pointerup', { pointerId: 2, clientX: 45, clientY: 20 });

    expect(sockets[0].sentMessages).toEqual([
      '{"type":"mouseClick","button":"left"}',
      '{"type":"mouseMove","deltaX":25,"deltaY":0}',
    ]);
  });

  it('uses two fingers for scroll instead of pointer movement', async () => {
    const { surface, sockets, flushRaf } = await setupTouchpad();

    dispatchPointer(surface, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
    dispatchPointer(surface, 'pointerdown', { pointerId: 2, clientX: 140, clientY: 100 });
    dispatchPointer(surface, 'pointermove', { pointerId: 1, clientX: 100, clientY: 90 });
    dispatchPointer(surface, 'pointermove', { pointerId: 2, clientX: 140, clientY: 90 });
    flushRaf();

    expect(sockets[0].sentMessages).toEqual(['{"type":"mouseScroll","delta":-60}']);
  });

  it('scrolls horizontally when two fingers move sideways', async () => {
    const { surface, sockets, flushRaf } = await setupTouchpad();

    dispatchPointer(surface, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
    dispatchPointer(surface, 'pointerdown', { pointerId: 2, clientX: 100, clientY: 140 });
    dispatchPointer(surface, 'pointermove', { pointerId: 1, clientX: 90, clientY: 100 });
    dispatchPointer(surface, 'pointermove', { pointerId: 2, clientX: 90, clientY: 140 });
    flushRaf();

    expect(sockets[0].sentMessages).toEqual(['{"type":"mouseScroll","deltaX":-60}']);
  });

  it('applies the stored scroll speed and inverted direction', async () => {
    const { surface, sockets, flushRaf } = await setupTouchpad({
      stored: { [SCROLL_SPEED_STORAGE_KEY]: '2', [INVERT_SCROLL_STORAGE_KEY]: 'true' },
    });

    dispatchPointer(surface, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
    dispatchPointer(surface, 'pointerdown', { pointerId: 2, clientX: 140, clientY: 100 });
    dispatchPointer(surface, 'pointermove', { pointerId: 1, clientX: 100, clientY: 90 });
    dispatchPointer(surface, 'pointermove', { pointerId: 2, clientX: 140, clientY: 90 });
    flushRaf();

    expect(sockets[0].sentMessages).toEqual(['{"type":"mouseScroll","delta":120}']);
  });

  it('turns a short two-finger tap into right click without scrolling the jitter', async () => {
    const { surface, sockets, flushRaf } = await setupTouchpad();

    dispatchPointer(surface, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
    dispatchPointer(surface, 'pointerdown', { pointerId: 2, clientX: 140, clientY: 100 });
    dispatchPointer(surface, 'pointermove', { pointerId: 1, clientX: 101, clientY: 102 });
    flushRaf();
    dispatchPointer(surface, 'pointerup', { pointerId: 1, clientX: 101, clientY: 102 });
    dispatchPointer(surface, 'pointerup', { pointerId: 2, clientX: 140, clientY: 100 });

    expect(sockets[0].sentMessages).toEqual(['{"type":"mouseClick","button":"right"}']);
  });

  it('does not right click after a two-finger scroll', async () => {
    const { surface, sockets, flushRaf } = await setupTouchpad();

    dispatchPointer(surface, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
    dispatchPointer(surface, 'pointerdown', { pointerId: 2, clientX: 140, clientY: 100 });
    dispatchPointer(surface, 'pointermove', { pointerId: 1, clientX: 100, clientY: 90 });
    dispatchPointer(surface, 'pointermove', { pointerId: 2, clientX: 140, clientY: 90 });
    flushRaf();
    dispatchPointer(surface, 'pointerup', { pointerId: 1, clientX: 100, clientY: 90 });
    dispatchPointer(surface, 'pointerup', { pointerId: 2, clientX: 140, clientY: 90 });

    expect(sockets[0].sentMessages).toEqual(['{"type":"mouseScroll","delta":-60}']);
  });

  it('does not right click when the second finger joins after the first one moved', async () => {
    const { surface, sockets, flushRaf } = await setupTouchpad();

    dispatchPointer(surface, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
    dispatchPointer(surface, 'pointermove', { pointerId: 1, clientX: 120, clientY: 100 });
    dispatchPointer(surface, 'pointerdown', { pointerId: 2, clientX: 170, clientY: 100 });
    dispatchPointer(surface, 'pointerup', { pointerId: 2, clientX: 170, clientY: 100 });
    dispatchPointer(surface, 'pointerup', { pointerId: 1, clientX: 120, clientY: 100 });
    flushRaf();

    expect(sockets[0].sentMessages).toEqual(['{"type":"mouseMove","deltaX":20,"deltaY":0}']);
  });

  it('turns a short three-finger tap into middle click', async () => {
    const { surface, sockets } = await setupTouchpad();

    dispatchPointer(surface, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
    dispatchPointer(surface, 'pointerdown', { pointerId: 2, clientX: 140, clientY: 100 });
    dispatchPointer(surface, 'pointerdown', { pointerId: 3, clientX: 180, clientY: 100 });
    dispatchPointer(surface, 'pointerup', { pointerId: 2, clientX: 140, clientY: 100 });
    dispatchPointer(surface, 'pointerup', { pointerId: 1, clientX: 100, clientY: 100 });
    dispatchPointer(surface, 'pointerup', { pointerId: 3, clientX: 180, clientY: 100 });

    expect(sockets[0].sentMessages).toEqual(['{"type":"mouseClick","button":"middle"}']);
  });

  it('accelerates fast finger movement but keeps slow movement 1:1', async () => {
    const { surface, sockets, flushRaf } = await setupTouchpad();

    dispatchPointer(surface, 'pointerdown', {
      pointerId: 1,
      clientX: 0,
      clientY: 0,
      timeStamp: 1000,
    });
    dispatchPointer(surface, 'pointermove', {
      pointerId: 1,
      clientX: 20,
      clientY: 0,
      timeStamp: 1100,
    });
    flushRaf();
    dispatchPointer(surface, 'pointermove', {
      pointerId: 1,
      clientX: 60,
      clientY: 0,
      timeStamp: 1120,
    });
    flushRaf();

    expect(sockets[0].sentMessages).toEqual([
      '{"type":"mouseMove","deltaX":20,"deltaY":0}',
      '{"type":"mouseMove","deltaX":120,"deltaY":0}',
    ]);
  });

  it('keeps fast movement 1:1 when pointer acceleration is switched off', async () => {
    const { surface, sockets, flushRaf } = await setupTouchpad({
      stored: { [POINTER_ACCELERATION_STORAGE_KEY]: 'false' },
    });

    dispatchPointer(surface, 'pointerdown', {
      pointerId: 1,
      clientX: 0,
      clientY: 0,
      timeStamp: 1000,
    });
    dispatchPointer(surface, 'pointermove', {
      pointerId: 1,
      clientX: 40,
      clientY: 0,
      timeStamp: 1020,
    });
    flushRaf();

    expect(sockets[0].sentMessages).toEqual(['{"type":"mouseMove","deltaX":40,"deltaY":0}']);
  });

  it('drags with the left button held after tap, then touch and move', async () => {
    const { surface, sockets, flushRaf } = await setupTouchpad();
    useFakeTapTimers();

    dispatchPointer(surface, 'pointerdown', { pointerId: 1, clientX: 10, clientY: 10 });
    dispatchPointer(surface, 'pointerup', { pointerId: 1, clientX: 10, clientY: 10 });
    dispatchPointer(surface, 'pointerdown', { pointerId: 2, clientX: 10, clientY: 10 });
    dispatchPointer(surface, 'pointermove', { pointerId: 2, clientX: 30, clientY: 10 });
    flushRaf();
    dispatchPointer(surface, 'pointerup', { pointerId: 2, clientX: 30, clientY: 10 });
    vi.advanceTimersByTime(1000);

    expect(sockets[0].sentMessages).toEqual([
      '{"type":"mouseDown","button":"left"}',
      '{"type":"mouseMove","deltaX":20,"deltaY":0}',
      '{"type":"mouseUp","button":"left"}',
    ]);
  });

  it('turns two quick taps into a double click', async () => {
    const { surface, sockets } = await setupTouchpad();
    useFakeTapTimers();

    dispatchPointer(surface, 'pointerdown', { pointerId: 1, clientX: 10, clientY: 10 });
    dispatchPointer(surface, 'pointerup', { pointerId: 1, clientX: 10, clientY: 10 });
    dispatchPointer(surface, 'pointerdown', { pointerId: 2, clientX: 11, clientY: 10 });
    dispatchPointer(surface, 'pointerup', { pointerId: 2, clientX: 11, clientY: 10 });
    vi.advanceTimersByTime(1000);

    expect(sockets[0].sentMessages).toEqual([
      '{"type":"mouseDown","button":"left"}',
      '{"type":"mouseUp","button":"left"}',
      '{"type":"mouseClick","button":"left"}',
    ]);
  });

  it('releases a tap-drag when a second finger joins', async () => {
    const { surface, sockets } = await setupTouchpad();
    useFakeTapTimers();

    dispatchPointer(surface, 'pointerdown', { pointerId: 1, clientX: 10, clientY: 10 });
    dispatchPointer(surface, 'pointerup', { pointerId: 1, clientX: 10, clientY: 10 });
    dispatchPointer(surface, 'pointerdown', { pointerId: 2, clientX: 10, clientY: 10 });
    dispatchPointer(surface, 'pointerdown', { pointerId: 3, clientX: 50, clientY: 10 });
    dispatchPointer(surface, 'pointerup', { pointerId: 3, clientX: 50, clientY: 10 });
    dispatchPointer(surface, 'pointerup', { pointerId: 2, clientX: 10, clientY: 10 });

    expect(sockets[0].sentMessages).toEqual([
      '{"type":"mouseDown","button":"left"}',
      '{"type":"mouseUp","button":"left"}',
    ]);
  });

  it('clears pending movement on pointercancel', async () => {
    const { surface, sockets, flushRaf } = await setupTouchpad();

    dispatchPointer(surface, 'pointerdown', { pointerId: 1, clientX: 0, clientY: 0 });
    dispatchPointer(surface, 'pointermove', { pointerId: 1, clientX: 40, clientY: 0 });
    dispatchPointer(surface, 'pointercancel', { pointerId: 1, clientX: 40, clientY: 0 });
    flushRaf();

    expect(sockets[0].sentMessages).toEqual([]);
  });

  it('holds and releases the right-click button like a real mouse button', async () => {
    const { fixture, sockets } = await setupTouchpad();
    const rightClickButton = mouseButton(fixture, 'Rechtsklick');

    dispatchPointer(rightClickButton, 'pointerdown', { pointerId: 5, clientX: 0, clientY: 0 });

    expect(sockets[0].sentMessages).toEqual(['{"type":"mouseDown","button":"right"}']);

    dispatchPointer(rightClickButton, 'pointerup', { pointerId: 5, clientX: 0, clientY: 0 });

    expect(sockets[0].sentMessages).toEqual([
      '{"type":"mouseDown","button":"right"}',
      '{"type":"mouseUp","button":"right"}',
    ]);
  });

  it('holds and releases the middle-click button like a real mouse button', async () => {
    const { fixture, sockets } = await setupTouchpad();
    const middleClickButton = mouseButton(fixture, 'Mittelklick');

    dispatchPointer(middleClickButton, 'pointerdown', { pointerId: 7, clientX: 0, clientY: 0 });
    dispatchPointer(middleClickButton, 'pointerup', { pointerId: 7, clientX: 0, clientY: 0 });

    expect(sockets[0].sentMessages).toEqual([
      '{"type":"mouseDown","button":"middle"}',
      '{"type":"mouseUp","button":"middle"}',
    ]);
  });

  it('keeps the left button held while dragging on the touchpad surface, then releases it', async () => {
    const { fixture, surface, sockets, flushRaf } = await setupTouchpad();
    const leftClickButton = mouseButton(fixture, 'Linksklick');

    dispatchPointer(leftClickButton, 'pointerdown', { pointerId: 1, clientX: 0, clientY: 0 });
    expect(sockets[0].sentMessages).toEqual(['{"type":"mouseDown","button":"left"}']);

    dispatchPointer(surface, 'pointerdown', { pointerId: 2, clientX: 10, clientY: 10 });
    dispatchPointer(surface, 'pointermove', { pointerId: 2, clientX: 30, clientY: 10 });
    flushRaf();
    dispatchPointer(surface, 'pointerup', { pointerId: 2, clientX: 30, clientY: 10 });

    dispatchPointer(leftClickButton, 'pointerup', { pointerId: 1, clientX: 0, clientY: 0 });

    expect(sockets[0].sentMessages).toEqual([
      '{"type":"mouseDown","button":"left"}',
      '{"type":"mouseMove","deltaX":20,"deltaY":0}',
      '{"type":"mouseUp","button":"left"}',
    ]);
  });

  it('releases a held button on pointercancel so it never stays stuck down', async () => {
    const { fixture, sockets } = await setupTouchpad();
    const leftClickButton = mouseButton(fixture, 'Linksklick');

    dispatchPointer(leftClickButton, 'pointerdown', { pointerId: 1, clientX: 0, clientY: 0 });
    dispatchPointer(leftClickButton, 'pointercancel', { pointerId: 1, clientX: 0, clientY: 0 });

    expect(sockets[0].sentMessages).toEqual([
      '{"type":"mouseDown","button":"left"}',
      '{"type":"mouseUp","button":"left"}',
    ]);
  });

  it('releases any held button when the component is destroyed', async () => {
    const { fixture, sockets } = await setupTouchpad();
    const leftClickButton = mouseButton(fixture, 'Linksklick');

    dispatchPointer(leftClickButton, 'pointerdown', { pointerId: 1, clientX: 0, clientY: 0 });
    fixture.destroy();

    expect(sockets[0].sentMessages).toEqual([
      '{"type":"mouseDown","button":"left"}',
      '{"type":"mouseUp","button":"left"}',
    ]);
  });

  it('sends typed text and clears the input', async () => {
    const { fixture, sockets } = await setupTouchpad();
    const root = fixture.nativeElement as HTMLElement;
    const textInput = root.querySelector<HTMLInputElement>('.touchpad-text__input');
    const form = root.querySelector<HTMLFormElement>('.touchpad-text');

    expect(textInput).not.toBeNull();
    expect(form).not.toBeNull();

    textInput!.value = 'Hallo Welt!';
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(sockets[0].sentMessages).toEqual(['{"type":"text","text":"Hallo Welt!"}']);
    expect(textInput!.value).toBe('');
  });

  it('sends live typing as a diff, including autocorrect rewrites', async () => {
    const { fixture, sockets } = await setupTouchpad();
    const { textInput, liveSwitch, form } = textControls(fixture);

    liveSwitch.click();
    fixture.detectChanges();

    typeInto(textInput, 'Halo');
    typeInto(textInput, 'Hallo');
    typeInto(textInput, 'Hallo \u{1F642}');
    typeInto(textInput, 'Hallo');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(sockets[0].sentMessages).toEqual([
      '{"type":"text","text":"Halo"}',
      '{"type":"key","keys":["BACKSPACE"]}',
      '{"type":"text","text":"lo"}',
      JSON.stringify({ type: 'text', text: ' \u{1F642}' }),
      '{"type":"key","keys":["BACKSPACE"]}',
      '{"type":"key","keys":["BACKSPACE"]}',
      '{"type":"key","keys":["ENTER"]}',
    ]);
    expect(textInput.value).toBe('');
  });

  it('restores the stored live-typing switch', async () => {
    const { fixture, sockets } = await setupTouchpad({
      stored: { [LIVE_TYPING_STORAGE_KEY]: 'true' },
    });
    const { textInput, liveSwitch } = textControls(fixture);

    expect(liveSwitch.getAttribute('aria-checked')).toBe('true');
    typeInto(textInput, 'x');
    expect(sockets[0].sentMessages).toEqual(['{"type":"text","text":"x"}']);
  });

  it('sends backspace for an empty live field and nothing when live typing is off', async () => {
    const { fixture, sockets } = await setupTouchpad();
    const { textInput, liveSwitch } = textControls(fixture);

    textInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true }));
    typeInto(textInput, 'abc');

    liveSwitch.click();
    fixture.detectChanges();
    textInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true }));

    expect(sockets[0].sentMessages).toEqual(['{"type":"key","keys":["BACKSPACE"]}']);
  });

  it('does not send anything when submitting an empty text field', async () => {
    const { fixture, sockets } = await setupTouchpad();
    const root = fixture.nativeElement as HTMLElement;
    const form = root.querySelector<HTMLFormElement>('.touchpad-text');

    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(sockets[0].sentMessages).toEqual([]);
  });

  it('hides the dictation button when the browser has no speech recognition', async () => {
    const { fixture } = await setupTouchpad();

    expect(micButton(fixture)).toBeNull();
  });

  it('starts and stops recognition when the dictation button is toggled', async () => {
    const recognizer = new MockSpeechRecognizer();
    const { fixture } = await setupTouchpad({ dictationRecognizer: recognizer });
    const button = micButton(fixture)!;

    button.click();
    fixture.detectChanges();
    expect(recognizer.startCount).toBe(1);
    expect(button.getAttribute('aria-checked')).toBe('true');

    button.click();
    fixture.detectChanges();
    expect(recognizer.stopped).toBe(true);
    expect(button.getAttribute('aria-checked')).toBe('false');
  });

  it('explains that dictation needs HTTPS instead of starting it on a plain-HTTP LAN address', async () => {
    const recognizer = new MockSpeechRecognizer();
    const { fixture } = await setupTouchpad({
      dictationRecognizer: recognizer,
      pageUrl: 'http://192.168.178.41:5050/',
    });
    const button = micButton(fixture)!;

    button.click();
    fixture.detectChanges();

    expect(recognizer.startCount).toBe(0);
    expect(button.getAttribute('aria-checked')).toBe('false');
    expect(fixture.nativeElement.textContent).toContain('Diktieren geht nur über HTTPS');
  });

  it('sends dictated text immediately when live typing is on', async () => {
    const recognizer = new MockSpeechRecognizer();
    const { fixture, sockets } = await setupTouchpad({ dictationRecognizer: recognizer });
    const { liveSwitch } = textControls(fixture);

    liveSwitch.click();
    micButton(fixture)!.click();
    recognizer.result('hallo welt');

    expect(sockets[0].sentMessages).toEqual(['{"type":"text","text":"hallo welt"}']);
  });

  it('only fills the field, without sending, when live typing is off', async () => {
    const recognizer = new MockSpeechRecognizer();
    const { fixture, sockets } = await setupTouchpad({ dictationRecognizer: recognizer });
    const { textInput } = textControls(fixture);

    micButton(fixture)!.click();
    recognizer.result('hallo welt');

    expect(textInput.value).toBe('hallo welt');
    expect(sockets[0].sentMessages).toEqual([]);
  });

  it('appends the next utterance instead of overwriting when still dictating', async () => {
    const recognizer = new MockSpeechRecognizer();
    const { fixture } = await setupTouchpad({ dictationRecognizer: recognizer });
    const { textInput } = textControls(fixture);

    micButton(fixture)!.click();
    recognizer.result('erster satz');
    recognizer.end();
    expect(recognizer.startCount).toBe(2);

    recognizer.result('zweiter satz');
    expect(textInput.value).toBe('erster satz zweiter satz');
  });

  it('does not restart recognition after the dictation button stopped it', async () => {
    const recognizer = new MockSpeechRecognizer();
    const { fixture } = await setupTouchpad({ dictationRecognizer: recognizer });

    micButton(fixture)!.click();
    expect(recognizer.startCount).toBe(1);

    micButton(fixture)!.click();
    recognizer.end();

    expect(recognizer.startCount).toBe(1);
  });

  it('shows an error and stops dictating when recognition fails', async () => {
    const recognizer = new MockSpeechRecognizer();
    const { fixture } = await setupTouchpad({ dictationRecognizer: recognizer });
    const button = micButton(fixture)!;

    button.click();
    recognizer.error('not-allowed');
    fixture.detectChanges();

    expect(button.getAttribute('aria-checked')).toBe('false');
    expect(dictationErrorMessage(fixture)).toBe('Mikrofonzugriff wurde verweigert.');
  });

  it('stops a running dictation when the text is submitted', async () => {
    const recognizer = new MockSpeechRecognizer();
    const { fixture } = await setupTouchpad({ dictationRecognizer: recognizer });
    const { form } = textControls(fixture);

    micButton(fixture)!.click();
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(recognizer.stopped).toBe(true);
  });

  it('stops a running dictation when live typing is toggled', async () => {
    const recognizer = new MockSpeechRecognizer();
    const { fixture } = await setupTouchpad({ dictationRecognizer: recognizer });
    const { liveSwitch } = textControls(fixture);

    micButton(fixture)!.click();
    liveSwitch.click();

    expect(recognizer.stopped).toBe(true);
  });

  it('stops a running dictation when the component is destroyed', async () => {
    const recognizer = new MockSpeechRecognizer();
    const { fixture } = await setupTouchpad({ dictationRecognizer: recognizer });

    micButton(fixture)!.click();
    fixture.destroy();

    expect(recognizer.stopped).toBe(true);
  });
});

function fakeLocation(url: string): ServerLocation {
  const parsedUrl = new URL(url);

  return {
    protocol: parsedUrl.protocol,
    hostname: parsedUrl.hostname,
    port: parsedUrl.port,
    origin: parsedUrl.origin,
    assign: () => undefined,
  };
}

async function setupTouchpad(
  options: {
    readonly sensitivity?: number;
    readonly stored?: Readonly<Record<string, string>>;
    readonly dictationRecognizer?: MockSpeechRecognizer;
    readonly pageUrl?: string;
  } = {},
): Promise<TouchpadHarness> {
  const sockets: MockRemoteSocket[] = [];
  const storage = new MemoryStorage();
  const rafCallbacks: FrameRequestCallback[] = [];

  if (options.sensitivity !== undefined) {
    storage.setItem(MOUSE_SENSITIVITY_STORAGE_KEY, String(options.sensitivity));
  }

  for (const [key, value] of Object.entries(options.stored ?? {})) {
    storage.setItem(key, value);
  }

  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    rafCallbacks.push(callback);
    return rafCallbacks.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);

  await TestBed.configureTestingModule({
    imports: [TouchpadComponent],
    providers: [
      RemoteService,
      { provide: REMOTE_STORAGE, useValue: storage },
      { provide: REMOTE_AUTO_CONNECT, useValue: false },
      {
        provide: REMOTE_WEBSOCKET_FACTORY,
        useValue: (url: string) => {
          const socket = new MockRemoteSocket(url);
          sockets.push(socket);
          return socket;
        },
      },
      {
        provide: SPEECH_RECOGNIZER_FACTORY,
        useValue: () => options.dictationRecognizer ?? null,
      },
      {
        provide: SERVER_LOCATION,
        useValue: fakeLocation(options.pageUrl ?? 'http://localhost:5050/'),
      },
    ],
  }).compileComponents();

  const remote = TestBed.inject(RemoteService);
  remote.connect();
  sockets[0].open();

  const fixture = TestBed.createComponent(TouchpadComponent);
  fixture.detectChanges();
  await fixture.whenStable();

  const surface = fixture.nativeElement.querySelector('.touchpad-surface') as HTMLElement | null;

  if (surface === null) {
    throw new Error('Touchpad surface not found');
  }

  stubPointerCapture(surface);

  return {
    fixture,
    surface,
    sockets,
    flushRaf: () => {
      const callbacks = rafCallbacks.splice(0, rafCallbacks.length);

      for (const callback of callbacks) {
        callback(performance.now());
      }

      fixture.detectChanges();
    },
  };
}

function mouseButton(
  fixture: ReturnType<typeof TestBed.createComponent<TouchpadComponent>>,
  ariaLabel: string,
): HTMLButtonElement {
  const root = fixture.nativeElement as HTMLElement;
  const button = root.querySelector<HTMLButtonElement>(`button[aria-label="${ariaLabel}"]`);

  if (button === null) {
    throw new Error(`Button with aria-label "${ariaLabel}" not found`);
  }

  stubPointerCapture(button);
  return button;
}

function micButton(
  fixture: ReturnType<typeof TestBed.createComponent<TouchpadComponent>>,
): HTMLButtonElement | null {
  const root = fixture.nativeElement as HTMLElement;
  return root.querySelector<HTMLButtonElement>('.touchpad-text__mic');
}

function dictationErrorMessage(
  fixture: ReturnType<typeof TestBed.createComponent<TouchpadComponent>>,
): string | null {
  const root = fixture.nativeElement as HTMLElement;
  return root.querySelector('.settings-message')?.textContent?.trim() ?? null;
}

function stubPointerCapture(element: HTMLElement): void {
  Object.defineProperty(element, 'setPointerCapture', {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(element, 'releasePointerCapture', {
    configurable: true,
    value: () => undefined,
  });
}

// Standardmäßig 100 ms zwischen Events: langsam genug, dass die Zeiger-Beschleunigung in
// Tests ohne eigenen timeStamp nicht greift.
let pointerClock = 0;

function dispatchPointer(
  target: HTMLElement,
  type: string,
  init: {
    readonly pointerId: number;
    readonly clientX: number;
    readonly clientY: number;
    readonly timeStamp?: number;
  },
): void {
  const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
  pointerClock = init.timeStamp ?? pointerClock + 100;

  Object.defineProperties(event, {
    pointerId: { value: init.pointerId },
    clientX: { value: init.clientX },
    clientY: { value: init.clientY },
    pointerType: { value: 'touch' },
    timeStamp: { value: pointerClock },
  });

  target.dispatchEvent(event);
}

function useFakeTapTimers(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
}

function textControls(fixture: ReturnType<typeof TestBed.createComponent<TouchpadComponent>>): {
  readonly textInput: HTMLInputElement;
  readonly liveSwitch: HTMLButtonElement;
  readonly form: HTMLFormElement;
} {
  const root = fixture.nativeElement as HTMLElement;
  const textInput = root.querySelector<HTMLInputElement>('.touchpad-text__input');
  const liveSwitch = root.querySelector<HTMLButtonElement>(
    '.touchpad-text [role="switch"]:not(.touchpad-text__mic)',
  );
  const form = root.querySelector<HTMLFormElement>('.touchpad-text');

  if (textInput === null || liveSwitch === null || form === null) {
    throw new Error('Text controls not found');
  }

  return { textInput, liveSwitch, form };
}

function typeInto(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
