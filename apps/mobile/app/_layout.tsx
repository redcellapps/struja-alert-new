import { focusManager } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ThemeProvider, useTheme } from '../src/design/theme';
import { i18next, initI18n, setLocale } from '../src/i18n';
import { useOutageAlarms } from '../src/notifications/useOutageAlarms';
import { registerBackgroundTask } from '../src/notifications/background';
import { registerRefreshTask } from '../src/notifications/refresh';
import { installForegroundHandler, setupNotifications } from '../src/notifications/channels';
import { useNotificationResponses } from '../src/notifications/respond';
import { CACHE_MAX_AGE_MS, mmkvPersister } from '../src/query/client';
import { queryClient } from '../src/query/instance';
import { useDeviceSync } from '../src/settings/sync';
import { useSettings } from '../src/store/settings';

// Coming back to the app refetches stale data (React Native has no window focus event).
focusManager.setEventListener((handleFocus) => {
  const sub = AppState.addEventListener('change', (state) => handleFocus(state === 'active'));
  return () => sub.remove();
});

// A notification that arrives while the app is open is shown (the server decided it is due).
installForegroundHandler();

// Inside the theme provider, so every screen (and the sheet) gets the page background at once.
function RootStack() {
  const { colors } = useTheme();
  // A tap on a notification, or on "Detalji" / "Dodaj u kalendar", opens the outage detail.
  useNotificationResponses(useRouter());
  // The local "Bez struje" alarms follow the saved addresses' outages; a push refetches them.
  useOutageAlarms();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.chrome.background },
      }}
    >
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="(tabs)" />
      {/* [MAC] The sheets below take one detent each (a fixed height, which is also how Android shows them). */}
      {/* On iOS the detents are the native sheet: grabber, two detents (medium and large) and the Liquid Glass */}
      {/* sheet background on iOS 26 are decided with the iOS smoke build (docs/ios-mac.md). */}
      <Stack.Screen
        name="add-address"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: [0.9],
          sheetCornerRadius: 28,
        }}
      />
      <Stack.Screen
        name="edit-address"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: [0.6],
          sheetCornerRadius: 28,
        }}
      />
      <Stack.Screen
        name="outage/[id]"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: [0.86],
          sheetCornerRadius: 28,
        }}
      />
      <Stack.Screen name="gallery" />
    </Stack>
  );
}

export default function RootLayout() {
  // The server keeps the language and the notification choices in step with the settings.
  useDeviceSync();
  const language = useSettings((s) => s.language);
  const script = useSettings((s) => s.script);
  const [ready, setReady] = useState(false);

  // i18n starts with the saved language and follows later changes of language or script.
  useEffect(() => {
    let cancelled = false;
    (ready ? setLocale(language, script) : initI18n(language, script)).then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [language, script, ready]);

  // The Android channels and the action buttons, named in the current language and script; then
  // the push task (it needs the channels: what it shows goes to "hitno").
  useEffect(() => {
    if (!ready) return;
    void setupNotifications(i18next.t.bind(i18next))
      .catch(() => {})
      .then(registerBackgroundTask)
      .then(registerRefreshTask);
  }, [ready, language, script]);

  if (!ready) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{ persister: mmkvPersister, maxAge: CACHE_MAX_AGE_MS }}
      >
        <ThemeProvider>
          <RootStack />
        </ThemeProvider>
      </PersistQueryClientProvider>
    </GestureHandlerRootView>
  );
}
