import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AddAddressContainer } from '../src/addresses/AddAddressContainer';
import { COLLAPSE_FONT_SCALE } from '../src/addresses/AddAddressForm';
import { AppText, Screen, SheetHeader } from '../src/design/components';

// A modal sheet (presentation set in the root layout). Closing it, or saving, goes back.
export default function AddAddressSheet() {
  const { t } = useTranslation();
  const router = useRouter();
  // At a large font the title makes way for the street search while the person types.
  const [typing, setTyping] = useState(false);
  const { fontScale } = useWindowDimensions();
  const { kind, id } = useLocalSearchParams<{ kind?: string; id?: string }>();
  const initial: { kind: 'street' | 'settlement'; id: number } | undefined =
    kind === 'street' || kind === 'settlement'
      ? id
        ? { kind, id: Number(id) }
        : undefined
      : undefined;
  return (
    <Screen inset="none" header={<SheetHeader onClose={() => router.back()} />}>
      {typing && fontScale >= COLLAPSE_FONT_SCALE ? null : (
        <AppText variant="headline" accessibilityRole="header">
          {t('address.add')}
        </AppText>
      )}
      <AddAddressContainer
        onSaved={() => router.back()}
        initial={initial}
        onTypingChange={setTyping}
      />
    </Screen>
  );
}
