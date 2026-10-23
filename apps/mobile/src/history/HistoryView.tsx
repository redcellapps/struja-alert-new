import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { AddressOutageDto } from '@struja/shared';
import {
  AppText,
  Banner,
  BentoTile,
  EmptyState,
  OutageCard,
  Screen,
  SectionHeader,
  SkeletonCard,
} from '../design/components';
import { CARD_GAP } from '../design/tokens';
import { dayOfMonth, hhmm } from '../format/time';
import { agoLabel, durationShort, spokenDuration, weekdayKey } from '../home/format';
import { dateLong } from '../outage/actions';
import { groupByMonth, ofSavedAddresses, yearOf, yearSummary } from './group';

export interface HistoryAddress {
  id: number;
  label: string | null;
  name: string;
}

export interface HistoryViewProps {
  now: Date;
  outages: AddressOutageDto[];
  // The saved addresses, to say which one each outage concerned.
  addresses: HistoryAddress[];
  updatedAt: number | null;
  loading: boolean;
  failed: boolean;
  offline: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onRetry: () => void;
  onOpen: (outageId: number, addressId: number) => void;
}

/** Istorija: the outages of the saved addresses that are over, by month, with the year in two numbers. */
export function HistoryView(props: HistoryViewProps) {
  const { t } = useTranslation();
  const { now } = props;
  const haveData = !props.loading && !props.failed;
  const outages = ofSavedAddresses(
    props.outages,
    props.addresses.map((a) => a.id),
  );
  const groups = groupByMonth(outages, t);
  const summary = yearSummary(outages, yearOf(now));
  const byId = new Map(props.addresses.map((a) => [a.id, a]));

  return (
    <Screen onRefresh={props.onRefresh} refreshing={props.refreshing}>
      <AppText variant="headline" accessibilityRole="header">
        {t('history.title')}
      </AppText>

      {props.offline ? <Banner tone="offline" message={t('banner.offline')} /> : null}

      {props.loading ? (
        <View style={{ gap: CARD_GAP }}>
          <SkeletonCard lines={1} accessibilityLabel={t('state.loading')} />
          <SkeletonCard lines={2} accessibilityLabel={t('state.loading')} />
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

      {haveData && groups.length === 0 ? (
        <EmptyState
          icon={{ ios: 'clock.arrow.circlepath', android: 'history' }}
          title={t('history.empty')}
        />
      ) : null}

      {haveData && groups.length > 0 ? (
        <View style={{ flexDirection: 'row', gap: CARD_GAP }}>
          <BentoTile
            icon={{ ios: 'bolt.slash.fill', android: 'power_off' }}
            label={t('history.yearTile')}
            value={String(summary.count)}
            caption={t('outages.word', { count: summary.count })}
            accessibilityLabel={t('history.summary', {
              count: summary.count,
              hours: summary.hours,
            })}
          />
          <BentoTile
            icon={{ ios: 'timer', android: 'timer' }}
            label={t('history.hoursTile')}
            value={`${summary.hours} h`}
            caption={t('history.hoursCaption')}
            accessibilityLabel={`${t('history.hoursTile')}: ${summary.hours} h`}
          />
        </View>
      ) : null}

      {haveData
        ? groups.map((g) => (
            <View key={g.key} style={{ gap: CARD_GAP }}>
              <SectionHeader
                title={g.title}
                trailing={t('outages.count', { count: g.outages.length })}
              />
              {g.outages.map((o) => {
                const address = byId.get(o.subscriptionId);
                const cancelled = o.status === 'cancelled';
                const wd = t(`weekday.${weekdayKey(o.outageDate)}`);
                const time = `${wd} ${dayOfMonth(o.outageDate)}. · ${hhmm(o.startsAt)}–${hhmm(o.endsAt)}`;
                const ms = Date.parse(o.endsAt) - Date.parse(o.startsAt);
                const where = address ? (address.label ?? address.name) : '';
                return (
                  <OutageCard
                    key={o.id}
                    time={time}
                    cancelled={cancelled}
                    place={where}
                    streets={
                      cancelled
                        ? t('home.cancelledNote')
                        : t('home.withoutPower', { duration: durationShort(ms) })
                    }
                    tags={cancelled ? [{ label: t('status.cancelled') }] : []}
                    onPress={() => props.onOpen(o.id, o.subscriptionId)}
                    accessibilityLabel={`${dateLong(o.outageDate, t)}, ${hhmm(o.startsAt)}–${hhmm(o.endsAt)}. ${where}. ${cancelled ? t('status.cancelled') : spokenDuration(ms, t)}.`}
                  />
                );
              })}
            </View>
          ))
        : null}

      {haveData && props.updatedAt !== null ? (
        <AppText variant="caption" color="textSecondary">
          {t('home.updated', { when: agoLabel(now.getTime() - props.updatedAt, t) })}
        </AppText>
      ) : null}
    </Screen>
  );
}
