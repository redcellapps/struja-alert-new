import type { ReactNode } from 'react';
import { ScrollView, StatusBar, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { SIDE_MARGIN } from '../tokens';

export interface ScreenProps {
  children: ReactNode;
  // Space above the content: a sheet already clears the status bar, a full screen does not.
  inset?: 'top' | 'none';
}

/** A scrolling screen on the page background: 20 side margins, 28 between sections. */
export function Screen({ children, inset = 'top' }: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.chrome.background }}>
      <StatusBar barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingTop: (inset === 'top' ? insets.top : 0) + 20,
          paddingBottom: insets.bottom + 32,
          paddingHorizontal: SIDE_MARGIN,
          gap: 28,
        }}
      >
        {children}
      </ScrollView>
    </View>
  );
}
