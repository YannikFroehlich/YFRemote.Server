import { Component, inject, input, OnInit, output, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  isCustomButtonId,
  MAX_LABEL_LENGTH,
  MAX_MACRO_DELAY_MS,
  MAX_MACRO_STEPS,
  resolveButtonSteps,
} from './button-layout';
import { ButtonLayoutService } from './button-layout.service';
import { KEY_GROUPS, keysToAction, MAX_HOTKEY_KEYS } from './keyboard-keys';
import { REMOTE_ICON_PATHS, REMOTE_ICONS } from './remote-icons';
import { MacroStep, RemoteAction, RemoteIcon } from './remote.models';

const MAX_TEXT_STEP_PREVIEW_LENGTH = 24;

type StepType = 'keys' | 'text' | 'mouseClick';

@Component({
  selector: 'app-button-editor-dialog',
  imports: [ReactiveFormsModule],
  templateUrl: './button-editor-dialog.component.html',
})
export class ButtonEditorDialogComponent implements OnInit {
  private readonly layout = inject(ButtonLayoutService);

  readonly targetId = input<string | null>(null);
  readonly closed = output<void>();

  protected readonly icons = REMOTE_ICONS;
  protected readonly iconPaths = REMOTE_ICON_PATHS;
  protected readonly keyGroups = KEY_GROUPS;
  protected readonly maxKeysPerStep = MAX_HOTKEY_KEYS;
  protected readonly maxSteps = MAX_MACRO_STEPS;
  protected readonly maxDelayMs = MAX_MACRO_DELAY_MS;
  protected readonly maxLabelLength = MAX_LABEL_LENGTH;

  protected readonly isEditing = signal(false);
  /** true, wenn ein eingebauter Button nur betrachtet wird: Icon/Ablauf sind fest im Code
   *  definiert und lassen sich hier nicht speichern. */
  protected readonly isReadOnly = signal(false);
  protected readonly steps = signal<readonly MacroStep[]>([]);

  protected readonly stepType = signal<StepType>('keys');
  protected readonly pendingKeys = signal<readonly string[]>([]);
  protected readonly pendingText = signal('');
  protected readonly pendingMouseButton = signal<'left' | 'right'>('left');
  protected readonly pendingDelayMs = signal(0);

  protected readonly form = new FormGroup({
    label: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(MAX_LABEL_LENGTH)],
    }),
    icon: new FormControl<RemoteIcon>('key', { nonNullable: true }),
  });

  ngOnInit(): void {
    const id = this.targetId();

    if (id === null) {
      return;
    }

    const button = this.layout.getButton(id);

    if (button === undefined) {
      return;
    }

    this.form.patchValue({ label: button.label, icon: button.icon });
    this.steps.set(resolveButtonSteps(button));

    if (isCustomButtonId(id)) {
      this.isEditing.set(true);
    } else {
      this.isReadOnly.set(true);
      this.form.disable();
    }
  }

  protected setStepType(type: StepType): void {
    this.stepType.set(type);
  }

  protected togglePendingKey(key: string): void {
    const current = this.pendingKeys();

    if (current.includes(key)) {
      this.pendingKeys.set(current.filter((selected) => selected !== key));
      return;
    }

    if (current.length >= this.maxKeysPerStep) {
      return;
    }

    this.pendingKeys.set([...current, key]);
  }

  protected isPendingKeySelected(key: string): boolean {
    return this.pendingKeys().includes(key);
  }

  protected isPendingKeyDisabled(key: string): boolean {
    return !this.isPendingKeySelected(key) && this.pendingKeys().length >= this.maxKeysPerStep;
  }

  protected onPendingTextInput(event: Event): void {
    this.pendingText.set((event.target as HTMLInputElement).value);
  }

  protected onPendingDelayInput(event: Event): void {
    const raw = Number((event.target as HTMLInputElement).value);
    const clamped = Number.isFinite(raw) ? Math.min(Math.max(Math.round(raw), 0), this.maxDelayMs) : 0;
    this.pendingDelayMs.set(clamped);
  }

  protected pendingAction(): RemoteAction | null {
    switch (this.stepType()) {
      case 'keys':
        return keysToAction(this.pendingKeys());

      case 'text': {
        const text = this.pendingText().trim();
        return text.length > 0 ? { type: 'text', text } : null;
      }

      case 'mouseClick':
        return { type: 'mouseClick', button: this.pendingMouseButton() };
    }
  }

  protected canAddStep(): boolean {
    return this.pendingAction() !== null && this.steps().length < this.maxSteps;
  }

  protected addStep(): void {
    const action = this.pendingAction();

    if (action === null || this.steps().length >= this.maxSteps) {
      return;
    }

    this.steps.update((current) => [...current, { action, delayMs: this.pendingDelayMs() }]);
    this.pendingKeys.set([]);
    this.pendingText.set('');
    this.pendingDelayMs.set(0);
  }

  protected removeStep(index: number): void {
    this.steps.update((current) => current.filter((_, i) => i !== index));
  }

  protected moveStep(index: number, direction: -1 | 1): void {
    const current = this.steps();
    const target = index + direction;

    if (target < 0 || target >= current.length) {
      return;
    }

    const next = [...current];
    [next[index], next[target]] = [next[target], next[index]];
    this.steps.set(next);
  }

  protected describeStep(action: RemoteAction): string {
    switch (action.type) {
      case 'key':
        return `Taste: ${action.keys[0]}`;

      case 'hotkey':
        return `Hotkey: ${action.keys.join(' + ')}`;

      case 'text':
        return `Text: "${truncate(action.text, MAX_TEXT_STEP_PREVIEW_LENGTH)}"`;

      case 'mouseClick':
        return action.button === 'left' ? 'Klick: links' : 'Klick: rechts';

      default:
        return '';
    }
  }

  protected canSave(): boolean {
    return this.steps().length > 0 && this.form.valid;
  }

  protected close(): void {
    this.closed.emit();
  }

  protected save(): void {
    this.form.markAllAsTouched();
    const steps = this.steps();

    if (this.form.invalid || steps.length === 0) {
      return;
    }

    const draft = {
      label: this.form.controls.label.value.trim(),
      icon: this.form.controls.icon.value,
      steps,
    };

    const id = this.targetId();
    const saved =
      id === null ? this.layout.addCustomButton(draft) : this.layout.updateCustomButton(id, draft);

    if (saved) {
      this.closed.emit();
    }
  }

  protected delete(): void {
    const id = this.targetId();

    if (id === null) {
      return;
    }

    this.layout.deleteCustomButton(id);
    this.closed.emit();
  }

  protected hasLabelError(): boolean {
    const control = this.form.controls.label;
    return control.invalid && (control.dirty || control.touched);
  }
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}
