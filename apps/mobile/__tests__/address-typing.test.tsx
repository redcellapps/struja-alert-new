import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { gazetteer } from '../mock-server/fixtures';
import { AddAddressForm } from '../src/addresses/AddAddressForm';
import { buildTheme, ThemeProvider } from '../src/design/theme';
import { buildIndex } from '../src/gazetteer/search';
import { initI18n } from '../src/i18n';
import { useAddresses } from '../src/store/addresses';

// the font scale of the window, set per test
let mockFontScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 427, height: 900, scale: 1, fontScale: mockFontScale }),
}));

const index = buildIndex(gazetteer);
const show = (ui: ReactElement) =>
  render(<ThemeProvider override={buildTheme('dark')}>{ui}</ThemeProvider>);
const props = {
  index,
  indexStatus: 'ready' as const,
  script: 'latn' as const,
  existingCount: 0,
  save: jest.fn(),
  onSaved: jest.fn(),
};

beforeAll(async () => {
  await initI18n('sr', 'latn');
});
beforeEach(() => useAddresses.setState({ items: [] }));
afterEach(() => {
  mockFontScale = 1;
});

describe('typing in the street search', () => {
  it('keeps the city chips at a normal font, and says that the person is typing', async () => {
    const onTypingChange = jest.fn();
    await show(<AddAddressForm {...props} onTypingChange={onTypingChange} />);
    await act(async () => fireEvent(screen.getByLabelText('Ulica ili naselje'), 'focus'));
    expect(onTypingChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByText('Grad')).toBeTruthy();
    expect(screen.getByLabelText('Niš')).toBeTruthy();
  });

  it('collapses the city chips while typing at a large font, and brings them back after', async () => {
    mockFontScale = 2;
    const onTypingChange = jest.fn();
    await show(<AddAddressForm {...props} onTypingChange={onTypingChange} />);
    expect(screen.getByText('Grad')).toBeTruthy();
    const field = screen.getByLabelText('Ulica ili naselje');
    await act(async () => fireEvent(field, 'focus'));
    expect(onTypingChange).toHaveBeenLastCalledWith(true);
    expect(screen.queryByText('Grad')).toBeNull();
    expect(screen.queryByLabelText('Niš')).toBeNull();
    // the field and its results stay
    await fireEvent.changeText(screen.getByLabelText('Ulica ili naselje'), 'voj mis');
    expect(screen.getByLabelText('Vojvode Mišića, Medijana')).toBeTruthy();
    await act(async () => fireEvent(screen.getByLabelText('Ulica ili naselje'), 'blur'));
    expect(onTypingChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByText('Grad')).toBeTruthy();
  });
});
