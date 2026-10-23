import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { SubscriptionDto } from '@struja/shared';
import { HouseNumberForm } from '../src/addresses/HouseNumberForm';
import { saveHouseNumber } from '../src/addresses/houseNumber';
import { buildTheme, ThemeProvider } from '../src/design/theme';
import { initI18n } from '../src/i18n';
import { useAddresses } from '../src/store/addresses';

beforeAll(async () => {
  await initI18n('sr', 'latn');
});

const sub = (over: Partial<SubscriptionDto> = {}): SubscriptionDto => ({
  id: 7,
  streetId: 1,
  settlementId: null,
  name: { latin: 'Vojvode Mišića', cyrillic: 'Војводе Мишића' },
  houseNumber: null,
  houseSuffix: null,
  label: 'Kuća',
  isPrimary: true,
  ...over,
});

describe('saveHouseNumber', () => {
  beforeEach(() => {
    useAddresses.setState({
      items: [
        { localId: 'a', request: { city: 'nis', streetId: 2, label: 'Posao', isPrimary: false } },
        { localId: 'b', request: { city: 'nis', streetId: 1, label: 'Kuća', isPrimary: true } },
      ],
    });
  });

  it('patches the server address, then adds the number to the matching address on the device', async () => {
    const api = { patchSubscription: jest.fn().mockResolvedValue({}) };
    await saveHouseNumber(api, sub(), { houseNumber: 34, houseSuffix: 'a' });
    expect(api.patchSubscription).toHaveBeenCalledWith(7, { houseNumber: 34, houseSuffix: 'a' });
    expect(useAddresses.getState().items.map((i) => i.request)).toEqual([
      { city: 'nis', streetId: 2, label: 'Posao', isPrimary: false },
      {
        city: 'nis',
        streetId: 1,
        label: 'Kuća',
        isPrimary: true,
        houseNumber: 34,
        houseSuffix: 'a',
      },
    ]);
  });

  it('sends a null suffix when there is none, and leaves the device alone when the server refuses', async () => {
    const api = { patchSubscription: jest.fn().mockRejectedValue(new Error('offline')) };
    await expect(saveHouseNumber(api, sub(), { houseNumber: 5 })).rejects.toThrow('offline');
    expect(api.patchSubscription).toHaveBeenCalledWith(7, { houseNumber: 5, houseSuffix: null });
    expect(useAddresses.getState().items[1]?.request.houseNumber).toBeUndefined();
  });

  it('changes nothing on the device when no address matches', async () => {
    const api = { patchSubscription: jest.fn().mockResolvedValue({}) };
    const before = useAddresses.getState().items;
    await saveHouseNumber(api, sub({ streetId: 99 }), { houseNumber: 5 });
    expect(useAddresses.getState().items).toEqual(before);
  });
});

describe('HouseNumberForm', () => {
  const show = (save: jest.Mock, onSaved = jest.fn()) =>
    render(
      <ThemeProvider override={buildTheme('dark')}>
        <HouseNumberForm name="Vojvode Mišića" save={save} onSaved={onSaved} />
      </ThemeProvider>,
    );

  it('saves a number with a suffix and closes', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const onSaved = jest.fn();
    await show(save, onSaved);
    expect(screen.getByText('Vojvode Mišića')).toBeTruthy();
    expect(screen.getByLabelText('Sačuvaj broj').props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('Kućni broj (nije obavezno)'), '34a');
    await fireEvent.press(screen.getByLabelText('Sačuvaj broj'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(save).toHaveBeenCalledWith({ houseNumber: 34, houseSuffix: 'a' });
  });

  it('refuses something that is not a number and says why', async () => {
    const save = jest.fn();
    await show(save);
    await fireEvent.changeText(screen.getByLabelText('Kućni broj (nije obavezno)'), 'abc');
    expect(screen.getByText('Unesite broj, na primer 34 ili 34a')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Sačuvaj broj'));
    expect(save).not.toHaveBeenCalled();
  });

  it('shows an error when saving fails and stays open', async () => {
    const save = jest.fn().mockRejectedValue(new Error('offline'));
    const onSaved = jest.fn();
    await show(save, onSaved);
    await fireEvent.changeText(screen.getByLabelText('Kućni broj (nije obavezno)'), '12');
    await fireEvent.press(screen.getByLabelText('Sačuvaj broj'));
    await waitFor(() =>
      expect(screen.getByText('Broj nije sačuvan. Pokušajte ponovo.')).toBeTruthy(),
    );
    expect(onSaved).not.toHaveBeenCalled();
  });
});
