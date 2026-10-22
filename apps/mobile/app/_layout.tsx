import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ThemeProvider } from '../src/design/theme';
import { initI18n, setLocale } from '../src/i18n';
import { createQueryClient, CACHE_MAX_AGE_MS, mmkvPersister } from '../src/query/client';
import { useSettings } from '../src/store/settings';

const queryClient = createQueryClient();

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
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
          </Stack>
        </ThemeProvider>
      </PersistQueryClientProvider>
    </GestureHandlerRootView>
  );
}
