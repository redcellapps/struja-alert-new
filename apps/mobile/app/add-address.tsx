import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AddAddressContainer } from '../src/addresses/AddAddressContainer';
import { AppText, Screen } from '../src/design/components';

// A modal sheet (presentation set in the root layout). Closing it, or saving, goes back.
export default function AddAddressSheet() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Screen inset="none">
      <AppText variant="headline" accessibilityRole="header">
        {t('address.add')}
      </AppText>
      <AddAddressContainer onSaved={() => router.back()} />
    </Screen>
  );
}
