import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { AddressOutageDto } from '@struja/shared';
import {
  AddressCard,
  AppText,
  Banner,
  BentoTile,
  CountdownText,
  DayStrip,
  EmptyState,
  Screen,
  SectionHeader,
  SkeletonCard,
  StatusHero,
} from '../design/components';
import { useTheme } from '../design/theme';
import { CARD_GAP, type StatusKey } from '../design/tokens';
import { addDays, belgradeDate, dayOfMonth, hhmm } from '../format/time';
import { agoLabel, dayCaption, durationShort, spokenDuration, weekdayKey, type T } from './format';
import { daysWithOutage, outlookForDay, outlookFromNow, type Outlook } from './outlook';

export interface HomeAddress {
  id: number;
  label: string | null;
  // "Vojvode Mišića 34", in the chosen script.
  name: string;
  primary: boolean;
  outages: AddressOutageDto[];
}

export interface HomeViewProps {
  now: Date;
  addresses: HomeAddress[];
  // The oldest of the data timestamps (ms since epoch), null when nothing was loaded yet.
  updatedAt: number | null;
  // First load in progress with nothing to show.
  loading: boolean;
  // Loading failed and there is nothing to show.
  failed: boolean;
  // Loading failed but older data is shown.
  offline: boolean;
  notificationsOff: boolean;
  canAdd: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onAdd: () => void;
  onRetry: () => void;
  onOpenSystemSettings: () => void;
  onOpenAbout: () => void;
}

const statusWord = (status: StatusKey, t: T) =>
  status === 'past' ? t('status.cancelled') : t(`statusShort.${status}`);

const range = (o: AddressOutageDto) => `${hhmm(o.startsAt)}–${hhmm(o.endsAt)}`;

const possibleText = (o: AddressOutageDto, t: T) =>
  o.reason === 'no_number' ? t('detail.possibleNoNumber') : t('status.possible');

function HeroSection({
  outlook,
  address,
  now,
}: {
  outlook: Outlook;
  address: HomeAddress;
  now: Date;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { status, outage } = outlook;
  const on = colors.status[status].onFill;
  const today = belgradeDate(now);
  const remaining = (status === 'active' ? outlook.endsMs : outlook.startsMs) - now.getTime();

  let headline = t('home.headline.clear');
  if (status === 'upcoming' && outage) {
    headline =
      outage.outageDate === addDays(today, 1)
        ? t('home.headline.upcomingTomorrow')
        : t('home.headline.upcomingDay', {
            day: t(`home.weekdayIn.${weekdayKey(outage.outageDate)}`),
          });
  } else if (status !== 'clear' && status !== 'upcoming') {
    headline = t(`home.headline.${status}`);
  }

  let spoken = '';
  if (status === 'clear') spoken = t('status.clear');
  else if (outage) {
    const when = `${hhmm(outage.startsAt)}–${hhmm(outage.endsAt)}`;
    spoken =
      status === 'active'
        ? t('home.returnIn', { duration: spokenDuration(remaining, t) })
        : status === 'imminent'
          ? t('home.startsIn', { duration: spokenDuration(remaining, t) })
          : `${dayCaption(outage.outageDate, today, t)}, ${when}`;
  }

  return (
    <StatusHero
      status={status}
      statusLabel={statusWord(status, t)}
      headline={headline}
      address={address.name}
      accessibilityLabel={`${headline}. ${address.name}. ${spoken}`}
    >
      {status === 'imminent' || status === 'active' ? (
        <View style={{ gap: 2 }}>
          <AppText variant="label" color={on}>
            {status === 'active' ? t('home.returnInLabel') : t('home.startsInLabel')}
          </AppText>
          <CountdownText
            variant="display"
            remainingMs={remaining}
            color={on}
            accessibilityLabel={spoken}
          />
        </View>
      ) : outage ? (
        <AppText
          variant="value"
          color={on}
          style={status === 'past' ? { textDecorationLine: 'line-through' } : undefined}
        >
          {range(outage)}
        </AppText>
      ) : (
        <AppText variant="value" color={on}>
          {t('status.clear')}
        </AppText>
      )}
      {outlook.possible && outage ? (
        <AppText variant="label" color={on}>
          {possibleText(outage, t)}
        </AppText>
      ) : null}
    </StatusHero>
  );
}

function TilesSection({ outlook, now }: { outlook: Outlook; now: Date }) {
  const { t } = useTranslation();
  const { outage, status } = outlook;
  if (!outage || status === 'clear' || status === 'past') return null;
  const today = belgradeDate(now);
  const active = status === 'active';
  const first = active ? outage.endsAt : outage.startsAt;
  const caption = dayCaption(
    active ? belgradeDate(new Date(outage.endsAt)) : outage.outageDate,
    today,
    t,
  );
  return (
    <View style={{ flexDirection: 'row', gap: CARD_GAP }}>
      <BentoTile
        icon={{ ios: 'clock.fill', android: 'schedule' }}
        label={active ? t('home.returnTile') : t('home.nextTile')}
        value={hhmm(first)}
        caption={caption}
        accessibilityLabel={`${active ? t('home.returnTile') : t('home.nextTile')}: ${caption}, ${hhmm(first)}`}
      />
      <BentoTile
        icon={{ ios: 'timer', android: 'timer' }}
        label={t('home.durationTile')}
        value={durationShort(outlook.endsMs - outlook.startsMs)}
        caption={range(outage)}
        accessibilityLabel={`${t('home.durationTile')}: ${spokenDuration(outlook.endsMs - outlook.startsMs, t)}, ${range(outage)}`}
      />
    </View>
  );
}

function cardFor(address: HomeAddress, day: string, now: Date, t: T) {
  const outlook = outlookForDay(address.outages, day, now);
  const { status, outage } = outlook;
  const today = belgradeDate(now);
  const isToday = day === today;
  let time: string | undefined;
  let summary = isToday ? t('status.clear') : t('home.noOutagesThatDay');
  let spoken = summary;
  if (outage) {
    const prefix =
      isToday && outage.outageDate !== today ? `${dayCaption(outage.outageDate, today, t)} ` : '';
    time = `${prefix}${range(outage)}`;
    const length = outlook.endsMs - outlook.startsMs;
    if (status === 'past') summary = t('home.cancelledNote');
    else if (status === 'active')
      summary = t('home.returnIn', { duration: spokenDuration(outlook.endsMs - now.getTime(), t) });
    else summary = t('home.withoutPower', { duration: durationShort(length) });
    if (outlook.possible && status !== 'past') summary = `${summary} · ${possibleText(outage, t)}`;
    spoken = `${statusWord(status, t)}, ${time}. ${summary}`;
  }
  return { outlook, time, summary, spoken };
}

/** Početna: the hero for the primary address, four days, the next outage in two tiles, all addresses. */
export function HomeView(props: HomeViewProps) {
  const { t } = useTranslation();
  const { now, addresses } = props;
  const today = belgradeDate(now);
  const [selected, setSelected] = useState<string | null>(null);
  const day = selected ?? today;

  const dayList = useMemo(() => [0, 1, 2, 3].map((n) => addDays(today, n)), [today]);
  const all = useMemo(() => addresses.flatMap((a) => a.outages), [addresses]);
  const marked = daysWithOutage(all, dayList);
  const days = dayList.map((date) => {
    const wd = t(`weekday.${weekdayKey(date)}`);
    const has = marked.has(date);
    return {
      date,
      weekday: wd,
      dayOfMonth: dayOfMonth(date),
      hasOutage: has,
      status: (date === today &&
      addresses.some((a) => outlookFromNow(a.outages, now).status === 'active')
        ? 'active'
        : 'upcoming') as StatusKey,
      accessibilityLabel: `${wd}, ${dayOfMonth(date)}. ${has ? t('home.dayHas') : t('home.dayNone')}`,
    };
  });

  const primary = addresses.find((a) => a.primary) ?? addresses[0];
  const primaryOutlook = primary ? outlookFromNow(primary.outages, now) : null;
  const empty = addresses.length === 0 && !props.loading && !props.failed;

  return (
    <Screen onRefresh={props.onRefresh} refreshing={props.refreshing}>
      <AppText variant="headline" accessibilityRole="header">
        {t('tabs.home')}
      </AppText>

      {props.notificationsOff ? (
        <Banner
          tone="warning"
          message={t('banner.notificationsOff')}
          actionLabel={t('banner.openSettings')}
          onAction={props.onOpenSystemSettings}
        />
      ) : null}
      {props.offline ? <Banner tone="offline" message={t('banner.offline')} /> : null}

      {props.loading ? (
        <View style={{ gap: CARD_GAP }}>
          <SkeletonCard lines={2} accessibilityLabel={t('state.loading')} />
          <SkeletonCard lines={1} accessibilityLabel={t('state.loading')} />
        </View>
      ) : null}

      {props.failed ? (
        <EmptyState
          icon={{ ios: 'wifi.slash', android: 'cloud_off' }}
          title={t('home.loadError')}
          actionLabel={t('state.retry')}
          onAction={props.onRetry}
        />
      ) : null}

      {empty ? (
        <EmptyState
          icon={{ ios: 'bolt.fill', android: 'bolt' }}
          title={t('home.noAddress')}
          actionLabel={t('home.addAddress')}
          onAction={props.onAdd}
        />
      ) : null}

      {primary && primaryOutlook ? (
        <View style={{ gap: CARD_GAP }}>
          <HeroSection outlook={primaryOutlook} address={primary} now={now} />
          <DayStrip days={days} selected={day} onSelect={setSelected} />
          <TilesSection outlook={primaryOutlook} now={now} />
        </View>
      ) : null}

      {addresses.length > 0 ? (
        <View style={{ gap: CARD_GAP }}>
          <SectionHeader
            title={t('home.addresses')}
            actionLabel={props.canAdd ? t('home.addAddress') : undefined}
            trailing={props.canAdd ? undefined : t('outages.count', { count: all.length })}
            onAction={props.onAdd}
          />
          {addresses.map((a) => {
            const card = cardFor(a, day, now, t);
            return (
              <AddressCard
                key={a.id}
                label={a.label}
                primary={a.primary && addresses.length > 1}
                primaryLabel={t('address.primary')}
                address={a.name}
                status={card.outlook.status}
                statusLabel={statusWord(card.outlook.status, t)}
                time={card.time}
                summary={card.summary}
                accessibilityLabel={`${a.label ? `${a.label}, ` : ''}${a.name}. ${card.spoken}`}
              />
            );
          })}
        </View>
      ) : null}

      {addresses.length > 0 ? (
        <View style={{ gap: 4 }}>
          {props.updatedAt !== null ? (
            <AppText variant="caption" color="textSecondary">
              {t('home.updated', { when: agoLabel(now.getTime() - props.updatedAt, t) })}
            </AppText>
          ) : null}
          <AppText variant="caption" color="textSecondary">
            {t('home.source')}
          </AppText>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={t('home.disclaimer')}
            onPress={props.onOpenAbout}
            hitSlop={8}
          >
            <AppText variant="caption" color="link" style={{ textDecorationLine: 'underline' }}>
              {t('home.disclaimer')}
            </AppText>
          </Pressable>
        </View>
      ) : null}
    </Screen>
  );
}
