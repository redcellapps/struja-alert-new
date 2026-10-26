import { render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import { Screen } from '../src/design/components';
import { buildTheme, ThemeProvider } from '../src/design/theme';

// A phone with a 24 dp status bar.
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }),
}));

const show = (name: 'light' | 'dark', ui: React.ReactElement) =>
  render(<ThemeProvider override={buildTheme(name)}>{ui}</ThemeProvider>);

describe('Screen and the status bar', () => {
  it.each(['light', 'dark'] as const)(
    'covers the strip under the status bar with the page colour (%s), over the scrolling content',
    async (name) => {
      await show(
        name,
        <Screen>
          <Text>content</Text>
        </Screen>,
      );
      const strip = StyleSheet.flatten(screen.getByTestId('status-bar-strip').props.style);
      expect(strip).toMatchObject({
        position: 'absolute',
        top: 0,
        height: 24,
        backgroundColor: buildTheme(name).colors.chrome.background,
      });
    },
  );

  it('has no strip on a sheet, which does not reach the status bar, and fixes its header instead', async () => {
    await show(
      'dark',
      <Screen inset="none" header={<Text>handle</Text>}>
        <Text>content</Text>
      </Screen>,
    );
    expect(screen.queryByTestId('status-bar-strip')).toBeNull();
    expect(screen.getByTestId('screen-header')).toBeTruthy();
    expect(screen.getByText('handle')).toBeTruthy();
  });
});
