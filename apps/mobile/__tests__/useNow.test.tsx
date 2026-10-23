import { act, renderHook } from '@testing-library/react-native';
import { useMinuteNow } from '../src/design/useNow';

describe('useMinuteNow', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-03T05:00:20Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('ticks on the full minute, not every few seconds, and then every minute', async () => {
    const { result } = await renderHook(() => useMinuteNow());
    expect(result.current.toISOString()).toBe('2026-11-03T05:00:20.000Z');
    await act(async () => {
      jest.advanceTimersByTime(30_000); // 05:00:50: still the first minute
    });
    expect(result.current.toISOString()).toBe('2026-11-03T05:00:20.000Z');
    await act(async () => {
      jest.advanceTimersByTime(11_000); // 05:01:01: past the minute turn
    });
    expect(result.current.toISOString()).toBe('2026-11-03T05:01:00.050Z');
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(result.current.toISOString()).toBe('2026-11-03T05:02:00.050Z');
  });

  it('stops ticking when the screen goes away', async () => {
    const { result, unmount } = await renderHook(() => useMinuteNow());
    const before = result.current.getTime();
    await unmount();
    await act(async () => {
      jest.advanceTimersByTime(5 * 60_000);
    });
    expect(result.current.getTime()).toBe(before);
  });
});
