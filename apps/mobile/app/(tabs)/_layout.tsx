import { Redirect } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';
import { useSettings } from '../../src/store/settings';

export default function TabsLayout() {
  // Nothing but onboarding is shown until it is finished.
  const onboarded = useSettings((s) => s.onboarded);
  if (!onboarded) return <Redirect href="/onboarding" />;
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Početna</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="bolt.fill" md="bolt" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="najave">
        <NativeTabs.Trigger.Label>Najave</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="calendar" md="calendar_month" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="istorija">
        <NativeTabs.Trigger.Label>Istorija</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="clock" md="history" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="podesavanja">
        <NativeTabs.Trigger.Label>Podešavanja</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="gearshape" md="settings" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
