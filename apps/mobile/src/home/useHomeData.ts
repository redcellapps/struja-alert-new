import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/runtime';
import { haptics } from '../design/haptics';
import { useAddresses } from '../store/addresses';
import { useSettings } from '../store/settings';
import type { HomeAddress, HomeViewProps } from './HomeView';

// Query keys shared with the screens that change the data (saving an address invalidates them).
export const SUBSCRIPTIONS_KEY = ['subscriptions'] as const;
export const MY_OUTAGES_KEY = ['me', 'outages', 'upcoming'] as const;

type DataProps = Pick<
  HomeViewProps,
  | 'addresses'
  | 'updatedAt'
  | 'loading'
  | 'failed'
  | 'offline'
  | 'refreshing'
  | 'onRefresh'
  | 'onRetry'
>;

/**
 * The saved addresses with their outages, from the server and from the persisted cache: last data is
 * shown at once, a refresh failing keeps it and raises the offline notice.
 */
export function useHomeData(): DataProps {
  const hasLocal = useAddresses((s) => s.items.length > 0);
  const script = useSettings((s) => s.script);
  const subs = useQuery({
    queryKey: SUBSCRIPTIONS_KEY,
    queryFn: async () => (await api.subscriptions()).subscriptions,
    enabled: hasLocal,
  });
  const outs = useQuery({
    queryKey: MY_OUTAGES_KEY,
    queryFn: async () => (await api.myOutages('upcoming')).outages,
    enabled: hasLocal,
  });
  const [refreshing, setRefreshing] = useState(false);

  const addresses: HomeAddress[] = (subs.data ?? []).map((s) => {
    const base = script === 'cyrl' ? s.name.cyrillic : s.name.latin;
    const number = s.houseNumber ? ` ${s.houseNumber}${s.houseSuffix ?? ''}` : '';
    return {
      id: s.id,
      label: s.label,
      name: `${base}${number}`,
      houseNumber: s.houseNumber,
      primary: s.isPrimary,
      outages: (outs.data ?? []).filter((o) => o.subscriptionId === s.id),
    };
  });

  const haveData = subs.data !== undefined && outs.data !== undefined;
  const errored = subs.isError || outs.isError;
  const stamps = [subs.dataUpdatedAt, outs.dataUpdatedAt].filter((n) => n > 0);

  const refetch = async () => {
    await Promise.all([subs.refetch(), outs.refetch()]);
  };

  return {
    addresses: haveData ? addresses : [],
    updatedAt: haveData && stamps.length > 0 ? Math.min(...stamps) : null,
    loading: hasLocal && !haveData && !errored,
    failed: hasLocal && !haveData && errored,
    offline: haveData && errored,
    refreshing,
    onRefresh: () => {
      setRefreshing(true);
      void refetch().finally(() => {
        setRefreshing(false);
        haptics.light();
      });
    },
    onRetry: () => void refetch(),
  };
}
