import { Redirect } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/design/theme';
import { useSettings } from '../../src/store/settings';

export default function TabsLayout() {
  const { t } = useTranslation();
  const { colors, fonts } = useTheme();
  const c = colors.chrome;
  // Nothing but onboarding is shown until it is finished.
  const onboarded = useSettings((s) => s.onboarded);
  if (!onboarded) return <Redirect href="/onboarding" />;
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
        default: { color: c.textSecondary, fontFamily: fonts.text['500'], fontSize: 12 },
        selected: { color: c.text, fontFamily: fonts.text['700'], fontSize: 12 },
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
