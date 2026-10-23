import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '../src/api/runtime';
import { HouseNumberForm } from '../src/addresses/HouseNumberForm';
import { saveHouseNumber } from '../src/addresses/houseNumber';
import { Screen } from '../src/design/components';
import { MY_OUTAGES_KEY, SUBSCRIPTIONS_KEY } from '../src/home/useHomeData';
import { useSettings } from '../src/store/settings';

// A modal sheet to add the house number to a saved address ("Dodaj broj" on Početna).
export default function EditAddressSheet() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const script = useSettings((s) => s.script);
  const { data } = useQuery({
    queryKey: SUBSCRIPTIONS_KEY,
    queryFn: async () => (await api.subscriptions()).subscriptions,
  });
  const subscription = data?.find((s) => String(s.id) === id);
  if (!subscription) return <Screen inset="none">{null}</Screen>;
  return (
    <Screen inset="none">
      <HouseNumberForm
        name={script === 'cyrl' ? subscription.name.cyrillic : subscription.name.latin}
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
