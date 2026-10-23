import { focusManager } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ThemeProvider, useTheme } from '../src/design/theme';
import { initI18n, setLocale } from '../src/i18n';
import { createQueryClient, CACHE_MAX_AGE_MS, mmkvPersister } from '../src/query/client';
import { useSettings } from '../src/store/settings';

const queryClient = createQueryClient();

// Coming back to the app refetches stale data (React Native has no window focus event).
focusManager.setEventListener((handleFocus) => {
  const sub = AppState.addEventListener('change', (state) => handleFocus(state === 'active'));
  return () => sub.remove();
});

// Inside the theme provider, so every screen (and the sheet) gets the page background at once.
function RootStack() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.chrome.background },
      }}
    >
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="add-address"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: [0.95],
          sheetGrabberVisible: true,
        }}
      />
      <Stack.Screen name="gallery" />
    </Stack>
  );
}

export default function RootLayout() {
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
