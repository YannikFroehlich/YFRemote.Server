import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { hexToHsv, Hsv, hsvToHex, parseHexColor } from './color';
import { REMOTE_ICON_PATHS } from './remote-icons';
import { TranslationService } from './translation.service';

/** Akzentfarben der App plus Signal- und Grundfarben, als schneller Einstieg. */
const PRESETS = [
  '#38bdf8',
  '#3b82f6',
  '#6366f1',
  '#a855f7',
  '#ec4899',
  '#f87171',
  '#fb923c',
  '#fbbf24',
  '#4ade80',
  '#2dd4bf',
  '#e8eef8',
  '#0b1220',
] as const;

const KEY_STEP = 0.01;
const KEY_STEP_LARGE = 0.1;
/** Etwas laenger als die Ausblend-Animation in styles.scss (200 ms). */
const CLOSE_TIMEOUT_MS = 250;

/**
 * Eigener Farbwaehler statt <input type="color">: dessen Dialog ist auf Android ein grauer
 * System-Dialog mit acht festen Farben. Ein natives <dialog> mit showModal() liegt in der Top
 * Layer und damit ueber jedem anderen Dialog, egal wie tief die Komponente steckt.
 */
@Component({
  selector: 'app-color-picker',
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './color-picker.component.html',
})
export class ColorPickerComponent {
  protected readonly i18n = inject(TranslationService);

  readonly value = input.required<string>();
  /** Beschriftung des Farbfelds fuer Screenreader, z. B. "Akzentfarbe". */
  readonly label = input<string>('');
  readonly changed = output<string>();

  protected readonly iconPaths = REMOTE_ICON_PATHS;
  protected readonly presets = PRESETS;
  /** null = geschlossen; der Dialoginhalt wird nur waehrend der Auswahl gerendert. */
  protected readonly draft = signal<Hsv | null>(null);
  protected readonly hex = computed(() => {
    const draft = this.draft();
    return draft === null ? this.value() : hsvToHex(draft);
  });

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly area = viewChild<ElementRef<HTMLElement>>('area');

  protected open(): void {
    const dialog = this.dialog().nativeElement;
    if (dialog.open) {
      return;
    }
    this.draft.set(hexToHsv(this.value()));
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  protected apply(): void {
    this.changed.emit(this.hex());
    this.close();
  }

  /** Blendet erst aus und schliesst dann; ohne laufende Animation (Tests) sofort. Die Zeitgrenze
   *  greift, wenn der Browser Animationen anhaelt (Tab im Hintergrund) - wie bei animate.leave. */
  protected close(): void {
    const dialog = this.dialog().nativeElement;
    dialog.classList.add('color-picker--closing');
    const animations = dialog.getAnimations?.() ?? [];
    void Promise.race([
      Promise.allSettled(animations.map((animation) => animation.finished)),
      new Promise((resolve) => setTimeout(resolve, CLOSE_TIMEOUT_MS)),
    ]).then(() => {
      dialog.classList.remove('color-picker--closing');
      if (typeof dialog.close === 'function') {
        dialog.close();
      } else {
        dialog.removeAttribute('open');
      }
      this.draft.set(null);
    });
  }

  /** Esc: ebenfalls mit Animation statt des sofortigen Schliessens durch den Browser. */
  protected onCancel(event: Event): void {
    event.preventDefault();
    this.close();
  }

  /** Ein Klick auf den abgedunkelten Hintergrund trifft das <dialog> selbst, nicht seinen Inhalt. */
  protected onDialogClick(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) {
      this.close();
    }
  }

  protected pick(hex: string): void {
    this.draft.set(hexToHsv(hex));
  }

  protected setHue(event: Event): void {
    const h = Number((event.target as HTMLInputElement).value);
    this.draft.update((draft) => (draft === null ? draft : { ...draft, h }));
  }

  /** Waehrend des Tippens nur vollstaendige sechsstellige Werte uebernehmen, sonst wuerde "#38b"
   *  sofort zu "#3388bb" umgeschrieben. */
  protected onHexInput(event: Event): void {
    const text = (event.target as HTMLInputElement).value.trim();
    const hex = text.replace('#', '').length === 6 ? parseHexColor(text) : null;
    if (hex !== null) {
      this.pick(hex);
    }
  }

  /** Beim Verlassen des Felds auch Kurzformen annehmen; Ungueltiges zeigt wieder den aktuellen Wert. */
  protected onHexChange(event: Event): void {
    const field = event.target as HTMLInputElement;
    const hex = parseHexColor(field.value);
    if (hex !== null) {
      this.pick(hex);
    }
    field.value = this.hex();
  }

  protected areaPointerDown(event: PointerEvent): void {
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    this.moveTo(event);
  }

  protected areaPointerMove(event: PointerEvent): void {
    if ((event.currentTarget as HTMLElement).hasPointerCapture?.(event.pointerId)) {
      this.moveTo(event);
    }
  }

  protected areaKeyDown(event: KeyboardEvent): void {
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const move = delta[event.key];
    if (move === undefined) {
      return;
    }
    event.preventDefault();
    this.draft.update((draft) =>
      draft === null
        ? draft
        : { ...draft, s: clamp(draft.s + move[0]), v: clamp(draft.v + move[1]) },
    );
  }

  private moveTo(event: PointerEvent): void {
    const rect = this.area()?.nativeElement.getBoundingClientRect();
    if (rect === undefined || rect.width === 0 || rect.height === 0) {
      return;
    }
    const s = clamp((event.clientX - rect.left) / rect.width);
    const v = clamp(1 - (event.clientY - rect.top) / rect.height);
    this.draft.update((draft) => (draft === null ? draft : { ...draft, s, v }));
  }
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}
