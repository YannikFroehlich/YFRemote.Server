import { Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAX_LABEL_LENGTH } from './button-layout';
import { ButtonLayoutService } from './button-layout.service';
import { KEY_GROUPS, keysToAction, MAX_HOTKEY_KEYS } from './keyboard-keys';
import { REMOTE_ICON_PATHS, REMOTE_ICONS } from './remote-icons';
import { RemoteIcon } from './remote.models';

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
  protected readonly maxKeys = MAX_HOTKEY_KEYS;
  protected readonly maxLabelLength = MAX_LABEL_LENGTH;

  protected readonly isEditing = signal(false);
  protected readonly selectedKeys = signal<readonly string[]>([]);

  protected readonly form = new FormGroup({
    label: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(MAX_LABEL_LENGTH)],
    }),
    icon: new FormControl<RemoteIcon>('key', { nonNullable: true }),
  });

  protected readonly derivedAction = computed(() => keysToAction(this.selectedKeys()));

  ngOnInit(): void {
    const id = this.targetId();

    if (id === null) {
      return;
    }

    const existing = this.layout
      .layout()
      .customButtons.find((definition) => definition.id === id);

    if (existing === undefined) {
      return;
    }

    this.isEditing.set(true);
    this.form.patchValue({ label: existing.label, icon: existing.icon ?? 'key' });
    this.selectedKeys.set(existing.action.keys);
  }

  protected toggleKey(key: string): void {
    const current = this.selectedKeys();

    if (current.includes(key)) {
      this.selectedKeys.set(current.filter((selected) => selected !== key));
      return;
    }

    if (current.length >= this.maxKeys) {
      return;
    }

    this.selectedKeys.set([...current, key]);
  }

  protected isKeySelected(key: string): boolean {
    return this.selectedKeys().includes(key);
  }

  protected isKeyDisabled(key: string): boolean {
    return !this.isKeySelected(key) && this.selectedKeys().length >= this.maxKeys;
  }

  /**
   * Plain method rather than a computed signal: it mixes a signal (derivedAction) with
   * FormGroup.valid, which is not itself a signal, so a computed() would only re-evaluate
   * when the key selection changes and could get stuck stale after a label-only edit.
   * Angular re-evaluates template method calls on every change detection pass regardless.
   */
  protected canSave(): boolean {
    return this.derivedAction() !== null && this.form.valid;
  }

  protected actionLabel(): string {
    const action = this.derivedAction();

    if (action === null) {
      return 'Wähle mindestens eine Taste.';
    }

    return action.type === 'key' ? `Taste: ${action.keys[0]}` : `Hotkey: ${action.keys.join(' + ')}`;
  }

  protected close(): void {
    this.closed.emit();
  }

  protected save(): void {
    this.form.markAllAsTouched();
    const action = this.derivedAction();

    if (this.form.invalid || action === null) {
      return;
    }

    const draft = {
      label: this.form.controls.label.value.trim(),
      icon: this.form.controls.icon.value,
      keys: action.keys,
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
