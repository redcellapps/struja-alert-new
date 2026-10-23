import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { MAX_ADDRESSES } from '@struja/shared';
import { api } from '../../src/api/runtime';
import { haptics } from '../../src/design/haptics';
import { useMinuteNow } from '../../src/design/useNow';
import { useGazetteer } from '../../src/gazetteer/cache';
import { search, type Place } from '../../src/gazetteer/search';
import { MY_OUTAGES_KEY } from '../../src/home/useHomeData';
import { useAddresses } from '../../src/store/addresses';
import { useSettings } from '../../src/store/settings';
import { CITY_OUTAGES_KEY } from '../../src/upcoming/keys';
import { UpcomingView } from '../../src/upcoming/UpcomingView';

export default function UpcomingScreen() {
  const router = useRouter();
  const now = useMinuteNow();
  const script = useSettings((s) => s.script);
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const addresses = useAddresses((s) => s.items);
  const { index } = useGazetteer('nis');

  const city = useQuery({
    queryKey: CITY_OUTAGES_KEY,
    queryFn: async () => (await api.cityOutages('nis')).outages,
  });
  // Which of the announced outages concern the person's own addresses.
  const mine = useQuery({
    queryKey: MY_OUTAGES_KEY,
    queryFn: async () => (await api.myOutages('upcoming')).outages,
    enabled: addresses.length > 0,
  });
  const mineIds = useMemo(() => new Set((mine.data ?? []).map((o) => o.id)), [mine.data]);

  // Streets that match what was typed, so a street with no outage today can be followed too.
  const suggestions = useMemo(() => {
    if (!index || query.trim().length < 2) return [];
    const followed = new Set(addresses.map((a) => a.request.streetId));
    return search(index, query, 8)
      .filter((p) => p.kind === 'street')
      .slice(0, 3)
      .map((place) => ({ place, followed: followed.has(place.id) }));
  }, [index, query, addresses]);

  const follow = (place: Place) =>
    router.push({ pathname: '/add-address', params: { kind: place.kind, id: String(place.id) } });

  return (
    <UpcomingView
      now={now}
      script={script}
      outages={city.data ?? []}
      mineIds={mineIds}
      query={query}
      onQuery={setQuery}
      suggestions={suggestions}
      canFollow={addresses.length < MAX_ADDRESSES}
      onFollow={follow}
      onOpen={(id) => router.push({ pathname: '/outage/[id]', params: { id: String(id) } })}
      updatedAt={city.data ? city.dataUpdatedAt : null}
      loading={city.isPending && !city.isError}
      failed={city.isError && city.data === undefined}
      offline={city.isError && city.data !== undefined}
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void Promise.all([city.refetch(), mine.refetch()]).finally(() => {
          setRefreshing(false);
          haptics.light();
        });
      }}
      onRetry={() => void city.refetch()}
    />
  );
}
