import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, StatusBar, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { SIDE_MARGIN } from '../tokens';

export interface ScreenProps {
  children: ReactNode;
  // Space above the content: a sheet already clears the status bar, a full screen does not.
  inset?: 'top' | 'none';
  // Fixed above the scrolling content (the handle and close button of a sheet): the content scrolls
  // under it, never over it.
  header?: ReactNode;
  // Pull to refresh: both props together.
  onRefresh?: () => void;
  refreshing?: boolean;
}

/**
 * A scrolling screen on the page background: 20 side margins, 28 between sections. On a full screen the
 * strip under the status bar is painted in the page colour and sits over the content, so text that
 * scrolls up stops at the strip instead of running under the clock and the icons.
 */
export function Screen({
  children,
  inset = 'top',
  header,
  onRefresh,
  refreshing = false,
}: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const background = theme.colors.chrome.background;
  const top = inset === 'top' ? insets.top : 0;
  return (
    <View style={{ flex: 1, backgroundColor: background }}>
      <StatusBar barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'} />
      {header ? (
        <View
          testID="screen-header"
          style={{ paddingHorizontal: SIDE_MARGIN, backgroundColor: background }}
        >
          {header}
        </View>
      ) : null}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              progressViewOffset={top}
              colors={[theme.colors.chrome.onAccent]}
              progressBackgroundColor={theme.colors.chrome.accent}
            />
          ) : undefined
        }
        contentContainerStyle={{
          paddingTop: top + (header ? 8 : 20),
          paddingBottom: insets.bottom + 32,
          paddingHorizontal: SIDE_MARGIN,
          gap: 28,
        }}
      >
        {children}
      </ScrollView>
      {top > 0 ? (
        <View
          testID="status-bar-strip"
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: top,
            backgroundColor: background,
          }}
        />
      ) : null}
    </View>
  );
}
