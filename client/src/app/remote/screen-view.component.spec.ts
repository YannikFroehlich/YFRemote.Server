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
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:frame');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      imports: [ScreenViewComponent],
      providers: [{ provide: RemoteService, useValue: { readScreen } }],
    });
    const fixture = TestBed.createComponent(ScreenViewComponent);
    await vi.waitFor(() => expect(readScreen).toHaveBeenCalled());
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  it('shows the fetched frame and releases it when closed', async () => {
    const { fixture, element } = await setup(new Blob(['jpeg'], { type: 'image/jpeg' }));

    expect(element.querySelector('img')?.getAttribute('src')).toBe('blob:frame');
    fixture.destroy();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:frame');
  });

  it('explains a blocked secure desktop', async () => {
    const { fixture, element } = await setup('blocked');

    expect(element.textContent).toContain('Sperrbildschirm');
    fixture.destroy();
  });
});
