import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AddressCard, Banner, EmptyState, SectionHeader, SkeletonCard } from '../design/components';
import { STATUS_KEYS, type StatusKey } from '../design/tokens';
import { MockHero } from './mock';

/** The status hero in all five states (or one), then address cards in every state. */
export function Heroes({ only }: { only?: StatusKey }) {
  return (
    <View style={{ gap: 12 }}>
      {(only ? [only] : STATUS_KEYS).map((s) => (
        <MockHero key={s} status={s} />
      ))}
    </View>
  );
}

export function Cards() {
  const { t } = useTranslation();
  return (
    <View style={{ gap: 12 }}>
      <SectionHeader title="Adrese" trailing={t('outages.count', { count: 3 })} />
      <AddressCard
        label="Kuća"
        primary
        primaryLabel={t('address.primary')}
        address="Vojvode Mišića 34"
        status="active"
        statusLabel={t('statusShort.active')}
        time="08:30–12:30"
        summary="Povratak za 1 čas 12 minuta"
        accessibilityLabel="Kuća, Vojvode Mišića 34. Bez struje do 12:30."
      />
      <AddressCard
        label="Posao"
        address="Bulevar Nemanjića 12"
        status="upcoming"
        statusLabel={t('statusShort.upcoming')}
        time="Sutra 08:30–12:30"
        summary="4 h bez struje"
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
        time="08:30–12:30"
        summary="Isključenje je otkazano"
        accessibilityLabel="Čegarska 3. Isključenje je otkazano."
      />
    </View>
  );
}

/** Banners, skeletons, empty and error states. */
export function Feedback() {
  const { t } = useTranslation();
  return (
    <View style={{ gap: 12 }}>
      <Banner tone="offline" message={t('banner.offline')} />
      <Banner
        tone="warning"
        message={t('banner.notificationsOff')}
        actionLabel={t('banner.openSettings')}
      />
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
    </View>
  );
}
