import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MAX_ADDRESSES } from '@struja/shared';
import {
  AppText,
  Banner,
  Button,
  EmptyState,
  OutageCard,
  Screen,
  SearchField,
  SectionHeader,
  SkeletonCard,
} from '../design/components';
import { useLargeText } from '../design/largeText';
import { useTheme } from '../design/theme';
import { CARD_GAP, CARD_PADDING } from '../design/tokens';
import { belgradeDate, hhmm } from '../format/time';
import { agoLabel } from '../home/format';
import { placeMunicipality, placeName, type Place } from '../gazetteer/search';
import { dateLong } from '../outage/actions';
import { groupByDay, inScript, matchesQuery, streetsSummary, type CityOutage } from './group';

export interface Suggestion {
  place: Place;
  followed: boolean;
}

export interface UpcomingViewProps {
  now: Date;
  script: 'latn' | 'cyrl';
  outages: CityOutage[];
  // Ids of the outages that concern one of the person's addresses.
  mineIds: ReadonlySet<number>;
  query: string;
  onQuery: (query: string) => void;
  // Streets of the gazetteer that match what was typed, to follow straight away.
  suggestions: Suggestion[];
  canFollow: boolean;
  onFollow: (place: Place) => void;
  onOpen: (outageId: number) => void;
  updatedAt: number | null;
  loading: boolean;
  failed: boolean;
  offline: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onRetry: () => void;
}

/** Najave: what EDS announced for the city, by day; searchable by street; any street can be followed. */
export function UpcomingView(props: UpcomingViewProps) {
  const { t } = useTranslation();
  const large = useLargeText();
  const { colors, radius } = useTheme();
  const { now, script, query } = props;
  const today = belgradeDate(now);
  const typed = query.trim().length > 0;
  const shown = typed ? props.outages.filter((o) => matchesQuery(o, query)) : props.outages;
  const groups = groupByDay(shown, today, t);
  const haveData = !props.loading && !props.failed;

  return (
    <Screen onRefresh={props.onRefresh} refreshing={props.refreshing}>
      <AppText variant="headline" accessibilityRole="header">
        {t('upcoming.title')}
      </AppText>

      {props.offline ? <Banner tone="offline" message={t('banner.offline')} /> : null}

      <SearchField value={query} onChangeText={props.onQuery} label={t('upcoming.search')} />

      {typed && props.suggestions.length > 0 ? (
        <View style={{ gap: CARD_GAP }}>
          <SectionHeader title={t('upcoming.suggestions')} />
          <View
            style={{
              backgroundColor: colors.chrome.card,
              borderRadius: radius.xl,
              padding: CARD_PADDING,
              gap: 14,
            }}
          >
            {props.suggestions.map(({ place, followed }) => (
              <View
                key={`${place.kind}-${place.id}`}
                style={{
                  flexDirection: large ? 'column' : 'row',
                  alignItems: large ? 'stretch' : 'center',
                  gap: 12,
                }}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="bodyStrong">{placeName(place, script)}</AppText>
                  <AppText variant="label" color="textSecondary">
                    {placeMunicipality(place, script)}
                  </AppText>
                </View>
                {followed ? (
                  <AppText variant="label" color="textSecondary">
                    {t('upcoming.following')}
                  </AppText>
                ) : props.canFollow ? (
                  <Button
                    label={t('upcoming.follow')}
                    variant="secondary"
                    fullWidth={large}
                    accessibilityLabel={`${t('upcoming.follow')} ${placeName(place, script)}`}
                    onPress={() => props.onFollow(place)}
                  />
                ) : null}
              </View>
            ))}
            {!props.canFollow && props.suggestions.some((s) => !s.followed) ? (
              <AppText variant="label" color="textSecondary">
                {t('upcoming.followLimit', { max: MAX_ADDRESSES })}
              </AppText>
            ) : null}
          </View>
        </View>
      ) : null}

      {props.loading ? (
        <View style={{ gap: CARD_GAP }}>
          <SkeletonCard lines={2} accessibilityLabel={t('state.loading')} />
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
        typed ? (
          <AppText variant="body" color="textSecondary">
            {t('upcoming.noResults', { query: query.trim() })}
          </AppText>
        ) : (
          <EmptyState
            icon={{ ios: 'bolt.fill', android: 'bolt' }}
            title={t('status.clear')}
            body={t('upcoming.empty')}
          />
        )
      ) : null}

      {haveData
        ? groups.map((g) => (
            <View key={g.date} style={{ gap: CARD_GAP }}>
              <SectionHeader title={g.title} />
              {g.outages.map((o) => {
                const { shown: names, more } = streetsSummary(o.streets, script);
                const cancelled = o.status === 'cancelled';
                const mine = props.mineIds.has(o.id);
                const time = `${hhmm(o.startsAt)}–${hhmm(o.endsAt)}`;
                const place = inScript(o.municipality, script);
                const moreText = more > 0 ? t('upcoming.more', { count: more }) : undefined;
                const tags = [
                  ...(mine
                    ? [{ label: t('upcoming.mine'), icon: { ios: 'house.fill', android: 'home' } }]
                    : []),
                  ...(cancelled ? [{ label: t('status.cancelled') }] : []),
                  ...(o.status === 'changed' ? [{ label: t('upcoming.changed') }] : []),
                ];
                return (
                  <OutageCard
                    key={o.id}
                    time={time}
                    cancelled={cancelled}
                    place={place}
                    streets={names.join(', ')}
                    more={moreText}
                    tags={tags}
                    onPress={() => props.onOpen(o.id)}
                    accessibilityLabel={`${dateLong(o.outageDate, t)}, ${time}. ${place}. ${names.join(', ')}${moreText ? `, ${moreText}` : ''}.${mine ? ` ${t('upcoming.mine')}.` : ''}${cancelled ? ` ${t('status.cancelled')}.` : ''}`}
                  />
                );
              })}
            </View>
          ))
        : null}

      {haveData && props.updatedAt !== null ? (
        <View style={{ gap: 4 }}>
          <AppText variant="caption" color="textSecondary">
            {t('home.updated', { when: agoLabel(now.getTime() - props.updatedAt, t) })}
          </AppText>
          <AppText variant="caption" color="textSecondary">
            {t('home.source')}
          </AppText>
        </View>
      ) : null}
    </Screen>
  );
}
