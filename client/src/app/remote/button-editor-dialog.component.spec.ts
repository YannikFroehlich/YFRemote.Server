import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { ButtonEditorDialogComponent } from './button-editor-dialog.component';
import { BUTTON_ID_FACTORY, ButtonLayoutService } from './button-layout.service';
import { REMOTE_STORAGE } from './remote.service';

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

async function setupDialog(targetId: string | null = null): Promise<{
  readonly fixture: ReturnType<typeof TestBed.createComponent<ButtonEditorDialogComponent>>;
  readonly root: HTMLElement;
  readonly layout: ButtonLayoutService;
}> {
  await TestBed.configureTestingModule({
    imports: [ButtonEditorDialogComponent],
    providers: [
      { provide: REMOTE_STORAGE, useValue: new MemoryStorage() },
      { provide: BUTTON_ID_FACTORY, useValue: () => 'custom:test1' },
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

describe('ButtonEditorDialogComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('disables save with no keys selected', async () => {
    const { root } = await setupDialog();
    expect(saveButton(root).disabled).toBe(true);
  });

  it('disables save with an empty label even if keys are valid', async () => {
    const { root, fixture } = await setupDialog();

    keyChip(root, 'CTRL').click();
    keyChip(root, 'S').click();
    fixture.detectChanges();

    expect(saveButton(root).disabled).toBe(true);
  });

  it('enables save once a label and at least one key are set', async () => {
    const { root, fixture } = await setupDialog();

    const labelInput = root.querySelector<HTMLInputElement>('#button-label');
    if (labelInput === null) throw new Error('label input not found');
    labelInput.value = 'Speichern';
    labelInput.dispatchEvent(new Event('input'));

    keyChip(root, 'CTRL').click();
    keyChip(root, 'S').click();
    fixture.detectChanges();

    expect(saveButton(root).disabled).toBe(false);
  });

  it('toggling a selected chip removes it again', async () => {
    const { root, fixture } = await setupDialog();

    const ctrlChip = keyChip(root, 'CTRL');
    ctrlChip.click();
    fixture.detectChanges();
    expect(ctrlChip.getAttribute('aria-pressed')).toBe('true');

    ctrlChip.click();
    fixture.detectChanges();
    expect(ctrlChip.getAttribute('aria-pressed')).toBe('false');
  });

  it('saves a new custom button with the selected keys', async () => {
    const { root, fixture, layout } = await setupDialog();

    const labelInput = root.querySelector<HTMLInputElement>('#button-label');
    if (labelInput === null) throw new Error('label input not found');
    labelInput.value = 'Speichern';
    labelInput.dispatchEvent(new Event('input'));

    keyChip(root, 'CTRL').click();
    keyChip(root, 'S').click();
    fixture.detectChanges();

    saveButton(root).click();

    expect(layout.layout().customButtons).toEqual([
      { id: 'custom:test1', label: 'Speichern', icon: 'key', action: { type: 'hotkey', keys: ['CTRL', 'S'] } },
    ]);
  });

  it('renders in edit mode with the existing definition prefilled and offers delete', async () => {
    const seedLayout = TestBed.configureTestingModule({
      providers: [
        { provide: REMOTE_STORAGE, useValue: new MemoryStorage() },
        { provide: BUTTON_ID_FACTORY, useValue: () => 'custom:test1' },
      ],
    });
    seedLayout.inject(ButtonLayoutService).addCustomButton({
      label: 'Speichern',
      icon: 'key',
      keys: ['CTRL', 'S'],
    });

    const fixture = TestBed.createComponent(ButtonEditorDialogComponent);
    fixture.componentRef.setInput('targetId', 'custom:test1');
    fixture.detectChanges();
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    const labelInput = root.querySelector<HTMLInputElement>('#button-label');

    expect(labelInput?.value).toBe('Speichern');
    expect(keyChip(root, 'CTRL').getAttribute('aria-pressed')).toBe('true');
    expect(keyChip(root, 'S').getAttribute('aria-pressed')).toBe('true');
    expect(
      Array.from(root.querySelectorAll('button')).some((b) => b.textContent?.trim() === 'Löschen'),
    ).toBe(true);
  });
});
