import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { StyleSheet } from 'react-native';
import {
  AddressCard,
  AppText,
  Banner,
  BentoTile,
  Button,
  CheckboxRow,
  Chip,
  CountdownText,
  DayStrip,
  EmptyState,
  RadioRow,
  RangeChips,
  SectionHeader,
  Segmented,
  SkeletonCard,
  StatusHero,
  SwitchRow,
  TimelineBar,
} from '../src/design/components';
import { buildTheme, ThemeProvider } from '../src/design/theme';
import { STATUS_KEYS } from '../src/design/tokens';

const renderThemed = (ui: ReactElement, name: 'light' | 'dark' = 'light') =>
  render(<ThemeProvider override={buildTheme(name)}>{ui}</ThemeProvider>);

describe.each(['light', 'dark'] as const)('components (%s)', (mode) => {
  it.each(STATUS_KEYS)(
    'StatusHero %s has a status word, a headline and a spoken sentence',
    async (status) => {
      await renderThemed(
        <StatusHero
          status={status}
          statusLabel="U toku"
          headline="Bez struje"
          address="Vojvode Mišića 34"
          accessibilityLabel="Bez struje do 12:30, Vojvode Mišića 34"
        >
          <CountdownText
            remainingMs={72 * 60_000 + 5000}
            color="#000000"
            accessibilityLabel="1 čas 12 minuta"
          />
        </StatusHero>,
        mode,
      );
      expect(screen.getByText('U toku')).toBeTruthy();
      expect(screen.getByText('Bez struje')).toBeTruthy();
      expect(screen.getByLabelText('Bez struje do 12:30, Vojvode Mišića 34')).toBeTruthy();
      expect(screen.getByLabelText('1 čas 12 minuta')).toBeTruthy();
    },
  );

  it('CountdownText shows tabular digits for the remaining time', async () => {
    await renderThemed(
      <CountdownText remainingMs={3_725_000} color="#fff" accessibilityLabel="x" />,
      mode,
    );
    const digits = screen.getAllByText(/^[0-9:]$/).map((n) => n.props.children);
    expect(digits.join('')).toBe('1:02:05');
  });

  it('DayStrip marks the selected day and reports a press', async () => {
    const onSelect = jest.fn();
    const days = [0, 1, 2, 3].map((n) => ({
      date: `2026-11-0${3 + n}`,
      weekday: ['uto', 'sre', 'čet', 'pet'][n] as string,
      dayOfMonth: 3 + n,
      hasOutage: n === 1,
      accessibilityLabel: `dan ${n}`,
    }));
    await renderThemed(<DayStrip days={days} selected="2026-11-03" onSelect={onSelect} />, mode);
    expect(screen.getByLabelText('dan 0').props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText('dan 1').props.accessibilityState.selected).toBe(false);
    await fireEvent.press(screen.getByLabelText('dan 1'));
    expect(onSelect).toHaveBeenCalledWith('2026-11-04');
  });

  it('AddressCard shows the address, the status word and the summary, and can be pressed', async () => {
    const onPress = jest.fn();
    await renderThemed(
      <AddressCard
        label="Kuća"
        primary
        primaryLabel="Glavna adresa"
        address="Vojvode Mišića 34"
        status="upcoming"
        statusLabel="Najavljeno"
        summary="Sutra 08:30–12:30"
        accessibilityLabel="Kuća, Vojvode Mišića 34"
        onPress={onPress}
      />,
      mode,
    );
    expect(screen.getByText('Najavljeno')).toBeTruthy();
    expect(screen.getByText('Sutra 08:30–12:30')).toBeTruthy();
    expect(screen.getByText('Kuća · Glavna adresa')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Kuća, Vojvode Mišića 34'));
    expect(onPress).toHaveBeenCalled();
  });

  it('TimelineBar places the window and the now marker by hour', async () => {
    await renderThemed(
      <TimelineBar
        startHour={6}
        endHour={12}
        nowHour={9}
        status="active"
        accessibilityLabel="bar"
      />,
      mode,
    );
    const win = StyleSheet.flatten(screen.getByTestId('timeline-window').props.style);
    const now = StyleSheet.flatten(screen.getByTestId('timeline-now').props.style);
    expect(win).toMatchObject({ left: '25%', width: '25%' });
    expect(now).toMatchObject({ left: '37.5%' });
  });

  it('RangeChips highlights the range holding the number and explains it', async () => {
    await renderThemed(
      <RangeChips
        ranges={[{ label: '1–25' }, { label: '26–40', contains: true }]}
        note="Vaš broj 34 je u opsegu 26–40"
      />,
      mode,
    );
    expect(screen.getByLabelText('26–40, vaš broj')).toBeTruthy();
    expect(screen.getByLabelText('1–25')).toBeTruthy();
    expect(screen.getByText('Vaš broj 34 je u opsegu 26–40')).toBeTruthy();
  });

  it('Button and Chip report presses; a disabled button does not', async () => {
    const onPress = jest.fn();
    const onChip = jest.fn();
    await renderThemed(
      <>
        <Button label="Sačuvaj" onPress={onPress} />
        <Button label="Zaključano" onPress={onPress} disabled />
        <Chip label="Kuća" selected onPress={onChip} />
      </>,
      mode,
    );
    await fireEvent.press(screen.getByLabelText('Sačuvaj'));
    await fireEvent.press(screen.getByLabelText('Zaključano'));
    await fireEvent.press(screen.getByLabelText('Kuća'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onChip).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Kuća').props.accessibilityState.selected).toBe(true);
  });

  it('Banner is announced as an alert and its action works', async () => {
    const onAction = jest.fn();
    await renderThemed(
      <Banner
        tone="warning"
        message="Obaveštenja su isključena"
        actionLabel="Otvori podešavanja"
        onAction={onAction}
      />,
      mode,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Otvori podešavanja'));
    expect(onAction).toHaveBeenCalled();
  });

  it('AddressCard strikes through the time of a cancelled outage', async () => {
    await renderThemed(
      <AddressCard
        address="Čegarska 3"
        status="past"
        statusLabel="Otkazano"
        time="08:30–12:30"
        summary="Isključenje je otkazano"
        accessibilityLabel="Čegarska 3"
      />,
      mode,
    );
    const time = StyleSheet.flatten(screen.getByText('08:30–12:30').props.style);
    expect(time.textDecorationLine).toBe('line-through');
  });

  it('AppText uses the static weight file of the font token, tabular for big numbers', async () => {
    await renderThemed(
      <>
        <AppText variant="headline">Naslov</AppText>
        <AppText variant="display">12:30</AppText>
      </>,
      mode,
    );
    const headline = StyleSheet.flatten(screen.getByText('Naslov').props.style);
    const display = StyleSheet.flatten(screen.getByText('12:30').props.style);
    expect(headline.fontFamily).toBe('Onest_700Bold');
    expect(display.fontFamily).toBe('Onest_800ExtraBold');
    expect(display.fontVariant).toEqual(['tabular-nums']);
  });

  it('BentoTile reads as one spoken sentence', async () => {
    await renderThemed(
      <BentoTile
        icon={{ ios: 'timer', android: 'timer' }}
        label="Trajanje"
        value="4 h"
        accessibilityLabel="Trajanje isključenja 4 časa"
      />,
      mode,
    );
    expect(screen.getByLabelText('Trajanje isključenja 4 časa')).toBeTruthy();
    expect(screen.getByText('4 h')).toBeTruthy();
  });

  it('RadioRow, CheckboxRow, SwitchRow and Segmented report changes with their state', async () => {
    const onSelect = jest.fn();
    const onCheck = jest.fn();
    const onSwitch = jest.fn();
    const onSeg = jest.fn();
    await renderThemed(
      <>
        <RadioRow label="Uveče" selected onSelect={onSelect} />
        <CheckboxRow label="Izmene" checked={false} onChange={onCheck} />
        <SwitchRow label="Tihi sati" value onChange={onSwitch} />
        <Segmented
          accessibilityLabel="Pismo"
          value="latin"
          onChange={onSeg}
          options={[
            { value: 'latin', label: 'Latinica' },
            { value: 'cyrillic', label: 'Ћирилица' },
          ]}
        />
      </>,
      mode,
    );
    expect(screen.getByLabelText('Uveče').props.accessibilityState.checked).toBe(true);
    expect(screen.getByLabelText('Izmene').props.accessibilityState.checked).toBe(false);
    expect(screen.getByLabelText('Tihi sati').props.accessibilityState.checked).toBe(true);
    await fireEvent.press(screen.getByLabelText('Uveče'));
    await fireEvent.press(screen.getByLabelText('Izmene'));
    await fireEvent.press(screen.getByLabelText('Tihi sati'));
    await fireEvent.press(screen.getByLabelText('Ћирилица'));
    expect(onSelect).toHaveBeenCalled();
    expect(onCheck).toHaveBeenCalledWith(true);
    expect(onSwitch).toHaveBeenCalledWith(false);
    expect(onSeg).toHaveBeenCalledWith('cyrillic');
    expect(screen.getByLabelText('Latinica').props.accessibilityState.checked).toBe(true);
  });

  it('EmptyState, SkeletonCard and SectionHeader render their text and labels', async () => {
    await renderThemed(
      <>
        <EmptyState
          icon={{ ios: 'bolt.fill', android: 'bolt' }}
          title="Nema"
          body="Ništa"
          actionLabel="Dodaj"
        />
        <SkeletonCard accessibilityLabel="Učitavanje" />
        <SectionHeader title="Adrese" trailing="3 isključenja" />
      </>,
      mode,
    );
    expect(screen.getByText('Nema')).toBeTruthy();
    expect(screen.getByLabelText('Dodaj')).toBeTruthy();
    expect(screen.getByLabelText('Učitavanje')).toBeTruthy();
    expect(screen.getByRole('header')).toBeTruthy();
    expect(screen.getByText('3 isključenja')).toBeTruthy();
  });
});
