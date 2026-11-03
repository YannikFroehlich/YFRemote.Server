import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteService } from './remote.service';
import { ScreenViewComponent } from './screen-view.component';

describe('ScreenViewComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  async function setup(result: Blob | 'blocked' | null) {
    const readScreen = vi.fn(async () => result);
    const sendAction = vi.fn();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:frame');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      imports: [ScreenViewComponent],
      providers: [{ provide: RemoteService, useValue: { readScreen, sendAction } }],
    });
    const fixture = TestBed.createComponent(ScreenViewComponent);
    await vi.waitFor(() => expect(readScreen).toHaveBeenCalled());
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, sendAction, element: fixture.nativeElement as HTMLElement };
  }

  it('shows the fetched frame and releases it when closed', async () => {
    const { fixture, element } = await setup(new Blob(['jpeg'], { type: 'image/jpeg' }));

    expect(element.querySelector('img')?.getAttribute('src')).toBe('blob:frame');
    fixture.destroy();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:frame');
  });

  it('clicks at the tapped spot, right on a long press', async () => {
    const { fixture, sendAction, element } = await setup(new Blob(['jpeg']));
    const image = element.querySelector('img')!;
    image.getBoundingClientRect = () => ({ left: 10, top: 20, width: 200, height: 100 }) as DOMRect;

    image.dispatchEvent(new MouseEvent('click', { clientX: 60, clientY: 120 }));
    image.dispatchEvent(
      new MouseEvent('contextmenu', { clientX: 500, clientY: 20, cancelable: true }),
    );

    expect(sendAction.mock.calls).toEqual([
      [{ type: 'screenClick', x: 0.25, y: 1, button: 'left' }],
      [{ type: 'screenClick', x: 1, y: 0, button: 'right' }],
    ]);
    fixture.destroy();
  });

  it('explains a blocked secure desktop', async () => {
    const { fixture, element } = await setup('blocked');

    expect(element.textContent).toContain('Sperrbildschirm');
    fixture.destroy();
  });
});
