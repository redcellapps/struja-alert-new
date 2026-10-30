import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { AppText, Button } from '../design/components';
import { useTheme } from '../design/theme';
import { CARD_PADDING } from '../design/tokens';
import type { ExactAlarms } from './exactAlarms';

// The same plain card Podešavanja draws its sections with.
function Card({ children, gap, testID }: { children: ReactNode; gap: number; testID: string }) {
  const { colors, radius } = useTheme();
  return (
    <View
      testID={testID}
      style={{
        backgroundColor: colors.chrome.card,
        borderRadius: radius.xl,
        padding: CARD_PADDING,
        gap,
      }}
    >
      {children}
    </View>
  );
}

export interface VendorCardProps {
  // Shown only on HONOR / Huawei phones (the container decides with `isHonorOrHuawei`).
  onOpenAppLaunch: () => void;
  exactAlarms: ExactAlarms;
  onRequestExactAlarms: () => void;
}

/**
 * The MagicOS / EMUI advice (docs/phase4-plan.md §5, decided 30 Oct): what to change so that
 * "Bez struje" is on the minute with the app closed, with the button to the system's "App launch"
 * list, and the exact-alarm button when that permission is missing. Advice, never a gate.
 */
export function VendorCard(props: VendorCardProps) {
  const { t } = useTranslation();
  return (
    <Card gap={8} testID="vendor-card">
      <AppText variant="label">{t('settings.vendorTitle')}</AppText>
      <AppText variant="body" color="textSecondary">
        {t('settings.vendorBody')}
      </AppText>
      <View style={{ gap: 8 }}>
        <Button
          label={t('settings.vendorOpen')}
          variant="secondary"
          onPress={props.onOpenAppLaunch}
        />
        {props.exactAlarms === 'denied' ? (
          <Button
            label={t('settings.exactAlarmsAllow')}
            variant="secondary"
            onPress={props.onRequestExactAlarms}
          />
        ) : null}
      </View>
    </Card>
  );
}

/** The exact-alarm row of Podešavanja: shown only while the permission is missing. */
export function ExactAlarmsRow(props: { exactAlarms: ExactAlarms; onRequest: () => void }) {
  const { t } = useTranslation();
  if (props.exactAlarms !== 'denied') return null;
  return (
    <Card gap={8} testID="exact-alarms-row">
      <AppText variant="label">{t('settings.exactAlarmsTitle')}</AppText>
      <AppText variant="body" color="textSecondary">
        {t('settings.exactAlarmsDenied')}
      </AppText>
      <Button
        label={t('settings.exactAlarmsAllow')}
        variant="secondary"
        onPress={props.onRequest}
      />
    </Card>
  );
}
