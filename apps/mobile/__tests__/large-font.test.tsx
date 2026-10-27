import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import {
  BentoRow,
  BentoTile,
  Button,
  DayStrip,
  Segmented,
  SectionHeader,
  SmallButton,
} from '../src/design/components';
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

// the width of the window, set per test
let mockWidth = 427;
let mockFontScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: mockWidth, height: 900, scale: 1, fontScale: mockFontScale }),
}));

afterEach(() => {
  jest.restoreAllMocks();
  mockWidth = 427;
  mockFontScale = 1;
});

describe.each([
  [1, 'row', true],
  [2, 'column', false],
] as const)('at a font scale of %s', (fontScale, direction, square) => {
  beforeEach(() => {
    mockFontScale = fontScale;
  });

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

describe('Bento tiles and buttons with a large font or a narrow screen', () => {
  const tile = (label: string) => (
    <BentoTile
      icon={{ ios: 'timer', android: 'timer' }}
      label={label}
      value="4 h"
      accessibilityLabel={label}
    />
  );

  it.each([
    [1, 427, 'row'],
    [1.3, 427, 'row'],
    [1.5, 427, 'column'],
    [2, 427, 'column'],
    [1, 360, 'column'],
    [1, 399, 'column'],
    [1, 400, 'row'],
  ])('font scale %s on a %s dp screen: tiles in a %s', async (scale, width, direction) => {
    mockFontScale = scale;
    mockWidth = width;
    await show(
      <BentoRow>
        {tile('a')}
        {tile('b')}
      </BentoRow>,
    );
    const row = StyleSheet.flatten(screen.getByTestId('bento-row').props.style);
    expect(row.flexDirection).toBe(direction);
  });

  it('lets button text scale in full (no cap) and hyphenates a long word', async () => {
    await show(<Button label="Otvori sajt Elektrodistribucije" variant="secondary" fullWidth />);
    const text = screen.getByText('Otvori sajt Elektrodistribucije');
    expect(text.props.maxFontSizeMultiplier).toBe(2);
    expect(text.props.android_hyphenationFrequency).toBe('normal');
  });

  it('SmallButton text scales in full too', async () => {
    await show(<SmallButton label="Obriši" icon={{ ios: 'trash.fill', android: 'delete' }} />);
    expect(screen.getByText('Obriši').props.maxFontSizeMultiplier).toBe(2);
  });
});

describe('SectionHeader: the action goes under the title so the title never breaks mid-word', () => {
  it.each([
    [1, 427, 'row'],
    [1.5, 427, 'column'],
    [2, 427, 'column'],
    [1, 360, 'row'],
    [1.2, 360, 'column'],
    [2, 360, 'column'],
    [1.2, 427, 'row'],
  ])('font scale %s on a %s dp screen: header in a %s', async (scale, width, direction) => {
    mockFontScale = scale;
    mockWidth = width;
    await show(<SectionHeader title="Adrese" actionLabel="Dodaj adresu" onAction={jest.fn()} />);
    const row = StyleSheet.flatten(screen.getByTestId('section-header').props.style);
    expect(row.flexDirection).toBe(direction);
  });
});
