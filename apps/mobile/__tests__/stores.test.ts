import { DEV_PUSH_TOKEN_PREFIX, MAX_ADDRESSES } from '@struja/shared';
import { useAddresses } from '../src/store/addresses';
import { useSettings } from '../src/store/settings';
import { memoryStorage, setStorage, storage } from '../src/store/storage';

beforeEach(() => {
  setStorage(memoryStorage());
  useAddresses.setState({ items: [] });
});

describe('addresses', () => {
  const req = (streetId: number) => ({ city: 'nis', streetId });

  it('keeps at most three, the first is primary', () => {
    const a = useAddresses.getState();
    expect(a.add('a', req(1))).toBe(true);
    expect(a.add('b', req(2))).toBe(true);
    expect(a.add('c', req(3))).toBe(true);
    expect(a.add('d', req(4))).toBe(false);
    const items = useAddresses.getState().items;
    expect(items).toHaveLength(MAX_ADDRESSES);
    expect(items.map((i) => !!i.request.isPrimary)).toEqual([true, false, false]);
  });

  it('moves primary on request and when the primary is removed', () => {
    const s = useAddresses.getState();
    s.add('a', req(1));
    s.add('b', req(2));
    s.setPrimary('b');
    expect(useAddresses.getState().items.map((i) => !!i.request.isPrimary)).toEqual([false, true]);
    useAddresses.getState().remove('b');
    expect(useAddresses.getState().items.map((i) => !!i.request.isPrimary)).toEqual([true]);
  });

  it('persists to the key-value store', () => {
    useAddresses.getState().add('a', req(1));
    expect(storage().getString('addresses')).toContain('"localId":"a"');
  });
});

describe('settings', () => {
  it('has defaults: Latin Serbian, all notification kinds, default quiet hours', () => {
    const s = useSettings.getState();
    expect(s).toMatchObject({
      language: 'sr',
      script: 'latn',
      themeMode: 'system',
      onboarded: false,
    });
    expect(s.enabledKinds).toEqual(['new', 'evening_before', 'changed', 'cancelled']);
    expect(s.quietHours).toEqual({ start: '22:00', end: '07:00' });
  });

  it('persists changes', () => {
    useSettings.getState().set({ script: 'cyrl' });
    expect(useSettings.getState().script).toBe('cyrl');
    expect(storage().getString('settings')).toContain('"script":"cyrl"');
  });
});

describe('development token format', () => {
  it('is not an Expo push token', () => {
    expect(DEV_PUSH_TOKEN_PREFIX.startsWith('ExponentPushToken')).toBe(false);
  });
});
