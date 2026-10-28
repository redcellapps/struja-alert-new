import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useRef, type ReactElement } from 'react';
import { Keyboard, StyleSheet, Text, View, type HostInstance } from 'react-native';
import { Screen, useScreenReveal } from '../src/design/components';
import { buildTheme, ThemeProvider } from '../src/design/theme';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }),
}));

const show = (ui: ReactElement) =>
  render(<ThemeProvider override={buildTheme('dark')}>{ui}</ThemeProvider>);
// The test environment's Keyboard does not emit: take the listeners the screen registers.
const listeners: Record<string, (e: unknown) => void> = {};
beforeEach(() => {
  jest.spyOn(Keyboard, 'addListener').mockImplementation(((
    event: string,
    cb: (e: unknown) => void,
  ) => {
    listeners[event] = cb;
    return { remove: jest.fn() };
  }) as never);
});
afterEach(() => jest.restoreAllMocks());
const keyboard = (event: 'keyboardDidShow' | 'keyboardDidHide', height = 0) =>
  act(async () => {
    listeners[event]?.({ endCoordinates: { height } });
  });
// What the screen leaves free at the bottom for the keyboard.
const keyboardRoom = () =>
  StyleSheet.flatten(screen.getByTestId('screen-root').props.style).paddingBottom as number;

function Field() {
  const reveal = useScreenReveal();
  const ref = useRef<HostInstance>(null);
  return (
    <View ref={ref} collapsable={false}>
      <Text onPress={() => reveal(ref.current)}>focus</Text>
    </View>
  );
}

describe('Screen and the keyboard', () => {
  it('leaves the height of the keyboard free at the bottom, so the content scrolls in the part in view', async () => {
    await show(
      <Screen>
        <Text>content</Text>
      </Screen>,
    );
    expect(keyboardRoom()).toBe(0);
    await keyboard('keyboardDidShow', 300);
    expect(keyboardRoom()).toBe(300);
    await keyboard('keyboardDidHide');
    expect(keyboardRoom()).toBe(0);
  });

  it('reveals a field before and after the keyboard is up without failing', async () => {
    await show(
      <Screen>
        <Field />
      </Screen>,
    );
    // the keyboard is not up yet: the request waits for it
    await act(async () => fireEvent.press(screen.getByText('focus')));
    await keyboard('keyboardDidShow', 300);
    // the keyboard is up: the request is carried out at once
    await act(async () => fireEvent.press(screen.getByText('focus')));
    await keyboard('keyboardDidHide');
    expect(keyboardRoom()).toBe(0);
  });
});
