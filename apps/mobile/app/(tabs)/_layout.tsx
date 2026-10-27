import { Redirect } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';
import { useTranslation } from 'react-i18next';
import { useFontScale } from '../../src/design/largeText';
import { useTheme } from '../../src/design/theme';
import { useSettings } from '../../src/store/settings';

const TAB_LABEL_MAX_SCALE = 1.1;

export default function TabsLayout() {
  const { t } = useTranslation();
  const { colors, fonts } = useTheme();
  const c = colors.chrome;
  const fontScale = useFontScale();
  // Nothing but onboarding is shown until it is finished.
  const onboarded = useSettings((s) => s.onboarded);
  if (!onboarded) return <Redirect href="/onboarding" />;
  // The bar labels grow with the system font only up to 110 % (Material caps bottom navigation labels too), or
  // four words no longer fit side by side; the rest of the app scales in full.
  const fontSize = (12 * Math.min(fontScale, TAB_LABEL_MAX_SCALE)) / fontScale;
  // The bar follows the design system: the card colour, a lime indicator with a dark icon, and the
  // label of every tab always visible. No Material You tint.
  return (
    <NativeTabs
      backgroundColor={c.card}
      indicatorColor={c.accent}
      rippleColor={c.raised}
      iconColor={{ default: c.textSecondary, selected: c.onAccent }}
      labelVisibilityMode="labeled"
      labelStyle={{
        default: { color: c.textSecondary, fontFamily: fonts.text['500'], fontSize },
        selected: { color: c.text, fontFamily: fonts.text['700'], fontSize },
      }}
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>{t('tabs.home')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="bolt.fill" md="bolt" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="najave">
        <NativeTabs.Trigger.Label>{t('tabs.upcoming')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="calendar" md="calendar_month" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="istorija">
        <NativeTabs.Trigger.Label>{t('tabs.history')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="clock" md="history" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="podesavanja">
        <NativeTabs.Trigger.Label>{t('tabs.settings')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="gearshape" md="settings" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
