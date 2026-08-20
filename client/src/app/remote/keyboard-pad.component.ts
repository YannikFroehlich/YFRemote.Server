import { Component, inject, signal } from '@angular/core';
import { KEY_GROUPS, keysToAction, MAX_HOTKEY_KEYS, MODIFIER_KEYS } from './keyboard-keys';
import { RemoteService } from './remote.service';

@Component({
  selector: 'app-keyboard-pad',
  imports: [],
  templateUrl: './keyboard-pad.component.html',
})
export class KeyboardPadComponent {
  private readonly remote = inject(RemoteService);

  protected readonly keyGroups = KEY_GROUPS;
  protected readonly armedModifiers = signal<readonly string[]>([]);

  protected onKeyTap(key: string): void {
    if (MODIFIER_KEYS.includes(key)) {
      this.toggleModifier(key);
    } else {
      this.pressKey(key);
    }
  }

  protected isModifierArmed(key: string): boolean {
    return this.armedModifiers().includes(key);
  }

  protected isModifierDisabled(key: string): boolean {
    return !this.isModifierArmed(key) && this.armedModifiers().length >= MAX_HOTKEY_KEYS - 1;
  }

  protected isKeyDisabled(key: string): boolean {
    return MODIFIER_KEYS.includes(key) ? this.isModifierDisabled(key) : false;
  }

  protected isKeyActive(key: string): boolean {
    return MODIFIER_KEYS.includes(key) && this.isModifierArmed(key);
  }

  protected clearArmed(): void {
    this.armedModifiers.set([]);
  }

  protected summary(): string {
    const armed = this.armedModifiers();
    return armed.length > 0
      ? `Bereit: ${armed.join(' + ')}`
      : 'Optional: Modifikator wählen, dann Taste antippen.';
  }

  private toggleModifier(modifier: string): void {
    const current = this.armedModifiers();

    if (current.includes(modifier)) {
      this.armedModifiers.set(current.filter((armed) => armed !== modifier));
      return;
    }

    if (current.length >= MAX_HOTKEY_KEYS - 1) {
      return;
    }

    this.armedModifiers.set([...current, modifier]);
  }

  private pressKey(key: string): void {
    const action = keysToAction([...this.armedModifiers(), key]);

    if (action !== null) {
      this.remote.sendAction(action);
    }

    this.armedModifiers.set([]);
  }
}
