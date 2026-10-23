import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { AddressOutageDto } from '@struja/shared';
import {
  AddressCard,
  AppText,
  Banner,
  BentoTile,
  DayStrip,
  EmptyState,
  RemainingText,
  Screen,
  SectionHeader,
  SkeletonCard,
  StatusHero,
} from '../design/components';
import { useTheme } from '../design/theme';
import { CARD_GAP, type StatusKey } from '../design/tokens';
import { addDays, belgradeDate, dayOfMonth, hhmm } from '../format/time';
import {
  agoLabel,
  dayCaption,
  durationShort,
  hoursUntil,
  spokenDuration,
  weekdayKey,
  type T,
} from './format';
import { daysWithOutage, outlookForDay, outlookFromNow, type Outlook } from './outlook';

export interface HomeAddress {
  id: number;
  label: string | null;
  // "Vojvode Mišića 34", in the chosen script.
  name: string;
  houseNumber: number | null;
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
  // Opens the address to add the house number (the server id of the address).
  onAddNumber: (addressId: number) => void;
  // Opens an outage (its id) as it concerns an address (the address id).
  onOpenOutage: (outageId: number, addressId: number) => void;
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
  onOpen,
}: {
  outlook: Outlook;
  address: HomeAddress;
  now: Date;
  onOpen: (outageId: number, addressId: number) => void;
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
  if (outlook.possible && outage) spoken = `${possibleText(outage, t)}. ${spoken}`;

  return (
    <StatusHero
      status={status}
      statusLabel={statusWord(status, t)}
      possible={outlook.possible && status !== 'past' ? t('home.possibleBadge') : undefined}
      headline={headline}
      address={address.name}
      accessibilityLabel={`${headline}. ${address.name}. ${spoken}`}
      onPress={outage ? () => onOpen(outage.id, address.id) : undefined}
    >
      {status === 'imminent' || status === 'active' ? (
        <View style={{ gap: 2 }}>
          <AppText variant="label" color={on}>
            {status === 'active' ? t('home.returnInLabel') : t('home.startsInLabel')}
          </AppText>
          <RemainingText
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
      {outlook.possible && outage && status !== 'past' ? (
        <AppText variant="label" color={on}>
          {possibleText(outage, t)}
        </AppText>
      ) : null}
    </StatusHero>
  );
}

/**
 * Two tiles that add to the hero instead of repeating it: how long until the next outage starts across
 * all addresses (or, while one is running, when the power returns), and how many outages the four days
 * hold. Nothing is shown when there is no outage at all.
 */
export function TilesSection({
  addresses,
  days,
  now,
}: {
  addresses: HomeAddress[];
  days: readonly string[];
  now: Date;
}) {
  const { t } = useTranslation();
  const today = belgradeDate(now);
  const outlooks = addresses.map((a) => ({ a, o: outlookFromNow(a.outages, now) }));
  const running = outlooks
    .filter((x) => x.o.status === 'active')
    .sort((x, y) => x.o.endsMs - y.o.endsMs)[0];
  const next = outlooks
    .filter((x) => x.o.status === 'imminent' || x.o.status === 'upcoming')
    .sort((x, y) => x.o.startsMs - y.o.startsMs)[0];
  const ids = new Set<number>();
  for (const a of addresses)
    for (const o of a.outages)
      if (o.status !== 'cancelled' && days.includes(o.outageDate)) ids.add(o.id);
  if (!running && !next && ids.size === 0) return null;

  const several = addresses.length > 1;
  let first: { label: string; value: string; caption: string; spoken: string } | null = null;
  if (running?.o.outage) {
    const end = running.o.outage.endsAt;
    const caption = several
      ? (running.a.label ?? running.a.name)
      : dayCaption(belgradeDate(new Date(end)), today, t);
    first = {
      label: t('home.returnTile'),
      value: hhmm(end),
      caption,
      spoken: `${t('home.returnTile')}: ${hhmm(end)}, ${caption}`,
    };
  } else if (next?.o.outage) {
    const ms = next.o.startsMs - now.getTime();
    const when = `${dayCaption(next.o.outage.outageDate, today, t)} ${hhmm(next.o.outage.startsAt)}`;
    const caption = several ? `${next.a.label ?? next.a.name} · ${when}` : when;
    first = {
      label: t('home.startsInLabel'),
      value: hoursUntil(ms),
      caption,
      spoken: `${t('home.startsInLabel')} ${spokenDuration(ms, t)}, ${caption}`,
    };
  }
  const count = t('outages.count', { count: ids.size });
  const word = t('outages.word', { count: ids.size });
  return (
    <View style={{ flexDirection: 'row', gap: CARD_GAP }}>
      {first ? (
        <BentoTile
          icon={{ ios: 'clock.fill', android: 'schedule' }}
          label={first.label}
          value={first.value}
          caption={first.caption}
          accessibilityLabel={first.spoken}
        />
      ) : null}
      <BentoTile
        icon={{ ios: 'calendar', android: 'calendar_month' }}
        label={t('home.nextDaysTile')}
        value={String(ids.size)}
        caption={word}
        accessibilityLabel={`${t('home.nextDaysTile')}: ${count}`}
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
  // "Moguće" with no number entered: adding the house number settles it.
  const canAddNumber =
    outlook.possible &&
    status !== 'past' &&
    outage?.reason === 'no_number' &&
    address.houseNumber === null;
  return { outlook, time, summary, spoken, canAddNumber };
}

/** Početna: the hero for the primary address, four days, two tiles, all addresses. */
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
  const addressesTitle =
    day === today
      ? t('home.addresses')
      : t('home.sectionDay', {
          title: t('home.addresses'),
          day: `${t(`home.weekdayLong.${weekdayKey(day)}`)} ${dayOfMonth(day)}.`,
        });

  return (
    <Screen onRefresh={props.onRefresh} refreshing={props.refreshing}>
      <AppText variant="headline" accessibilityRole="header">
        {t('tabs.home')}
      </AppText>

      {props.notificationsOff ? (
        <Banner
          tone="warning"
          message={t('banner.notificationsOff')}
          actionLabel={t('banner.turnOn')}
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
          <HeroSection
            outlook={primaryOutlook}
            address={primary}
            now={now}
            onOpen={props.onOpenOutage}
          />
          <DayStrip days={days} selected={day} onSelect={setSelected} />
          <TilesSection addresses={addresses} days={dayList} now={now} />
        </View>
      ) : null}

      {addresses.length > 0 ? (
        <View style={{ gap: CARD_GAP }}>
          <SectionHeader
            title={addressesTitle}
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
                possible={
                  card.outlook.possible && card.outlook.status !== 'past'
                    ? t('home.possibleBadge')
                    : undefined
                }
                time={card.time}
                summary={card.summary}
                action={
                  card.canAddNumber
                    ? { label: t('home.addNumber'), onPress: () => props.onAddNumber(a.id) }
                    : undefined
                }
                onPress={
                  card.outlook.outage
                    ? () => props.onOpenOutage(card.outlook.outage!.id, a.id)
                    : undefined
                }
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
