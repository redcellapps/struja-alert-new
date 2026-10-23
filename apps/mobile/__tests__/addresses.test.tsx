import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import type { Endpoints } from '../src/api/endpoints';
import { gazetteer, outagesFor } from '../mock-server/fixtures';
import { AddAddressForm } from '../src/addresses/AddAddressForm';
import { LimitReachedError, saveAddress } from '../src/addresses/save';
import { buildTheme, ThemeProvider } from '../src/design/theme';
import { buildIndex } from '../src/gazetteer/search';
import { initI18n } from '../src/i18n';
import { useAddresses } from '../src/store/addresses';

const index = buildIndex(gazetteer);
const themed = (ui: ReactElement) =>
  render(<ThemeProvider override={buildTheme('dark')}>{ui}</ThemeProvider>);

beforeAll(async () => {
  await initI18n('sr', 'latn');
});
beforeEach(() => useAddresses.setState({ items: [] }));

const fakeApi = (primary = true) => ({
  addSubscription: jest.fn(async (request: Parameters<Endpoints['addSubscription']>[0]) => {
    const subscription = {
      id: 1,
      streetId: request.streetId ?? null,
      settlementId: request.settlementId ?? null,
      name: { latin: 'Vojvode Mišića', cyrillic: 'Војводе Мишића' },
      houseNumber: request.houseNumber ?? null,
      houseSuffix: request.houseSuffix ?? null,
      label: request.label ?? null,
      isPrimary: primary,
    };
    return { subscription, outages: outagesFor(subscription, new Date()) };
  }),
});

describe('saveAddress', () => {
  it('adds on the server first, then on the device, with the server verdict on primary', async () => {
    const api = fakeApi(true);
    const result = await saveAddress(api, { city: 'nis', streetId: 1, houseNumber: 34 }, () => 'a');
    expect(result.outages.length).toBeGreaterThan(0);
    expect(useAddresses.getState().items).toEqual([
      { localId: 'a', request: { city: 'nis', streetId: 1, houseNumber: 34, isPrimary: true } },
    ]);
  });

  it('leaves the device list alone when the server refuses', async () => {
    const api = { addSubscription: jest.fn().mockRejectedValue(new Error('offline')) };
    await expect(saveAddress(api, { city: 'nis', streetId: 1 })).rejects.toThrow('offline');
    expect(useAddresses.getState().items).toEqual([]);
  });

  it('refuses a fourth address without calling the server', async () => {
    const api = fakeApi(false);
    for (const id of ['a', 'b', 'c'])
      await saveAddress(api, { city: 'nis', streetId: 1 }, () => id);
    api.addSubscription.mockClear();
    await expect(saveAddress(api, { city: 'nis', streetId: 2 })).rejects.toBeInstanceOf(
      LimitReachedError,
    );
    expect(api.addSubscription).not.toHaveBeenCalled();
  });

  it('a new primary address takes the mark from the old one', async () => {
    await saveAddress(fakeApi(true), { city: 'nis', streetId: 1 }, () => 'a');
    await saveAddress(fakeApi(true), { city: 'nis', streetId: 2, isPrimary: true }, () => 'b');
    expect(useAddresses.getState().items.map((i) => !!i.request.isPrimary)).toEqual([false, true]);
  });
});

describe('AddAddressForm', () => {
  const props = {
    index,
    indexStatus: 'ready' as const,
    script: 'latn' as const,
    existingCount: 0,
    onSaved: jest.fn(),
  };

  it('searches offline, takes a house number with a suffix and a label, and saves', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const onSaved = jest.fn();
    await themed(<AddAddressForm {...props} save={save} onSaved={onSaved} />);

    expect(screen.queryByLabelText('Sačuvaj adresu')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Ulica ili naselje'), 'voj mis');
    await fireEvent.press(screen.getByLabelText('Vojvode Mišića, Medijana'));
    await fireEvent.changeText(screen.getByLabelText('Kućni broj (nije obavezno)'), '34a');
    await fireEvent.press(screen.getByLabelText('Kuća'));
    expect(screen.getByLabelText('Pratiću: Vojvode Mišića 34a, Niš')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Sačuvaj adresu'));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(save).toHaveBeenCalledWith({
      city: 'nis',
      streetId: 1,
      houseNumber: 34,
      houseSuffix: 'a',
      label: 'Kuća',
    });
  });

  it('saves a street without a number and without a label', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    await themed(<AddAddressForm {...props} save={save} />);
    await fireEvent.changeText(screen.getByLabelText('Ulica ili naselje'), 'студеничка');
    await fireEvent.press(screen.getByLabelText('Studenička, Pantelej'));
    await fireEvent.press(screen.getByLabelText('Sačuvaj adresu'));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ city: 'nis', streetId: 2 }));
  });

  it('a settlement is saved by its own id and has no house number', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    await themed(<AddAddressForm {...props} save={save} />);
    await fireEvent.changeText(screen.getByLabelText('Ulica ili naselje'), 'bubanj');
    await fireEvent.press(screen.getByLabelText('Bubanj, Naselje'));
    expect(screen.queryByLabelText('Kućni broj (nije obavezno)')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Sačuvaj adresu'));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ city: 'nis', settlementId: 1 }));
  });

  it('blocks saving a bad house number and says why', async () => {
    const save = jest.fn();
    await themed(<AddAddressForm {...props} save={save} />);
    await fireEvent.changeText(screen.getByLabelText('Ulica ili naselje'), 'cegarska');
    await fireEvent.press(screen.getByLabelText('Čegarska, Crveni krst'));
    await fireEvent.changeText(screen.getByLabelText('Kućni broj (nije obavezno)'), 'abc');
    expect(screen.getByText('Unesite broj, na primer 34 ili 34a')).toBeTruthy();
    expect(screen.getByLabelText('Sačuvaj adresu').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByLabelText('Sačuvaj adresu'));
    expect(save).not.toHaveBeenCalled();
  });

  it('shows an error and stays open when saving fails, then succeeds on retry', async () => {
    const save = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(1);
    const onSaved = jest.fn();
    await themed(<AddAddressForm {...props} save={save} onSaved={onSaved} />);
    await fireEvent.changeText(screen.getByLabelText('Ulica ili naselje'), 'kosmajska');
    await fireEvent.press(screen.getByLabelText('Kosmajska, Palilula - Niš'));
    await fireEvent.press(screen.getByLabelText('Sačuvaj adresu'));
    await waitFor(() =>
      expect(screen.getByText('Adresa nije sačuvana. Pokušajte ponovo.')).toBeTruthy(),
    );
    expect(onSaved).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('Sačuvaj adresu'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('offers the primary choice only when there is already an address', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    await themed(<AddAddressForm {...props} existingCount={1} save={save} />);
    await fireEvent.changeText(screen.getByLabelText('Ulica ili naselje'), 'cegarska');
    await fireEvent.press(screen.getByLabelText('Čegarska, Crveni krst'));
    await fireEvent.press(screen.getByLabelText('Glavna adresa'));
    await fireEvent.press(screen.getByLabelText('Sačuvaj adresu'));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({ city: 'nis', streetId: 5, isPrimary: true }),
    );
  });

  it('shows the three cities, only Niš selectable', async () => {
    await themed(<AddAddressForm {...props} save={jest.fn()} />);
    expect(screen.getByLabelText('Niš').props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText('Beograd, Uskoro').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByLabelText('Novi Sad, Uskoro').props.accessibilityState.disabled).toBe(true);
  });

  it('shows the Cyrillic names when the script is Cyrillic', async () => {
    await themed(<AddAddressForm {...props} script="cyrl" save={jest.fn()} />);
    await fireEvent.changeText(screen.getByLabelText('Ulica ili naselje'), 'vojvode');
    expect(screen.getByText('Војводе Мишића')).toBeTruthy();
  });

  it('says so when nothing matches, and when the street list is loading or missing', async () => {
    const { rerender } = await themed(<AddAddressForm {...props} save={jest.fn()} />);
    await fireEvent.changeText(screen.getByLabelText('Ulica ili naselje'), 'zzzz');
    expect(screen.getByText('Nema rezultata. Pokušajte drugi naziv.')).toBeTruthy();

    const retry = jest.fn();
    await rerender(
      <ThemeProvider override={buildTheme('dark')}>
        <AddAddressForm
          {...props}
          index={null}
          indexStatus="loading"
          onRetryIndex={retry}
          save={jest.fn()}
        />
      </ThemeProvider>,
    );
    expect(screen.getByLabelText('Učitavam spisak ulica')).toBeTruthy();

    await rerender(
      <ThemeProvider override={buildTheme('dark')}>
        <AddAddressForm
          {...props}
          index={null}
          indexStatus="error"
          onRetryIndex={retry}
          save={jest.fn()}
        />
      </ThemeProvider>,
    );
    await fireEvent.press(screen.getByLabelText('Pokušaj ponovo'));
    expect(retry).toHaveBeenCalled();
  });

  it('shows the limit instead of the form at three addresses', async () => {
    await themed(<AddAddressForm {...props} existingCount={3} save={jest.fn()} />);
    expect(screen.getByText('Dostigli ste ograničenje')).toBeTruthy();
    expect(screen.queryByLabelText('Ulica ili naselje')).toBeNull();
  });
});

describe('AddAddressForm started from a street ("Prati")', () => {
  const base = {
    indexStatus: 'ready' as const,
    script: 'latn' as const,
    existingCount: 0,
    onSaved: jest.fn(),
  };

  it('has the street picked already and saves it', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    await themed(
      <AddAddressForm {...base} index={index} initial={{ kind: 'street', id: 2 }} save={save} />,
    );
    expect(screen.getByText('Studenička')).toBeTruthy();
    expect(screen.queryByLabelText('Ulica ili naselje')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Sačuvaj adresu'));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ city: 'nis', streetId: 2 }));
  });

  it('waits for the street list, then picks the street; "Promeni" lets the person search again', async () => {
    const save = jest.fn();
    const { rerender } = await themed(
      <AddAddressForm
        {...base}
        index={null}
        indexStatus="loading"
        initial={{ kind: 'street', id: 1 }}
        save={save}
      />,
    );
    expect(screen.queryByText('Vojvode Mišića')).toBeNull();
    await rerender(
      <ThemeProvider override={buildTheme('dark')}>
        <AddAddressForm {...base} index={index} initial={{ kind: 'street', id: 1 }} save={save} />
      </ThemeProvider>,
    );
    expect(screen.getByText('Vojvode Mišića')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Promeni'));
    expect(screen.getByLabelText('Ulica ili naselje')).toBeTruthy();
  });

  it('ignores a street that is not in the list', async () => {
    await themed(
      <AddAddressForm
        {...base}
        index={index}
        initial={{ kind: 'street', id: 9999 }}
        save={jest.fn()}
      />,
    );
    expect(screen.getByLabelText('Ulica ili naselje')).toBeTruthy();
  });
});
