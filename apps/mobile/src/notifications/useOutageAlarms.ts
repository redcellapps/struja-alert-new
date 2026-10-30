import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from '../api/runtime';
import { i18next } from '../i18n';
import { MY_OUTAGES_KEY, SUBSCRIPTIONS_KEY } from '../home/useHomeData';
import { queryClient } from '../query/instance';
import { useAddresses } from '../store/addresses';
import { useSettings } from '../store/settings';
import { bookFromSync, readBook, syncAlarms, writeBook } from './alarms';
import { setInvalidateHook } from './background';

/**
 * Keeps the local "Bez struje" alarms (alarms.ts) in step with the outages of the saved addresses:
 * the same two queries Početna uses (shared cache, so nothing is fetched twice), re-read whenever
 * their data changes. Also tells the push task how to refetch when a push arrives while the app runs.
 */
export function useOutageAlarms(): void {
  const onboarded = useSettings((s) => s.onboarded);
  const script = useSettings((s) => s.script);
  const language = useSettings((s) => s.language);
  const hasLocal = useAddresses((s) => s.items.length > 0);
  const enabled = onboarded && hasLocal;
  const subs = useQuery({
    queryKey: SUBSCRIPTIONS_KEY,
    queryFn: async () => (await api.subscriptions()).subscriptions,
    enabled,
  });
  const outs = useQuery({
    queryKey: MY_OUTAGES_KEY,
    queryFn: async () => (await api.myOutages('upcoming')).outages,
    enabled,
  });

  useEffect(() => {
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: MY_OUTAGES_KEY });
      void queryClient.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY });
    };
    setInvalidateHook(invalidate);
    return () => setInvalidateHook(undefined);
  }, []);

  useEffect(() => {
    if (!subs.data || !outs.data) return;
    const names = new Map(
      subs.data.map((s) => {
        const base = script === 'cyrl' ? s.name.cyrillic : s.name.latin;
        const number = s.houseNumber ? ` ${s.houseNumber}${s.houseSuffix ?? ''}` : '';
        return [s.id, `${base}${number}`];
      }),
    );
    const now = new Date();
    const book = bookFromSync(outs.data, (id) => names.get(id), readBook());
    writeBook(book);
    void syncAlarms(book, i18next.t.bind(i18next), now).catch(() => {});
  }, [subs.data, outs.data, script, language]);
}
