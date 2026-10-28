import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking } from 'react-native';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AddAddressContainer } from '../src/addresses/AddAddressContainer';
import { COLLAPSE_FONT_SCALE } from '../src/addresses/AddAddressForm';
import { AppText, Banner, BoltWatermark, Button, IconTile, Screen } from '../src/design/components';
import { useTheme } from '../src/design/theme';
import { CARD_PADDING } from '../src/design/tokens';
import { requestNotificationPermission } from '../src/notifications/permission';
import { useSettings } from '../src/store/settings';

const STEPS = 3;

function Progress({ step }: { step: number }) {
  const { colors } = useTheme();
  return (
    <View
      style={styles.progress}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {Array.from({ length: STEPS }, (_, i) => (
        <View
          key={i}
          style={[
            styles.bar,
            { backgroundColor: i <= step ? colors.chrome.accent : colors.chrome.raised },
          ]}
        />
      ))}
    </View>
  );
}

/** Three steps: what the app does, the notification permission, the first address. */
export default function Onboarding() {
  const { t } = useTranslation();
  const { colors, radius } = useTheme();
  const [step, setStep] = useState(0);
  // At a large font the title makes way for the street search while the person types.
  const [typing, setTyping] = useState(false);
  const { fontScale } = useWindowDimensions();
  const collapseTitle = typing && fontScale >= COLLAPSE_FONT_SCALE;
  const permission = useSettings((s) => s.notificationPermission);
  const set = useSettings((s) => s.set);
  const router = useRouter();
  const finish = () => {
    set({ onboarded: true });
    router.replace('/');
  };

  const allow = async () => {
    set({ notificationPermission: await requestNotificationPermission() });
    setStep(2);
  };

  return (
    <Screen>
      <View style={{ gap: 12 }}>
        <Progress step={step} />
        <AppText variant="label" color="textSecondary">
          {t('onboarding.step', { current: step + 1, total: STEPS })}
        </AppText>
      </View>

      {step === 0 ? (
        <>
          <View
            style={[
              styles.hero,
              { backgroundColor: colors.chrome.accent, borderRadius: radius.xl },
            ]}
          >
            <View style={styles.watermark} pointerEvents="none">
              <BoltWatermark color={colors.chrome.onAccent} size={240} />
            </View>
            <AppText variant="headline" color={colors.chrome.onAccent} accessibilityRole="header">
              {t('onboarding.valueTitle')}
            </AppText>
          </View>
          <AppText variant="body" color="textSecondary">
            {t('onboarding.valueBody')}
          </AppText>
          <Button label={t('onboarding.next')} onPress={() => setStep(1)} />
        </>
      ) : null}

      {step === 1 ? (
        <>
          <IconTile icon={{ ios: 'bell.fill', android: 'notifications' }} size={64} />
          <View style={{ gap: 8 }}>
            <AppText variant="headline" accessibilityRole="header">
              {t('onboarding.permissionTitle')}
            </AppText>
            <AppText variant="body" color="textSecondary">
              {t('onboarding.permissionBody')}
            </AppText>
          </View>
          <View style={{ gap: 8 }}>
            <Button label={t('onboarding.allow')} onPress={allow} />
            <Button
              label={t('onboarding.later')}
              variant="text"
              fullWidth
              onPress={() => setStep(2)}
            />
          </View>
        </>
      ) : null}

      {step === 2 ? (
        <>
          {collapseTitle ? null : (
            <View style={{ gap: 8 }}>
              <AppText variant="headline" accessibilityRole="header">
                {t('onboarding.addressTitle')}
              </AppText>
              <AppText variant="body" color="textSecondary">
                {t('onboarding.addressBody')}
              </AppText>
            </View>
          )}
          <AddAddressContainer onSaved={finish} onTypingChange={setTyping} />
          <Button label={t('onboarding.later')} variant="text" fullWidth onPress={finish} />
          {permission === 'denied' ? (
            <Banner
              tone="warning"
              message={t('banner.notificationsOff')}
              actionLabel={t('banner.turnOn')}
              onAction={() => void Linking.openSettings()}
            />
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  progress: { flexDirection: 'row', gap: 8 },
  bar: { flex: 1, height: 6, borderRadius: 3 },
  hero: { overflow: 'hidden', padding: CARD_PADDING, minHeight: 280, justifyContent: 'flex-end' },
  watermark: { position: 'absolute', right: -40, top: -30 },
});
