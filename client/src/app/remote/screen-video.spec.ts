import { findMediaSource, MediaSourceConstructor } from './screen-video';

describe('findMediaSource', () => {
  const source = (supported: boolean) =>
    Object.assign(function FakeSource() {}, {
      isTypeSupported: () => supported,
    }) as unknown as MediaSourceConstructor;

  it('takes MediaSource where the browser has it', () => {
    const MediaSource = source(true);
    expect(findMediaSource({ MediaSource, ManagedMediaSource: source(true) })).toBe(MediaSource);
  });

  it('falls back to ManagedMediaSource, the only one Safari on the iPhone has', () => {
    const ManagedMediaSource = source(true);
    expect(findMediaSource({ ManagedMediaSource })).toBe(ManagedMediaSource);
    expect(findMediaSource({ MediaSource: source(false), ManagedMediaSource })).toBe(
      ManagedMediaSource,
    );
  });

  it('gives up without H.264 support, so the screen view stays on JPEG', () => {
    expect(findMediaSource({})).toBeNull();
    expect(findMediaSource({ ManagedMediaSource: source(false) })).toBeNull();
  });
});
