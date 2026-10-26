import { useQuery, useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { Linking } from 'react-native';
import { MAX_ADDRESSES } from '@struja/shared';
import { api } from '../../src/api/runtime';
import { MY_OUTAGES_KEY, SUBSCRIPTIONS_KEY } from '../../src/home/useHomeData';
import { deleteAddress, makePrimary } from '../../src/settings/addresses';
import { deleteEverything } from '../../src/settings/deleteData';
import { realDeleteDeps } from '../../src/settings/runtime';
import { SettingsView, type SettingsAddress } from '../../src/settings/SettingsView';
import { useAddresses } from '../../src/store/addresses';
import { useSettings } from '../../src/store/settings';

const EDS_URL = 'https://elektrodistribucija.rs';

export default function SettingsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const settings = useSettings();
  const saved = useAddresses((s) => s.items);
  const subs = useQuery({
    queryKey: SUBSCRIPTIONS_KEY,
    queryFn: async () => (await api.subscriptions()).subscriptions,
    enabled: saved.length > 0,
  });
  const list = subs.data ?? [];

  const addresses: SettingsAddress[] = list.map((s) => ({
    id: s.id,
    label: s.label,
    name: `${settings.script === 'cyrl' ? s.name.cyrillic : s.name.latin}${s.houseNumber ? ` ${s.houseNumber}${s.houseSuffix ?? ''}` : ''}`,
    primary: s.isPrimary,
    canHaveNumber: s.streetId !== null,
    hasNumber: s.houseNumber !== null,
  }));

  // Whatever changed about the addresses, Početna, Najave and Istorija read them again.
  const refreshAddresses = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY }),
      queryClient.invalidateQueries({ queryKey: MY_OUTAGES_KEY }),
      queryClient.invalidateQueries({ queryKey: ['me'] }),
    ]);
  const find = (id: number) => list.find((s) => s.id === id);

  return (
    <SettingsView
      values={{
        themeMode: settings.themeMode,
        language: settings.language,
        script: settings.script,
        highContrast: settings.highContrast,
        enabledKinds: settings.enabledKinds,
        quietHours: settings.quietHours,
      }}
      onChange={(patch) => settings.set(patch)}
      permission={settings.notificationPermission}
      onOpenSystemSettings={() => void Linking.openSettings()}
      addresses={addresses}
      addressesState={
        saved.length > 0 && subs.isPending && !subs.isError
          ? 'loading'
          : subs.isError && subs.data === undefined
            ? 'error'
            : 'ready'
      }
      onRetryAddresses={() => void subs.refetch()}
      offline={subs.isError && subs.data !== undefined}
      canAdd={saved.length < MAX_ADDRESSES}
      onAdd={() => router.push('/add-address')}
      onEditNumber={(id) => router.push({ pathname: '/edit-address', params: { id: String(id) } })}
      onMakePrimary={async (id) => {
        const sub = find(id);
        if (!sub) return;
        await makePrimary(api, sub);
        await refreshAddresses();
      }}
      onDeleteAddress={async (id) => {
        const sub = find(id);
        if (!sub) return;
        await deleteAddress(api, sub);
        await refreshAddresses();
      }}
      onDeleteAll={async () => {
        await deleteEverything(realDeleteDeps);
        // nothing is left: back to the first screen of a new installation
        router.replace('/onboarding');
      }}
      onSendFeedback={(message) => api.report({ message })}
      onOpenEds={() => void Linking.openURL(EDS_URL)}
      version={Constants.expoConfig?.version ?? '0.0.0'}
    />
  );
}
