import { render, screen } from '@testing-library/react-native';
import { PixelRatio, StyleSheet } from 'react-native';
import { DayStrip, Segmented } from '../src/design/components';
import { buildTheme, ThemeProvider } from '../src/design/theme';

const show = (ui: React.ReactElement) =>
  render(<ThemeProvider override={buildTheme('dark')}>{ui}</ThemeProvider>);

const days = ['2026-10-26', '2026-10-27'].map((date, i) => ({
  date,
  weekday: 'pon',
  dayOfMonth: 26 + i,
  hasOutage: false,
  accessibilityLabel: date,
}));
const options = [
  { value: 'latn', label: 'Latinica' },
  { value: 'cyrl', label: 'Ćirilica' },
] as const;

afterEach(() => jest.restoreAllMocks());

describe.each([
  [1, 'row', true],
  [2, 'column', false],
] as const)('at a font scale of %s', (fontScale, direction, square) => {
  beforeEach(() => jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(fontScale));

  it(`lays the segmented choices out as a ${direction}, so no word breaks in the middle`, async () => {
    await show(
      <Segmented options={options} value="latn" onChange={jest.fn()} accessibilityLabel="Pismo" />,
    );
    const group = StyleSheet.flatten(screen.getByLabelText('Pismo').props.style);
    expect(group.flexDirection).toBe(direction);
  });

  it(`${square ? 'keeps' : 'drops'} the square shape of the day tiles`, async () => {
    await show(<DayStrip days={days} selected="2026-10-26" onSelect={jest.fn()} />);
    const tab = StyleSheet.flatten(screen.getAllByRole('tab')[0]!.props.style);
    expect(tab.aspectRatio).toBe(square ? 1 : undefined);
  });
});
