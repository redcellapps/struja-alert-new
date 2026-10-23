import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppText, Button, TextField } from '../design/components';
import { haptics } from '../design/haptics';
import { useTheme } from '../design/theme';
import { parseHouseNumber } from '../gazetteer/search';

export interface HouseNumberFormProps {
  // The address the number is for ("Vojvode Mišića").
  name: string;
  // Rejects when the number could not be saved.
  save: (number: { houseNumber: number; houseSuffix?: string }) => Promise<unknown>;
  onSaved: () => void;
}

/** "Dodaj broj": one field for the house number (with a suffix such as 34a) and one button. */
export function HouseNumberForm({ name, save, onSaved }: HouseNumberFormProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const parsed = parseHouseNumber(text);
  const invalid = parsed === 'invalid';
  const ready = !invalid && parsed.houseNumber !== undefined;

  const onSave = async () => {
    if (parsed === 'invalid' || parsed.houseNumber === undefined) return;
    setSaving(true);
    setFailed(false);
    try {
      await save({ houseNumber: parsed.houseNumber, houseSuffix: parsed.houseSuffix });
      haptics.success();
      onSaved();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 6 }}>
        <AppText variant="headline" accessibilityRole="header">
          {t('address.houseNumberTitle')}
        </AppText>
        <AppText variant="bodyStrong">{name}</AppText>
        <AppText variant="body" color="textSecondary">
          {t('address.addNumberWhy')}
        </AppText>
      </View>
      <TextField
        label={t('address.houseNumber')}
        value={text}
        onChangeText={setText}
        placeholder="34"
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={8}
        autoFocus
        error={invalid ? t('address.houseInvalid') : undefined}
      />
      {failed ? (
        <AppText variant="bodyStrong" color={colors.chrome.error} accessibilityLiveRegion="polite">
          {t('address.numberSaveError')}
        </AppText>
      ) : null}
      <Button
        label={saving ? t('address.saving') : t('address.saveNumber')}
        disabled={!ready || saving}
        onPress={onSave}
      />
    </View>
  );
}
