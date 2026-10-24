import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { ButtonEditorDialogComponent } from './button-editor-dialog.component';
import { BUTTON_ID_FACTORY, ButtonLayoutService } from './button-layout.service';
import { REMOTE_STORAGE, RemoteService } from './remote.service';

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

// Ein PC mit Voicemeeter und einer App mit Ton - nur, was der Editor davon liest.
function pcWithAudio(): object {
  return {
    voicemeeterAvailable: signal(true),
    voicemeeter: signal({
      type: 'voicemeeter',
      channels: [{ id: 'Strip[0]', name: 'Mikrofon', muted: false, gain: 0 }],
      routes: ['A1'],
    }),
    systemStatsSupported: signal(true),
    apps: signal({ type: 'apps', apps: [{ id: '4711', name: 'Spotify', volume: 80, muted: false }] }),
    watchVoicemeeter: () => undefined,
    watchApps: () => undefined,
    readLaunchApps: () => Promise.resolve(['Steam']),
  };
}

async function setupDialog(
  targetId: string | null = null,
  remote?: object,
): Promise<{
  readonly fixture: ReturnType<typeof TestBed.createComponent<ButtonEditorDialogComponent>>;
  readonly root: HTMLElement;
  readonly layout: ButtonLayoutService;
}> {
  await TestBed.configureTestingModule({
    imports: [ButtonEditorDialogComponent],
    providers: [
      { provide: REMOTE_STORAGE, useValue: new MemoryStorage() },
      { provide: BUTTON_ID_FACTORY, useValue: () => 'custom:test1' },
      ...(remote === undefined ? [] : [{ provide: RemoteService, useValue: remote }]),
    ],
  }).compileComponents();

  const layout = TestBed.inject(ButtonLayoutService);
  const fixture = TestBed.createComponent(ButtonEditorDialogComponent);
  fixture.componentRef.setInput('targetId', targetId);
  fixture.detectChanges();
  await fixture.whenStable();

  return { fixture, root: fixture.nativeElement as HTMLElement, layout };
}

function keyChip(root: HTMLElement, key: string): HTMLButtonElement {
  const chip = Array.from(root.querySelectorAll<HTMLButtonElement>('.key-chip')).find(
    (candidate) => candidate.textContent?.trim() === key,
  );

  if (chip === undefined) {
    throw new Error(`Key chip not found: ${key}`);
  }

  return chip;
}

function saveButton(root: HTMLElement): HTMLButtonElement {
  const button = root.querySelector<HTMLButtonElement>('button[type="submit"]');

  if (button === null) {
    throw new Error('Save button not found');
  }

  return button;
}

function queryButtonByText(root: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) => candidate.textContent?.trim() === text,
  );

  if (button === undefined) {
    throw new Error(`Button not found: ${text}`);
  }

  return button;
}

function stepSummaries(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll<HTMLElement>('.macro-step__summary')).map(
    (element) => element.textContent?.trim().replace(/\s+/g, ' ') ?? '',
  );
}

function setField(root: HTMLElement, label: string, value: string): void {
  const field = Array.from(root.querySelectorAll<HTMLLabelElement>('label.field')).find(
    (candidate) => candidate.querySelector('span')?.textContent?.trim() === label,
  );
  const control = field?.querySelector<HTMLInputElement | HTMLSelectElement>('input, select');
  if (control == null) throw new Error(`Field not found: ${label}`);
  control.value = value;
  control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input'));
}

function setLabel(root: HTMLElement, label: string): void {
  const labelInput = root.querySelector<HTMLInputElement>('#button-label');
  if (labelInput === null) throw new Error('label input not found');
  labelInput.value = label;
  labelInput.dispatchEvent(new Event('input'));
}

function addKeysStep(root: HTMLElement, fixture: { detectChanges(): void }, keys: readonly string[]): void {
  for (const key of keys) {
    keyChip(root, key).click();
  }
  fixture.detectChanges();
  queryButtonByText(root, 'Schritt hinzufügen').click();
  fixture.detectChanges();
}

describe('ButtonEditorDialogComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('disables save with no steps added', async () => {
    const { root } = await setupDialog();
    expect(saveButton(root).disabled).toBe(true);
  });

  it('disables the add-step button until an action is chosen', async () => {
    const { root, fixture } = await setupDialog();

    expect(queryButtonByText(root, 'Schritt hinzufügen').disabled).toBe(true);

    keyChip(root, 'CTRL').click();
    keyChip(root, 'S').click();
    fixture.detectChanges();

    expect(queryButtonByText(root, 'Schritt hinzufügen').disabled).toBe(false);
  });

  it('toggling a selected chip removes it again before it is added', async () => {
    const { root, fixture } = await setupDialog();

    const ctrlChip = keyChip(root, 'CTRL');
    ctrlChip.click();
    fixture.detectChanges();
    expect(ctrlChip.getAttribute('aria-pressed')).toBe('true');

    ctrlChip.click();
    fixture.detectChanges();
    expect(ctrlChip.getAttribute('aria-pressed')).toBe('false');
  });

  it('adds a keys step to the list and resets the picker', async () => {
    const { root, fixture } = await setupDialog();

    addKeysStep(root, fixture, ['CTRL', 'S']);

    expect(stepSummaries(root)).toEqual(['Hotkey: CTRL + S']);
    expect(keyChip(root, 'CTRL').getAttribute('aria-pressed')).toBe('false');
    expect(keyChip(root, 'S').getAttribute('aria-pressed')).toBe('false');
  });

  it('adds a text step', async () => {
    const { root, fixture } = await setupDialog();

    queryButtonByText(root, 'Text').click();
    fixture.detectChanges();

    const textInput = root.querySelector<HTMLInputElement>('.macro-text-input');
    if (textInput === null) throw new Error('text input not found');
    textInput.value = 'Hallo Welt';
    textInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    queryButtonByText(root, 'Schritt hinzufügen').click();
    fixture.detectChanges();

    expect(stepSummaries(root)).toEqual(['Text: "Hallo Welt"']);
  });

  it('adds a mouse-click step', async () => {
    const { root, fixture } = await setupDialog();

    queryButtonByText(root, 'Klick').click();
    fixture.detectChanges();
    queryButtonByText(root, 'Rechts').click();
    fixture.detectChanges();

    queryButtonByText(root, 'Schritt hinzufügen').click();
    fixture.detectChanges();

    expect(stepSummaries(root)).toEqual(['Klick: rechts']);
  });

  it('shows the configured delay in the step summary', async () => {
    const { root, fixture } = await setupDialog();

    keyChip(root, 'ENTER').click();
    fixture.detectChanges();

    const delayInput = root.querySelector<HTMLInputElement>('input[type="number"]');
    if (delayInput === null) throw new Error('delay input not found');
    delayInput.value = '300';
    delayInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    queryButtonByText(root, 'Schritt hinzufügen').click();
    fixture.detectChanges();

    expect(stepSummaries(root)).toEqual(['+300ms Taste: ENTER']);
  });

  it('adds a Voicemeeter gain step in dB', async () => {
    const { root, fixture } = await setupDialog(null, pcWithAudio());

    queryButtonByText(root, 'Voicemeeter').click();
    fixture.detectChanges();
    setField(root, 'Kanal', 'Strip[0]');
    fixture.detectChanges();
    keyChip(root, 'Lautstärke').click();
    fixture.detectChanges();
    setField(root, 'Lautstärke (dB)', '-6.5');
    fixture.detectChanges();
    queryButtonByText(root, 'Schritt hinzufügen').click();
    fixture.detectChanges();

    expect(stepSummaries(root)).toEqual(['Voicemeeter: Mikrofon · Lautstärke -6.5 dB']);
  });

  it('adds app steps by name: mute toggle and volume', async () => {
    const { root, fixture } = await setupDialog(null, pcWithAudio());

    queryButtonByText(root, 'App').click();
    fixture.detectChanges();
    expect(root.querySelector('datalist option')?.getAttribute('value')).toBe('Spotify');
    setField(root, 'App-Name wie im Mixer', 'Spotify');
    fixture.detectChanges();
    queryButtonByText(root, 'Schritt hinzufügen').click();
    fixture.detectChanges();

    keyChip(root, 'Lautstärke').click();
    fixture.detectChanges();
    setField(root, 'Lautstärke (%)', '30');
    fixture.detectChanges();
    queryButtonByText(root, 'Schritt hinzufügen').click();
    fixture.detectChanges();

    expect(stepSummaries(root)).toEqual([
      'App: Spotify · Stumm umschalten',
      'App: Spotify · 30 %',
    ]);
  });

  it('adds launch steps for an app of the PC and an http(s) address only', async () => {
    const { root, fixture } = await setupDialog(null, pcWithAudio());
    await fixture.whenStable();

    queryButtonByText(root, 'Öffnen').click();
    fixture.detectChanges();
    expect(root.querySelector('#button-editor-launch-apps option')?.getAttribute('value')).toBe(
      'Steam',
    );
    setField(root, 'App wie im Startmenü des PCs', 'Steam');
    fixture.detectChanges();
    queryButtonByText(root, 'Schritt hinzufügen').click();
    fixture.detectChanges();

    keyChip(root, 'Webseite').click();
    fixture.detectChanges();
    setField(root, 'Adresse (http/https)', 'file:///C:/Windows');
    fixture.detectChanges();
    expect(queryButtonByText(root, 'Schritt hinzufügen').disabled).toBe(true);
    setField(root, 'Adresse (http/https)', 'https://www.youtube.com');
    fixture.detectChanges();
    queryButtonByText(root, 'Schritt hinzufügen').click();
    fixture.detectChanges();

    expect(stepSummaries(root)).toEqual(['Öffnen: Steam', 'Öffnen: https://www.youtube.com']);
  });

  it('removes a step', async () => {
    const { root, fixture } = await setupDialog();

    addKeysStep(root, fixture, ['ENTER']);
    addKeysStep(root, fixture, ['ESC']);
    expect(stepSummaries(root)).toEqual(['Taste: ENTER', 'Taste: ESC']);

    queryButtonByText(root, '×').click();
    fixture.detectChanges();

    expect(stepSummaries(root)).toEqual(['Taste: ESC']);
  });

  it('reorders steps with the move buttons', async () => {
    const { root, fixture } = await setupDialog();

    addKeysStep(root, fixture, ['ENTER']);
    addKeysStep(root, fixture, ['ESC']);

    const moveDownButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).filter(
      (button) => button.getAttribute('aria-label') === 'Schritt nach unten',
    );
    moveDownButtons[0].click();
    fixture.detectChanges();

    expect(stepSummaries(root)).toEqual(['Taste: ESC', 'Taste: ENTER']);
  });

  it('enables save once a label and at least one step are set', async () => {
    const { root, fixture } = await setupDialog();

    setLabel(root, 'Speichern');
    addKeysStep(root, fixture, ['CTRL', 'S']);

    expect(saveButton(root).disabled).toBe(false);
  });

  it('saves a new custom button with the configured steps', async () => {
    const { root, fixture, layout } = await setupDialog();

    setLabel(root, 'Speichern');
    addKeysStep(root, fixture, ['CTRL', 'S']);

    saveButton(root).click();

    expect(layout.layout().customButtons).toEqual([
      {
        id: 'custom:test1',
        label: 'Speichern',
        icon: 'key',
        steps: [{ action: { type: 'hotkey', keys: ['CTRL', 'S'] }, delayMs: 0 }],
      },
    ]);
  });

  it('shows a built-in button read-only with its real label, icon and action', async () => {
    const { root } = await setupDialog('up');

    const labelInput = root.querySelector<HTMLInputElement>('#button-label');
    expect(labelInput?.value).toBe('Hoch');
    expect(labelInput?.disabled).toBe(true);

    expect(stepSummaries(root)).toEqual(['Taste: UP']);

    const activeIcon = root.querySelector<HTMLButtonElement>('.icon-picker__option--active');
    expect(activeIcon?.getAttribute('aria-label')).toBe('Symbol: arrow-up');
    expect(activeIcon?.disabled).toBe(true);

    expect(root.querySelector('button[type="submit"]')).toBeNull();
    expect(
      Array.from(root.querySelectorAll('button')).some((b) => b.textContent?.trim() === 'Löschen'),
    ).toBe(false);
    expect(
      Array.from(root.querySelectorAll('button')).some((b) => b.textContent?.trim() === 'Speichern'),
    ).toBe(true);
    expect(root.querySelector('.macro-step-builder')).toBeNull();
    // Auch eingebaute Buttons lassen sich einfärben, nur Beschriftung/Symbol/Schritte bleiben fest.
    expect(root.querySelector('.snap-switch')).not.toBeNull();
  });

  it('lets a built-in button be colored via setButtonColor, leaving its definition untouched', async () => {
    const { root, fixture, layout } = await setupDialog('up');

    const colorSwitch = root.querySelector<HTMLButtonElement>('.snap-switch');
    colorSwitch?.click();
    fixture.detectChanges();

    const colorInput = root.querySelector<HTMLInputElement>('input.color-input');
    expect(colorInput).not.toBeNull();
    colorInput!.value = '#123456';
    colorInput!.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const saveButton = Array.from(root.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Speichern',
    );
    saveButton?.click();

    expect(layout.getButtonColor('up')).toBe('#123456');
  });

  it('renders in edit mode with the existing steps listed and offers delete', async () => {
    const seedLayout = TestBed.configureTestingModule({
      providers: [
        { provide: REMOTE_STORAGE, useValue: new MemoryStorage() },
        { provide: BUTTON_ID_FACTORY, useValue: () => 'custom:test1' },
      ],
    });
    seedLayout.inject(ButtonLayoutService).addCustomButton({
      label: 'Speichern',
      icon: 'key',
      steps: [{ action: { type: 'hotkey', keys: ['CTRL', 'S'] }, delayMs: 0 }],
    });

    const fixture = TestBed.createComponent(ButtonEditorDialogComponent);
    fixture.componentRef.setInput('targetId', 'custom:test1');
    fixture.detectChanges();
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    const labelInput = root.querySelector<HTMLInputElement>('#button-label');

    expect(labelInput?.value).toBe('Speichern');
    expect(stepSummaries(root)).toEqual(['Hotkey: CTRL + S']);
    expect(
      Array.from(root.querySelectorAll('button')).some((b) => b.textContent?.trim() === 'Löschen'),
    ).toBe(true);
  });
});
