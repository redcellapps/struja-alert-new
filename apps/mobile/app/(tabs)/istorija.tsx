import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { api } from '../../src/api/runtime';
import { haptics } from '../../src/design/haptics';
import { useMinuteNow } from '../../src/design/useNow';
import { HISTORY_KEY } from '../../src/history/keys';
import { HistoryView } from '../../src/history/HistoryView';
import { SUBSCRIPTIONS_KEY } from '../../src/home/useHomeData';
import { useSettings } from '../../src/store/settings';

export default function HistoryScreen() {
  const router = useRouter();
  const now = useMinuteNow();
  const script = useSettings((s) => s.script);
  const [refreshing, setRefreshing] = useState(false);

  const history = useQuery({
    queryKey: HISTORY_KEY,
    queryFn: async () => (await api.myOutages('history')).outages,
  });
  const subs = useQuery({
    queryKey: SUBSCRIPTIONS_KEY,
    queryFn: async () => (await api.subscriptions()).subscriptions,
  });
  const addresses = (subs.data ?? []).map((s) => ({
    id: s.id,
    label: s.label,
    name: `${script === 'cyrl' ? s.name.cyrillic : s.name.latin}${s.houseNumber ? ` ${s.houseNumber}${s.houseSuffix ?? ''}` : ''}`,
  }));

  return (
    <HistoryView
      now={now}
      outages={history.data ?? []}
      addresses={addresses}
      updatedAt={history.data ? history.dataUpdatedAt : null}
      loading={history.isPending && !history.isError}
      failed={history.isError && history.data === undefined}
      offline={history.isError && history.data !== undefined}
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void Promise.all([history.refetch(), subs.refetch()]).finally(() => {
          setRefreshing(false);
          haptics.light();
        });
      }}
      onRetry={() => void history.refetch()}
      onOpen={(id, addressId) =>
        router.push({
          pathname: '/outage/[id]',
          params: { id: String(id), addressId: String(addressId) },
        })
      }
    />
  );
}
