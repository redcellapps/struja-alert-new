import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { SubscriptionDto } from '@struja/shared';
import { forgetDevice, type SecretStore } from '../src/api/device';
import { StyleSheet } from 'react-native';
import { Button, Screen, SheetHeader, shiftTime, TimeStepper } from '../src/design/components';
import { buildTheme, ThemeProvider } from '../src/design/theme';
import { initI18n } from '../src/i18n';
import { deleteAddress, makePrimary, matchOf } from '../src/settings/addresses';
import { deleteEverything, type DeleteDeps } from '../src/settings/deleteData';
import {
  SettingsView,
  type SettingsAddress,
  type SettingsViewProps,
} from '../src/settings/SettingsView';
import { deviceBody, syncDevice } from '../src/settings/sync';
import { useAddresses } from '../src/store/addresses';
import { DEFAULT_SETTINGS, useSettings } from '../src/store/settings';
import { memoryStorage } from '../src/store/storage';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

beforeAll(async () => {
  await initI18n('sr', 'latn');
});

const themed = (ui: React.ReactElement) =>
  render(<ThemeProvider override={buildTheme('dark')}>{ui}</ThemeProvider>);

describe('TimeStepper', () => {
  it('moves half an hour at a time, around midnight', () => {
    expect(shiftTime('22:00', 1)).toBe('22:30');
    expect(shiftTime('23:30', 1)).toBe('00:00');
    expect(shiftTime('00:00', -1)).toBe('23:30');
    expect(shiftTime('07:00', -2)).toBe('06:00');
  });

  it('has a minus and a plus, each spoken with what it moves, and is adjustable for TalkBack', async () => {
    const onChange = jest.fn();
    await themed(<TimeStepper label="Od" value="22:00" onChange={onChange} />);
    await fireEvent.press(screen.getByLabelText('Od: pola sata kasnije'));
    expect(onChange).toHaveBeenLastCalledWith('22:30');
    await fireEvent.press(screen.getByLabelText('Od: pola sata ranije'));
    expect(onChange).toHaveBeenLastCalledWith('21:30');
    const row = screen.getByLabelText('Od 22:00');
    await fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(onChange).toHaveBeenLastCalledWith('22:30');
  });
});

describe('Button danger', () => {
  it('is a full-width button that presses like any other', async () => {
    const onPress = jest.fn();
    await themed(<Button label="Obriši sve" variant="danger" onPress={onPress} />);
    await fireEvent.press(screen.getByLabelText('Obriši sve'));
    expect(onPress).toHaveBeenCalled();
  });
});

const home: SettingsAddress = {
  id: 1,
  label: 'Kuća',
  name: 'Vojvode Mišića 34',
  primary: true,
  canHaveNumber: true,
  hasNumber: true,
};
const work: SettingsAddress = {
  id: 2,
  label: 'Posao',
  name: 'Bulevar Nemanjića',
  primary: false,
  canHaveNumber: true,
  hasNumber: false,
};

const props = (over: Partial<SettingsViewProps> = {}): SettingsViewProps => ({
  values: {
    themeMode: 'system',
    language: 'sr',
    script: 'latn',
    highContrast: false,
    enabledKinds: ['new', 'evening_before', 'changed', 'cancelled'],
    quietHours: { start: '22:00', end: '07:00' },
  },
  onChange: jest.fn(),
  permission: 'granted',
  onOpenSystemSettings: jest.fn(),
  exactAlarms: 'allowed',
  onRequestExactAlarms: jest.fn(),
  vendorCard: false,
  onOpenAppLaunch: jest.fn(),
  addresses: [home, work],
  addressesState: 'ready',
  onRetryAddresses: jest.fn(),
  offline: false,
  canAdd: true,
  onAdd: jest.fn(),
  onEditNumber: jest.fn(),
  onMakePrimary: jest.fn().mockResolvedValue(undefined),
  onDeleteAddress: jest.fn().mockResolvedValue(undefined),
  onDeleteAll: jest.fn().mockResolvedValue(undefined),
  onSendFeedback: jest.fn().mockResolvedValue({ id: 1 }),
  onOpenEds: jest.fn(),
  version: '1.2.3',
  ...over,
});
const show = (p: SettingsViewProps) => themed(<SettingsView {...p} />);

describe('SettingsView: appearance', () => {
  it('changes the script, the language, the theme and the contrast', async () => {
    const p = props();
    await show(p);
    await fireEvent.press(screen.getByLabelText('Ћирилица'));
    expect(p.onChange).toHaveBeenLastCalledWith({ script: 'cyrl' });
    await fireEvent.press(screen.getByLabelText('English'));
    expect(p.onChange).toHaveBeenLastCalledWith({ language: 'en' });
    await fireEvent.press(screen.getByLabelText('Tamna'));
    expect(p.onChange).toHaveBeenLastCalledWith({ themeMode: 'dark' });
    await fireEvent.press(screen.getByLabelText(/^Visok kontrast/));
    expect(p.onChange).toHaveBeenLastCalledWith({ highContrast: true });
    expect(screen.getByLabelText('Latinica').props.accessibilityState.checked).toBe(true);
  });
});

describe('SettingsView: notifications', () => {
  it('switches the kinds one by one, keeping the others in their fixed order', async () => {
    const p = props({
      values: { ...props().values, enabledKinds: ['new', 'changed'] },
    });
    await show(p);
    await fireEvent.press(screen.getByLabelText('Podsetnik uveče'));
    expect(p.onChange).toHaveBeenLastCalledWith({
      enabledKinds: ['new', 'evening_before', 'changed'],
    });
    await fireEvent.press(screen.getByLabelText('Nova isključenja'));
    expect(p.onChange).toHaveBeenLastCalledWith({ enabledKinds: ['changed'] });
  });

  it('shows the permission: on, or off with a button that opens the system settings', async () => {
    const { unmount } = await show(props({ permission: 'granted' }));
    expect(screen.getByText('Obaveštenja su uključena')).toBeTruthy();
    await unmount();
    const p = props({ permission: 'denied' });
    await show(p);
    await fireEvent.press(screen.getByLabelText('Uključi'));
    expect(p.onOpenSystemSettings).toHaveBeenCalled();
  });

  it('offers exact alarms only while they are not allowed, and the HONOR card only on those phones', async () => {
    const { unmount } = await show(props({ exactAlarms: 'allowed' }));
    expect(screen.queryByTestId('exact-alarms-row')).toBeNull();
    expect(screen.queryByTestId('vendor-card')).toBeNull();
    await unmount();

    const p = props({ exactAlarms: 'denied', vendorCard: true });
    await show(p);
    expect(screen.getByTestId('exact-alarms-row')).toBeTruthy();
    expect(screen.getByText('Alarm za početak isključenja')).toBeTruthy();
    await fireEvent.press(screen.getAllByText('Dozvoli tačne alarme')[0]!);
    expect(p.onRequestExactAlarms).toHaveBeenCalled();
    expect(screen.getByTestId('vendor-card')).toBeTruthy();
    expect(screen.getByText('Obaveštenja na HONOR i Huawei telefonima')).toBeTruthy();
    await fireEvent.press(screen.getByText('Otvori pokretanje aplikacija'));
    expect(p.onOpenAppLaunch).toHaveBeenCalled();
    // the card carries the exact-alarm button too: two buttons on the screen
    expect(screen.getAllByText('Dozvoli tačne alarme')).toHaveLength(2);
  });

  it('turns quiet hours off and on, and moves their start and end', async () => {
    const p = props();
    await show(p);
    await fireEvent.press(screen.getByLabelText('Od: pola sata kasnije'));
    expect(p.onChange).toHaveBeenLastCalledWith({ quietHours: { start: '22:30', end: '07:00' } });
    await fireEvent.press(screen.getByLabelText('Do: pola sata ranije'));
    expect(p.onChange).toHaveBeenLastCalledWith({ quietHours: { start: '22:00', end: '06:30' } });
    await fireEvent.press(screen.getByLabelText(/^Tihi sati/));
    expect(p.onChange).toHaveBeenLastCalledWith({ quietHours: null });
  });

  it('shows no times when quiet hours are off, and offers the default when they are turned on', async () => {
    const p = props({ values: { ...props().values, quietHours: null } });
    await show(p);
    expect(screen.queryByLabelText(/^Od /)).toBeNull();
    await fireEvent.press(screen.getByLabelText(/^Tihi sati/));
    expect(p.onChange).toHaveBeenLastCalledWith({ quietHours: { start: '22:00', end: '07:00' } });
  });
});

describe('SettingsView: addresses', () => {
  it('lists the addresses, marks the primary one and offers the actions each needs', async () => {
    const p = props();
    await show(p);
    // the primary address shows "Glavna adresa" as the chosen button, the other one can be made primary
    expect(
      screen.getByLabelText('Glavna adresa: Vojvode Mišića 34').props.accessibilityState.selected,
    ).toBe(true);
    expect(screen.queryByLabelText('Postavi kao glavnu: Vojvode Mišića 34')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Promeni broj: Vojvode Mišića 34'));
    expect(p.onEditNumber).toHaveBeenCalledWith(1);
    await fireEvent.press(screen.getByLabelText('Dodaj broj: Bulevar Nemanjića'));
    expect(p.onEditNumber).toHaveBeenCalledWith(2);
    await fireEvent.press(screen.getByLabelText('Postavi kao glavnu: Bulevar Nemanjića'));
    expect(p.onMakePrimary).toHaveBeenCalledWith(2);
  });

  it('a settlement has no house number to change, and a single address has no "make primary"', async () => {
    await show(
      props({
        addresses: [{ ...home, canHaveNumber: false }],
      }),
    );
    expect(screen.queryByLabelText(/^Promeni broj/)).toBeNull();
    expect(screen.queryByLabelText(/^Postavi kao glavnu/)).toBeNull();
  });

  it('asks before deleting an address, says what goes with it, and can be cancelled', async () => {
    const p = props();
    await show(p);
    await fireEvent.press(screen.getByLabelText('Obriši: Bulevar Nemanjića'));
    expect(
      screen.getByText('Obrisati adresu Bulevar Nemanjića? Briše se i njena istorija.'),
    ).toBeTruthy();
    expect(p.onDeleteAddress).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('Otkaži'));
    expect(screen.queryByText(/Briše se i njena istorija/)).toBeNull();
    await fireEvent.press(screen.getByLabelText('Obriši: Bulevar Nemanjića'));
    await fireEvent.press(screen.getAllByLabelText('Obriši').at(-1)!);
    await waitFor(() => expect(p.onDeleteAddress).toHaveBeenCalledWith(2));
  });

  it('keeps the confirmation open with a message when the server refuses', async () => {
    const p = props({ onDeleteAddress: jest.fn().mockRejectedValue(new Error('offline')) });
    await show(p);
    await fireEvent.press(screen.getByLabelText('Obriši: Bulevar Nemanjića'));
    await fireEvent.press(screen.getAllByLabelText('Obriši').at(-1)!);
    await waitFor(() =>
      expect(screen.getByText('Adresa nije obrisana. Pokušajte ponovo.')).toBeTruthy(),
    );
    expect(screen.getByText(/Briše se i njena istorija/)).toBeTruthy();
  });

  it('adds an address until the limit, then says why not', async () => {
    const p = props();
    const { rerender } = await show(p);
    await fireEvent.press(screen.getByLabelText('Dodaj adresu'));
    expect(p.onAdd).toHaveBeenCalled();
    await rerender(
      <ThemeProvider override={buildTheme('dark')}>
        <SettingsView {...p} canAdd={false} />
      </ThemeProvider>,
    );
    expect(screen.queryByLabelText('Dodaj adresu')).toBeNull();
    expect(screen.getByText('Možete pratiti najviše 3 adrese.')).toBeTruthy();
  });
});

describe('SettingsView: privacy and about', () => {
  it('deletes everything only after a confirmation that says what it deletes', async () => {
    const p = props();
    await show(p);
    expect(screen.getByText(/Nema naloga, ne tražimo vašu lokaciju/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Obriši sve moje podatke'));
    expect(p.onDeleteAll).not.toHaveBeenCalled();
    expect(screen.getByText(/Ne može da se poništi/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Obriši sve'));
    await waitFor(() => expect(p.onDeleteAll).toHaveBeenCalledTimes(1));
  });

  it('can be cancelled, and says so when the deletion failed', async () => {
    const p = props({ onDeleteAll: jest.fn().mockRejectedValue(new Error('offline')) });
    await show(p);
    await fireEvent.press(screen.getByLabelText('Obriši sve moje podatke'));
    await fireEvent.press(screen.getByLabelText('Otkaži'));
    expect(screen.queryByLabelText('Obriši sve')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Obriši sve moje podatke'));
    await fireEvent.press(screen.getByLabelText('Obriši sve'));
    await waitFor(() =>
      expect(
        screen.getByText('Brisanje nije uspelo. Proverite vezu i pokušajte ponovo.'),
      ).toBeTruthy(),
    );
  });

  it('shows the version, the disclaimer, the source, the licences and takes feedback', async () => {
    const p = props();
    await show(p);
    expect(screen.getByText('Verzija 1.2.3')).toBeTruthy();
    expect(screen.getByText('Nezvanična aplikacija, nije povezana sa EPS ili EDS.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Otvori sajt Elektrodistribucije'));
    expect(p.onOpenEds).toHaveBeenCalled();
    expect(screen.queryByText(/SIL Open Font License/)).toBeNull();
    await fireEvent.press(screen.getByLabelText('Licence'));
    expect(screen.getByText(/SIL Open Font License/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Pošalji povratnu informaciju'));
    await fireEvent.changeText(screen.getByLabelText('Šta biste promenili?'), 'Veći brojevi');
    await fireEvent.press(screen.getByLabelText('Pošalji'));
    await waitFor(() => expect(screen.getByText('Hvala na poruci.')).toBeTruthy());
    expect(p.onSendFeedback).toHaveBeenCalledWith('Veći brojevi');
  });
});

const sub = (over: Partial<SubscriptionDto> = {}): SubscriptionDto => ({
  id: 7,
  streetId: 1,
  settlementId: null,
  name: { latin: 'Vojvode Mišića', cyrillic: 'Војводе Мишића' },
  houseNumber: 34,
  houseSuffix: null,
  label: 'Kuća',
  isPrimary: false,
  ...over,
});

describe('address operations', () => {
  beforeEach(() => {
    useAddresses.setState({
      items: [
        {
          localId: 'a',
          request: { city: 'nis', streetId: 2, label: 'Posao', isPrimary: true },
        },
        {
          localId: 'b',
          request: { city: 'nis', streetId: 1, houseNumber: 34, label: 'Kuća', isPrimary: false },
        },
      ],
    });
  });

  it('describes a server address the way the device list does', () => {
    expect(matchOf(sub())).toEqual({
      streetId: 1,
      settlementId: null,
      houseNumber: 34,
      label: 'Kuća',
    });
  });

  it('makes an address primary on the server and then on the device', async () => {
    const client = { patchSubscription: jest.fn().mockResolvedValue({}) };
    await makePrimary(client, sub());
    expect(client.patchSubscription).toHaveBeenCalledWith(7, { isPrimary: true });
    expect(useAddresses.getState().items.map((i) => !!i.request.isPrimary)).toEqual([false, true]);
  });

  it('deletes an address on the server and then on the device, and a failure changes neither', async () => {
    const ok = { deleteSubscription: jest.fn().mockResolvedValue(undefined) };
    await deleteAddress(ok, sub());
    expect(ok.deleteSubscription).toHaveBeenCalledWith(7);
    expect(useAddresses.getState().items.map((i) => i.localId)).toEqual(['a']);

    useAddresses.setState({
      items: [
        { localId: 'a', request: { city: 'nis', streetId: 2, isPrimary: true } },
        {
          localId: 'b',
          request: { city: 'nis', streetId: 1, houseNumber: 34, label: 'Kuća', isPrimary: false },
        },
      ],
    });
    const bad = { deleteSubscription: jest.fn().mockRejectedValue(new Error('offline')) };
    await expect(deleteAddress(bad, sub())).rejects.toThrow('offline');
    expect(useAddresses.getState().items).toHaveLength(2);
  });

  it('when the primary address is deleted another one becomes primary', async () => {
    const client = { deleteSubscription: jest.fn().mockResolvedValue(undefined) };
    await deleteAddress(client, sub({ id: 3, streetId: 2, houseNumber: null, label: 'Posao' }));
    expect(useAddresses.getState().items).toHaveLength(1);
    expect(useAddresses.getState().items[0]?.request.isPrimary).toBe(true);
  });
});

describe('delete all my data', () => {
  const deps = (log: string[], failServer = false): DeleteDeps => ({
    deleteOnServer: async () => {
      log.push('server');
      if (failServer) throw new Error('offline');
    },
    forgetCredentials: async () => void log.push('credentials'),
    resetStores: () => void log.push('stores'),
    clearCaches: async () => void log.push('caches'),
  });

  it('deletes on the server first, then forgets everything on the phone', async () => {
    const log: string[] = [];
    await deleteEverything(deps(log));
    expect(log).toEqual(['server', 'credentials', 'stores', 'caches']);
  });

  it('touches nothing on the phone when the server cannot be reached', async () => {
    const log: string[] = [];
    await expect(deleteEverything(deps(log, true))).rejects.toThrow('offline');
    expect(log).toEqual(['server']);
  });

  it('forgets the device credentials and the development token', async () => {
    const data = new Map([
      ['device-credentials', 'd.s'],
      ['push-token', 'dev-token:x'],
      ['other', 'kept'],
    ]);
    const secrets: SecretStore = {
      get: async (k) => data.get(k) ?? null,
      set: async (k, v) => void data.set(k, v),
      remove: async (k) => void data.delete(k),
    };
    await forgetDevice(secrets);
    expect([...data.keys()]).toEqual(['other']);
  });

  it('resets the settings to the factory values, including onboarding', () => {
    useSettings.setState({
      language: 'en',
      script: 'cyrl',
      themeMode: 'dark',
      highContrast: true,
      enabledKinds: ['new'],
      quietHours: null,
      onboarded: true,
      notificationPermission: 'granted',
    });
    useSettings.getState().reset();
    const state = useSettings.getState();
    expect(state).toMatchObject(DEFAULT_SETTINGS);
    expect(state.onboarded).toBe(false);
  });
});

describe('device sync', () => {
  const settings = {
    language: 'sr' as const,
    script: 'latn' as const,
    enabledKinds: ['new' as const, 'cancelled' as const],
    quietHours: { start: '22:00', end: '07:00' },
  };

  it('sends the language, the kinds and the quiet hours', () => {
    expect(deviceBody(settings)).toEqual({
      locale: 'sr',
      script: 'latn',
      enabledKinds: ['new', 'cancelled'],
      quietHours: { start: '22:00', end: '07:00' },
    });
  });

  it('sends once, remembers it, sends again only when something changed', async () => {
    const kv = memoryStorage();
    const client = { patchDevice: jest.fn().mockResolvedValue({}) };
    expect(await syncDevice(client, kv, settings)).toBe(true);
    expect(await syncDevice(client, kv, settings)).toBe(false);
    expect(client.patchDevice).toHaveBeenCalledTimes(1);
    expect(await syncDevice(client, kv, { ...settings, quietHours: null })).toBe(true);
    expect(client.patchDevice).toHaveBeenLastCalledWith(
      expect.objectContaining({ quietHours: null }),
    );
  });

  it('a failure is not an error, and is tried again next time', async () => {
    const kv = memoryStorage();
    const client = { patchDevice: jest.fn().mockRejectedValueOnce(new Error('offline')) };
    expect(await syncDevice(client, kv, settings)).toBe(false);
    client.patchDevice.mockResolvedValue({});
    expect(await syncDevice(client, kv, settings)).toBe(true);
    expect(client.patchDevice).toHaveBeenCalledTimes(2);
  });
});

describe('SettingsView: addresses, states and wording', () => {
  it('shows the actions as small buttons with an icon, and the delete in the red of "Obriši sve"', async () => {
    await show(props({ addresses: [work] }));
    const del = screen.getByLabelText('Obriši: Bulevar Nemanjića');
    const bg = StyleSheet.flatten(del.props.style).backgroundColor;
    expect(bg).toBe(buildTheme('dark').colors.status.active.fill);
    // the same red as the full-width button
    expect(bg).toBe('#DC2F34');
    expect(screen.getByLabelText('Dodaj broj: Bulevar Nemanjića')).toBeTruthy();
  });

  it('a pressed "Glavna adresa" of the primary address does nothing', async () => {
    const p = props();
    await show(p);
    await fireEvent.press(screen.getByLabelText('Glavna adresa: Vojvode Mišića 34'));
    expect(p.onMakePrimary).not.toHaveBeenCalled();
  });

  it('names the Serbian option "Српски" in the Cyrillic interface and "Srpski" in the Latin one', async () => {
    const { unmount } = await show(props());
    expect(screen.getByLabelText('Srpski')).toBeTruthy();
    await unmount();
    await show(props({ values: { ...props().values, script: 'cyrl' } }));
    expect(screen.getByLabelText('Српски')).toBeTruthy();
    expect(screen.queryByLabelText('Srpski')).toBeNull();
  });

  it('loading, error with retry, nothing saved, and the offline notice', async () => {
    const { rerender } = await show(props({ addresses: [], addressesState: 'loading' }));
    expect(screen.getByLabelText('Učitavanje')).toBeTruthy();
    const failed = props({ addresses: [], addressesState: 'error' });
    await rerender(
      <ThemeProvider override={buildTheme('dark')}>
        <SettingsView {...failed} />
      </ThemeProvider>,
    );
    await fireEvent.press(screen.getByLabelText('Pokušaj ponovo'));
    expect(failed.onRetryAddresses).toHaveBeenCalled();
    await rerender(
      <ThemeProvider override={buildTheme('dark')}>
        <SettingsView {...props({ addresses: [] })} />
      </ThemeProvider>,
    );
    expect(screen.getByText('Nemate sačuvanih adresa.')).toBeTruthy();
    await rerender(
      <ThemeProvider override={buildTheme('dark')}>
        <SettingsView {...props({ offline: true })} />
      </ThemeProvider>,
    );
    expect(screen.getByText('Prikazujem sačuvane podatke')).toBeTruthy();
  });
});

describe('Screen: the status bar', () => {
  it('keeps a header fixed above the scrolling content of a sheet', async () => {
    await themed(
      <Screen inset="none" header={<SheetHeader onClose={jest.fn()} />}>
        <></>
      </Screen>,
    );
    expect(screen.getByTestId('screen-header')).toBeTruthy();
    expect(screen.getByLabelText('Zatvori')).toBeTruthy();
  });
});
