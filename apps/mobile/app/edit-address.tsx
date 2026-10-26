import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { api } from '../src/api/runtime';
import { HouseNumberForm } from '../src/addresses/HouseNumberForm';
import { saveHouseNumber } from '../src/addresses/houseNumber';
import { EmptyState, Screen, SheetHeader, SkeletonCard } from '../src/design/components';
import { MY_OUTAGES_KEY, SUBSCRIPTIONS_KEY } from '../src/home/useHomeData';
import { useSettings } from '../src/store/settings';

// A modal sheet to add or change the house number of a saved address ("Dodaj broj" on Početna, "Promeni
// broj" in Podešavanja).
export default function EditAddressSheet() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const script = useSettings((s) => s.script);
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: SUBSCRIPTIONS_KEY,
    queryFn: async () => (await api.subscriptions()).subscriptions,
  });
  const subscription = data?.find((s) => String(s.id) === id);
  const header = <SheetHeader onClose={() => router.back()} />;

  if (!subscription) {
    return (
      <Screen inset="none" header={header}>
        {isPending && !isError ? (
          <SkeletonCard lines={1} accessibilityLabel={t('state.loading')} />
        ) : isError && data === undefined ? (
          <EmptyState
            icon={{ ios: 'wifi.slash', android: 'cloud_off' }}
            title={t('home.loadError')}
            actionLabel={t('state.retry')}
            onAction={() => void refetch()}
          />
        ) : (
          <EmptyState
            icon={{ ios: 'house.fill', android: 'home' }}
            title={t('address.notFound')}
            actionLabel={t('state.close')}
            onAction={() => router.back()}
          />
        )}
      </Screen>
    );
  }
  return (
    <Screen inset="none" header={header}>
      <HouseNumberForm
        name={script === 'cyrl' ? subscription.name.cyrillic : subscription.name.latin}
        initialText={
          subscription.houseNumber
            ? `${subscription.houseNumber}${subscription.houseSuffix ?? ''}`
            : undefined
        }
        save={async (number) => {
          const saved = await saveHouseNumber(api, subscription, number);
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY }),
            queryClient.invalidateQueries({ queryKey: MY_OUTAGES_KEY }),
          ]);
          return saved;
        }}
        onSaved={() => router.back()}
      />
    </Screen>
  );
}
