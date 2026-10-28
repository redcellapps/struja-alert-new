import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { MAX_ADDRESSES } from '@struja/shared';
import { api } from '../../src/api/runtime';
import { useGazetteer } from '../../src/gazetteer/cache';
import { findStreetById } from '../../src/gazetteer/search';
import { useMinuteNow } from '../../src/design/useNow';
import { SUBSCRIPTIONS_KEY } from '../../src/home/useHomeData';
import {
  addToCalendar,
  calendarAvailable,
  calendarEvent,
  openSource,
  shareMessage,
  shareOutage,
  todayInBelgrade,
} from '../../src/outage/actions';
import { OutageDetailView, type DetailAddress } from '../../src/outage/OutageDetailView';
import { useAddresses } from '../../src/store/addresses';
import { useSettings } from '../../src/store/settings';

// A modal sheet: one outage, and how it concerns the person's saved addresses.
export default function OutageSheet() {
  const { id, addressId } = useLocalSearchParams<{ id?: string; addressId?: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const now = useMinuteNow();
  const script = useSettings((s) => s.script);
  const detailQuery = useQuery({
    queryKey: ['outage', id],
    queryFn: () => api.outage(Number(id)),
    enabled: id !== undefined,
  });
  const subsQuery = useQuery({
    queryKey: SUBSCRIPTIONS_KEY,
    queryFn: async () => (await api.subscriptions()).subscriptions,
  });
  const detail = detailQuery.data ?? null;
  const saved = useAddresses((s) => s.items);
  const { index } = useGazetteer('nis');

  // The saved addresses this outage concerns, with the street and the number to compare with its ranges.
  const addresses: DetailAddress[] = (detail?.mine ?? []).flatMap((m) => {
    const sub = subsQuery.data?.find((s) => s.id === m.subscriptionId);
    if (!sub) return [];
    const street = script === 'cyrl' ? sub.name.cyrillic : sub.name.latin;
    return [
      {
        subscriptionId: sub.id,
        label: sub.label,
        street: sub.name,
        name: `${street}${sub.houseNumber ? ` ${sub.houseNumber}${sub.houseSuffix ?? ''}` : ''}`,
        houseNumber: sub.houseNumber,
        streetId: sub.streetId,
        match: m.match,
        reason: m.reason,
      },
    ];
  });
  // Where, in words: the person's address(es), otherwise the first streets of the outage.
  const where = detail
    ? addresses.length > 0
      ? addresses.map((a) => a.name).join(', ')
      : detail.segments
          .slice(0, 3)
          .map((seg) => seg.name?.[script === 'cyrl' ? 'cyrillic' : 'latin'] ?? seg.raw)
          .join(', ')
    : '';

  return (
    <OutageDetailView
      now={now}
      script={script}
      detail={detail}
      addresses={addresses}
      loading={detailQuery.isPending && !detailQuery.isError}
      failed={detailQuery.isError && !detail}
      offline={detailQuery.isError && !!detail}
      onRetry={() => void detailQuery.refetch()}
      onClose={() => router.back()}
      followState={(segment) => {
        // the exact street of the segment (a name can belong to several)
        const place =
          segment.streetId !== null && index ? findStreetById(index, segment.streetId) : undefined;
        if (!place) return 'none';
        if (saved.some((a) => a.request.streetId === place.id)) return 'followed';
        return saved.length < MAX_ADDRESSES ? 'can' : 'none';
      }}
      onFollow={(segment) => {
        const place =
          segment.streetId !== null && index ? findStreetById(index, segment.streetId) : undefined;
        if (place)
          router.push({
            pathname: '/add-address',
            params: { kind: 'street', id: String(place.id) },
          });
      }}
      onAddNumber={(subscriptionId) =>
        router.push({ pathname: '/edit-address', params: { id: String(subscriptionId) } })
      }
      onCalendar={
        calendarAvailable && detail
          ? () => void addToCalendar(calendarEvent(detail, where, script, t)).catch(() => {})
          : undefined
      }
      onShare={() => {
        if (detail)
          void shareOutage(shareMessage(detail, todayInBelgrade(), script, t)).catch(() => {});
      }}
      onOpenSource={() => {
        if (detail) void openSource(detail.source.url).catch(() => {});
      }}
      onReport={(message) =>
        api.report({
          outageId: Number(id),
          subscriptionId: addressId ? Number(addressId) : addresses[0]?.subscriptionId,
          message,
        })
      }
    />
  );
}
