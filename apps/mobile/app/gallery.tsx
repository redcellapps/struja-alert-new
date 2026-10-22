import { Redirect, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StatusBar, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import {
  AddressCard,
  AppText,
  Banner,
  Button,
  Chip,
  CountdownText,
  DayStrip,
  EmptyState,
  RangeChips,
  SectionHeader,
  SkeletonCard,
  StatusHero,
  TimelineBar,
} from '../src/design/components';
import { useTheme } from '../src/design/theme';
import { STATUS_KEYS, type StatusKey } from '../src/design/tokens';
import { addDays, dayOfMonth, weekdayIndex } from '../src/format/time';

// Development-only gallery of every design component in every state, used for the design review
// (adb screenshots, light and dark). `strujaalert://gallery?section=hero&status=active` opens one
// section; no parameters shows the hero in all five states.
const SECTIONS = ['hero', 'cards', 'controls', 'feedback'] as const;
type Section = (typeof SECTIONS)[number];

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const TODAY = '2026-11-03';
const HOUR = 3_600_000;

function Hero({ status }: { status: StatusKey }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const on = colors.status[status].onContainer;
  const address = 'Vojvode Mišića 34, Niš';
  const text = {
    clear: { headline: t('status.clear'), detail: null },
    upcoming: { headline: t('status.upcoming'), detail: 'Sutra 08:30–12:30' },
    imminent: { headline: t('status.imminent'), detail: 'Počinje za' },
    active: { headline: t('status.active'), detail: 'Povratak za' },
    past: { headline: t('status.past'), detail: 'Danas 08:30–12:30' },
  }[status];
  const remaining = status === 'active' ? 1 * HOUR + 12 * 60_000 + 5_000 : 5 * HOUR + 40 * 60_000;
  return (
    <StatusHero
      status={status}
      statusLabel={t(`statusShort.${status}`)}
      headline={text.headline}
      address={address}
      accessibilityLabel={`${text.headline}. ${address}`}
    >
      {status === 'imminent' || status === 'active' ? (
        <View style={{ gap: 2 }}>
          <AppText variant="label" color={on}>
            {text.detail}
          </AppText>
          <CountdownText
            remainingMs={remaining}
            color={on}
            accessibilityLabel={
              status === 'active'
                ? 'Povratak struje za 1 čas i 12 minuta'
                : 'Počinje za 5 časova i 40 minuta'
            }
          />
        </View>
      ) : text.detail ? (
        <AppText variant="bodyStrong" color={on}>
          {text.detail}
        </AppText>
      ) : null}
    </StatusHero>
  );
}

export default function Gallery() {
  const { section, status } = useLocalSearchParams<{ section?: string; status?: string }>();
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [day, setDay] = useState(TODAY);
  const [label, setLabel] = useState('home');

  if (!__DEV__) return <Redirect href="/" />;

  const only = (SECTIONS as readonly string[]).includes(section ?? '')
    ? (section as Section)
    : null;
  const show = (s: Section) => only === null || only === s;
  const days = [0, 1, 2, 3].map((n) => {
    const date = addDays(TODAY, n);
    const wd = t(`weekday.${WEEKDAY_KEYS[weekdayIndex(date)]}`);
    return {
      date,
      weekday: wd,
      dayOfMonth: dayOfMonth(date),
      hasOutage: n === 1 || n === 3,
      accessibilityLabel: `${wd}, ${dayOfMonth(date)}. ${n === 1 || n === 3 ? 'ima isključenja' : 'nema isključenja'}`,
    };
  });
  const heroes: StatusKey[] = (STATUS_KEYS as readonly string[]).includes(status ?? '')
    ? [status as StatusKey]
    : [...STATUS_KEYS];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.chrome.surface }}
      contentContainerStyle={{
        paddingTop: insets.top + 16,
        paddingBottom: insets.bottom + 24,
        paddingHorizontal: 16,
        gap: 16,
      }}
    >
      <StatusBar barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'} />
      <AppText variant="label" color="onSurfaceVariant">
        {t('gallery.title')} · {theme.name}
        {theme.contrast === 'high' ? ' · high contrast' : ''}
      </AppText>

      {show('hero') && heroes.map((s) => <Hero key={s} status={s} />)}

      {show('cards') && (
        <>
          <SectionHeader title="Dani" trailing="4 dana" />
          <DayStrip days={days} selected={day} onSelect={setDay} />
          <SectionHeader title="Adrese" trailing={t('outages.count', { count: 3 })} />
          <AddressCard
            label="Kuća"
            primary
            primaryLabel={t('address.primary')}
            address="Vojvode Mišića 34"
            status="active"
            statusLabel={t('statusShort.active')}
            summary="Danas 08:30–12:30 · povratak za 1 čas 12 minuta"
            accessibilityLabel="Kuća, Vojvode Mišića 34. Bez struje do 12:30."
          />
          <AddressCard
            label="Posao"
            address="Bulevar Nemanjića 12"
            status="upcoming"
            statusLabel={t('statusShort.upcoming')}
            summary="Sutra 08:30–12:30"
            accessibilityLabel="Posao, Bulevar Nemanjića 12. Najavljeno isključenje sutra od 8:30 do 12:30."
          />
          <AddressCard
            label="Roditelji"
            address="Studenička 7"
            status="clear"
            statusLabel={t('statusShort.clear')}
            summary={t('status.clear')}
            accessibilityLabel="Roditelji, Studenička 7. Nema najavljenih isključenja."
          />
          <AddressCard
            address="Čegarska 3"
            status="past"
            statusLabel={t('status.cancelled')}
            summary="Otkazano · 08:30–12:30"
            accessibilityLabel="Čegarska 3. Isključenje je otkazano."
          />
        </>
      )}

      {show('controls') && (
        <>
          <SectionHeader title="Dugmad" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button label={t('address.save')} />
            <Button label={t('home.addAddress')} variant="tonal" />
            <Button label={t('onboarding.later')} variant="text" />
            <Button label={t('address.save')} disabled />
          </View>
          <SectionHeader title={t('address.label')} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(
              [
                ['home', t('address.labelHome')],
                ['work', t('address.labelWork')],
                ['parents', t('address.labelParents')],
                ['custom', t('address.labelCustom')],
              ] as const
            ).map(([k, text]) => (
              <Chip key={k} label={text} selected={label === k} onPress={() => setLabel(k)} />
            ))}
          </View>
          <SectionHeader title={t('detail.affectedStreets')} />
          <RangeChips
            ranges={[
              { label: 'neparni 1–25' },
              { label: '26–40', contains: true },
              { label: 'parni 42–60' },
              { label: 'cela ulica' },
            ]}
            note={t('detail.yourNumber', { n: 34, range: '26–40' })}
          />
          <SectionHeader title="24 h" />
          <TimelineBar
            startHour={8.5}
            endHour={12.5}
            nowHour={7.2}
            status="imminent"
            accessibilityLabel="Isključenje od 8:30 do 12:30, sada je 7:12"
          />
          <TimelineBar
            startHour={8.5}
            endHour={12.5}
            nowHour={10.4}
            status="active"
            accessibilityLabel="Isključenje od 8:30 do 12:30, sada je 10:24"
          />
        </>
      )}

      {show('feedback') && (
        <>
          <Banner tone="offline" message={t('banner.offline')} />
          <Banner
            tone="warning"
            message={t('banner.notificationsOff')}
            actionLabel={t('banner.openSettings')}
          />
          <SectionHeader title={t('state.loading')} />
          <SkeletonCard accessibilityLabel={t('state.loading')} />
          <SkeletonCard lines={3} accessibilityLabel={t('state.loading')} />
          <EmptyState
            icon={{ ios: 'bolt.fill', android: 'bolt' }}
            title={t('status.clear')}
            body={t('history.empty')}
            actionLabel={t('home.addAddress')}
          />
          <EmptyState
            icon={{ ios: 'exclamationmark.triangle', android: 'warning' }}
            title={t('state.error')}
            actionLabel={t('state.retry')}
          />
        </>
      )}
    </ScrollView>
  );
}
