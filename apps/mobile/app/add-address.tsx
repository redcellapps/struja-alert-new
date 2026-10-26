import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AddAddressContainer } from '../src/addresses/AddAddressContainer';
import { AppText, Screen, SheetHeader } from '../src/design/components';

// A modal sheet (presentation set in the root layout). Closing it, or saving, goes back.
export default function AddAddressSheet() {
  const { t } = useTranslation();
  const router = useRouter();
  const { kind, id } = useLocalSearchParams<{ kind?: string; id?: string }>();
  const initial: { kind: 'street' | 'settlement'; id: number } | undefined =
    kind === 'street' || kind === 'settlement'
      ? id
        ? { kind, id: Number(id) }
        : undefined
      : undefined;
  return (
    <Screen inset="none" header={<SheetHeader onClose={() => router.back()} />}>
      <AppText variant="headline" accessibilityRole="header">
        {t('address.add')}
      </AppText>
      <AddAddressContainer onSaved={() => router.back()} initial={initial} />
    </Screen>
  );
}
