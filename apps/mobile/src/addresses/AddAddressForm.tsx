import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MAX_ADDRESSES, type CreateSubscriptionRequest } from '@struja/shared';
import {
  AppText,
  Button,
  CheckboxRow,
  Chip,
  EmptyState,
  IconTile,
  SectionHeader,
  SkeletonCard,
  TextField,
} from '../design/components';
import { haptics } from '../design/haptics';
import { useTheme } from '../design/theme';
import { CARD_PADDING } from '../design/tokens';
import {
  parseHouseNumber,
  placeMunicipality,
  placeName,
  search,
  type GazetteerIndex,
  type Place,
} from '../gazetteer/search';
import { LimitReachedError } from './save';

// The cities of the city picker. Only Niš has outages and a gazetteer; the others are "Uskoro".
export const CITY_CHOICES = [
  { id: 'nis', name: 'Niš', active: true },
  { id: 'beograd', name: 'Beograd', active: false },
  { id: 'novi-sad', name: 'Novi Sad', active: false },
] as const;

type LabelKey = 'home' | 'work' | 'parents' | 'custom';
const LABELS: readonly LabelKey[] = ['home', 'work', 'parents', 'custom'];

export interface AddAddressFormProps {
  // The offline street index and where loading it stands.
  index: GazetteerIndex | null;
  indexStatus: 'loading' | 'ready' | 'error';
  onRetryIndex?: () => void;
  script: 'latn' | 'cyrl';
  // How many addresses are saved already (at most MAX_ADDRESSES).
  existingCount: number;
  // Saves the address; rejects when it could not be saved.
  save: (request: CreateSubscriptionRequest) => Promise<unknown>;
  onSaved: () => void;
  // A street or settlement to start with ("Prati" in Najave and in the outage detail).
  initial?: { kind: 'street' | 'settlement'; id: number };
}

/**
 * Add an address: city, an instant offline street search, an optional house number (with a suffix such
 * as 34a), an optional label, a confirmation line. No location permission: the person types and picks.
 * Used by the Add address sheet and by the last step of onboarding.
 */
export function AddAddressForm({
  index,
  indexStatus,
  onRetryIndex,
  script,
  existingCount,
  save,
  onSaved,
  initial,
}: AddAddressFormProps) {
  const { t } = useTranslation();
  const { colors, radius } = useTheme();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Place | null>(null);
  const [initialApplied, setInitialApplied] = useState(false);
  // The street came from "Prati": the cursor goes straight to the house number.
  const [prefilled, setPrefilled] = useState(false);
  // Start with the street the person chose elsewhere, as soon as the street list is there.
  useEffect(() => {
    if (!initial || initialApplied || !index) return;
    const place = index.places.find((p) => p.kind === initial.kind && p.id === initial.id);
    if (place) {
      setPicked(place);
      setPrefilled(true);
    }
    setInitialApplied(true);
  }, [initial, initialApplied, index]);
  const [house, setHouse] = useState('');
  const [label, setLabel] = useState<LabelKey | null>(null);
  const [customLabel, setCustomLabel] = useState('');
  const [primary, setPrimary] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<'save' | 'limit' | null>(null);

  const results = useMemo(
    () => (index && !picked ? search(index, query) : []),
    [index, query, picked],
  );
  const parsedHouse = parseHouseNumber(house);
  const houseInvalid = parsedHouse === 'invalid';
  const isStreet = picked?.kind === 'street';

  if (existingCount >= MAX_ADDRESSES) {
    return (
      <EmptyState
        icon={{ ios: 'lock.fill', android: 'lock' }}
        title={t('address.limitTitle')}
        body={t('address.limit', { max: MAX_ADDRESSES })}
      />
    );
  }

  const labelText = (k: LabelKey): string =>
    k === 'custom' ? customLabel.trim() : t(`address.label${k[0]?.toUpperCase()}${k.slice(1)}`);
  const finalLabel = label ? labelText(label) : '';

  const preview = picked
    ? `${placeName(picked, script)}${
        isStreet && typeof parsedHouse === 'object' && parsedHouse.houseNumber
          ? ` ${parsedHouse.houseNumber}${parsedHouse.houseSuffix ?? ''}`
          : ''
      }, ${CITY_CHOICES[0].name}`
    : '';

  const onSave = async () => {
    if (!picked || houseInvalid) return;
    const request: CreateSubscriptionRequest = {
      city: 'nis',
      ...(picked.kind === 'street' ? { streetId: picked.id } : { settlementId: picked.id }),
      ...(isStreet && typeof parsedHouse === 'object' ? parsedHouse : null),
      ...(finalLabel ? { label: finalLabel } : null),
      ...(primary ? { isPrimary: true } : null),
    };
    setSaving(true);
    setFailed(null);
    try {
      await save(request);
      haptics.success();
      onSaved();
    } catch (e) {
      setFailed(e instanceof LimitReachedError ? 'limit' : 'save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.form}>
      <View style={{ gap: 12 }}>
        <SectionHeader title={t('address.city')} />
        <View style={styles.chips}>
          {CITY_CHOICES.map((c) => (
            <Chip
              key={c.id}
              label={c.active ? c.name : `${c.name} · ${t('address.comingSoon')}`}
              selected={c.active}
              disabled={!c.active}
              onPress={c.active ? () => {} : undefined}
              accessibilityLabel={c.active ? c.name : `${c.name}, ${t('address.comingSoon')}`}
            />
          ))}
        </View>
      </View>

      {picked ? (
        <View style={{ gap: 12 }}>
          <SectionHeader title={t('address.street')} />
          <View
            style={[
              styles.picked,
              { backgroundColor: colors.chrome.card, borderRadius: radius.xl },
            ]}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="title">{placeName(picked, script)}</AppText>
              <AppText variant="label" color="textSecondary">
                {picked.kind === 'settlement'
                  ? t('address.settlement')
                  : placeMunicipality(picked, script)}
              </AppText>
            </View>
            <Button
              label={t('address.change')}
              variant="text"
              onPress={() => {
                setPicked(null);
                setPrefilled(false);
              }}
            />
          </View>
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          <TextField
            label={t('address.street')}
            value={query}
            onChangeText={setQuery}
            placeholder={t('address.searchHint')}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {!index && indexStatus === 'loading' ? (
            <SkeletonCard lines={1} accessibilityLabel={t('address.streetsLoading')} />
          ) : null}
          {!index && indexStatus === 'error' ? (
            <EmptyState
              icon={{ ios: 'wifi.slash', android: 'cloud_off' }}
              title={t('address.streetsError')}
              actionLabel={t('state.retry')}
              onAction={onRetryIndex}
            />
          ) : null}
          {results.map((p) => (
            <Pressable
              key={`${p.kind}-${p.id}`}
              accessibilityRole="button"
              accessibilityLabel={`${placeName(p, script)}, ${p.kind === 'settlement' ? t('address.settlement') : (placeMunicipality(p, script) ?? '')}`}
              onPress={() => {
                haptics.selection();
                setPicked(p);
              }}
              style={({ pressed }) => [
                styles.result,
                {
                  backgroundColor: pressed ? colors.chrome.raised : colors.chrome.card,
                  borderRadius: radius.md,
                },
              ]}
            >
              <AppText variant="bodyStrong">{placeName(p, script)}</AppText>
              <AppText variant="label" color="textSecondary">
                {p.kind === 'settlement' ? t('address.settlement') : placeMunicipality(p, script)}
              </AppText>
            </Pressable>
          ))}
          {index && query.trim().length >= 2 && results.length === 0 ? (
            <AppText variant="body" color="textSecondary">
              {t('address.searchEmpty')}
            </AppText>
          ) : null}
        </View>
      )}

      {picked ? (
        <>
          {isStreet ? (
            <TextField
              label={t('address.houseNumber')}
              autoFocus={prefilled}
              hint={t('address.numberHint')}
              value={house}
              onChangeText={setHouse}
              placeholder="34"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={8}
              error={houseInvalid ? t('address.houseInvalid') : undefined}
            />
          ) : null}

          <View style={{ gap: 12 }}>
            <SectionHeader title={t('address.label')} />
            <View style={styles.chips}>
              {LABELS.map((k) => (
                <Chip
                  key={k}
                  label={k === 'custom' ? t('address.labelCustom') : labelText(k)}
                  selected={label === k}
                  onPress={() => setLabel(label === k ? null : k)}
                />
              ))}
            </View>
            {label === 'custom' ? (
              <TextField
                label={t('address.customLabel')}
                value={customLabel}
                onChangeText={setCustomLabel}
                maxLength={40}
              />
            ) : null}
          </View>

          {existingCount > 0 ? (
            <CheckboxRow label={t('address.makePrimary')} checked={primary} onChange={setPrimary} />
          ) : null}

          <View
            accessible
            accessibilityLabel={t('address.preview', { address: preview })}
            style={[
              styles.preview,
              { backgroundColor: colors.chrome.card, borderRadius: radius.xl },
            ]}
          >
            <IconTile icon={{ ios: 'bolt.fill', android: 'bolt' }} color={colors.chrome.link} />
            <View style={{ flex: 1, gap: 4 }}>
              <AppText variant="bodyStrong">{t('address.preview', { address: preview })}</AppText>
              <AppText variant="label" color="textSecondary">
                {t('address.noLocation')}
              </AppText>
            </View>
          </View>

          {failed ? (
            <AppText
              variant="bodyStrong"
              color={colors.chrome.error}
              accessibilityLiveRegion="polite"
            >
              {failed === 'limit'
                ? t('address.limit', { max: MAX_ADDRESSES })
                : t('address.saveError')}
            </AppText>
          ) : null}
          <Button
            label={saving ? t('address.saving') : t('address.save')}
            disabled={saving || houseInvalid || (label === 'custom' && customLabel.trim() === '')}
            onPress={onSave}
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 28 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  picked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: CARD_PADDING,
    paddingVertical: 12,
  },
  result: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    minHeight: 64,
    justifyContent: 'center',
    gap: 2,
  },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: CARD_PADDING },
});
