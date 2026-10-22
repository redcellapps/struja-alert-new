/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories must use require */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import Onboarding from '../app/onboarding';
import { buildTheme, ThemeProvider } from '../src/design/theme';
import { initI18n } from '../src/i18n';
import { requestNotificationPermission } from '../src/notifications/permission';
import { useSettings } from '../src/store/settings';

// The real container needs the network and the secure store; the form itself is tested elsewhere.
jest.mock('../src/addresses/AddAddressContainer', () => {
  const { Pressable, Text } = require('react-native');
  return {
    AddAddressContainer: ({ onSaved }: { onSaved: () => void }) => (
      <Pressable accessibilityLabel="saved" onPress={onSaved}>
        <Text>form</Text>
      </Pressable>
    ),
  };
});
jest.mock('../src/notifications/permission', () => ({
  requestNotificationPermission: jest.fn(),
}));
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const ask = requestNotificationPermission as jest.Mock;
const show = () =>
  render(
    <ThemeProvider override={buildTheme('dark')}>
      <Onboarding />
    </ThemeProvider>,
  );

beforeAll(async () => {
  await initI18n('sr', 'latn');
});
beforeEach(() => {
  useSettings.setState({ onboarded: false, notificationPermission: 'undetermined' });
  ask.mockReset();
  mockReplace.mockReset();
});

describe('onboarding', () => {
  it('walks three steps, remembers the permission answer and finishes with an address', async () => {
    ask.mockResolvedValue('granted');
    await show();
    expect(screen.getByText('Korak 1 od 3')).toBeTruthy();
    expect(screen.getByText('Struja vas obaveštava pre nego što nestane')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Dalje'));
    expect(screen.getByText('Korak 2 od 3')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Dozvoli obaveštenja'));
    await waitFor(() => expect(screen.getByText('Korak 3 od 3')).toBeTruthy());
    expect(useSettings.getState().notificationPermission).toBe('granted');
    expect(useSettings.getState().onboarded).toBe(false);

    await fireEvent.press(screen.getByLabelText('saved'));
    expect(useSettings.getState().onboarded).toBe(true);
    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('lets the person skip the permission and the address', async () => {
    await show();
    await fireEvent.press(screen.getByLabelText('Dalje'));
    await fireEvent.press(screen.getByLabelText('Ne sada'));
    expect(ask).not.toHaveBeenCalled();
    expect(screen.getByText('Korak 3 od 3')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Ne sada'));
    expect(useSettings.getState().onboarded).toBe(true);
    expect(mockReplace).toHaveBeenCalledWith('/');
    expect(useSettings.getState().notificationPermission).toBe('undetermined');
  });

  it('remembers a denied permission and goes on', async () => {
    ask.mockResolvedValue('denied');
    await show();
    await fireEvent.press(screen.getByLabelText('Dalje'));
    await fireEvent.press(screen.getByLabelText('Dozvoli obaveštenja'));
    await waitFor(() => expect(screen.getByText('Obaveštenja su isključena')).toBeTruthy());
    expect(useSettings.getState().notificationPermission).toBe('denied');
  });
});
