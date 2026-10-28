import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Keyboard,
  RefreshControl,
  ScrollView,
  StatusBar,
  View,
  type HostInstance,
  type ScrollViewInstance,
} from 'react-native';
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

interface ScreenScroll {
  // Scrolls the view to the top of the visible area, above the keyboard once it is up.
  reveal: (target: HostInstance | null) => void;
}
const ScreenScrollContext = createContext<ScreenScroll>({ reveal: () => {} });

/** For a field that must stay in view above the keyboard: call `reveal(ref.current)` when it gets focus. */
export function useScreenReveal(): ScreenScroll['reveal'] {
  return useContext(ScreenScrollContext).reveal;
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

  // The window is not resized by the keyboard (edge to edge): the content gets the keyboard's height as
  // extra room at the end, so that a field near the bottom can be scrolled above the keyboard.
  const scrollRef = useRef<ScrollViewInstance>(null);
  const [keyboard, setKeyboard] = useState(0);
  const keyboardUp = useRef(false);
  const pending = useRef<HostInstance | null>(null);
  const scrollToTarget = useCallback(
    (target: HostInstance) => {
      const inner = scrollRef.current?.getInnerViewRef();
      if (!inner) return;
      target.measureLayout(
        inner as never,
        (_x, y) => scrollRef.current?.scrollTo({ y: Math.max(0, y - top - 12), animated: true }),
        () => {},
      );
    },
    [top],
  );
  const runPending = useCallback(() => {
    if (pending.current) scrollToTarget(pending.current);
    pending.current = null;
  }, [scrollToTarget]);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      keyboardUp.current = true;
      setKeyboard(e.endCoordinates.height);
      // The screen is resized a moment later (onLayout of the scroll view): the scroll waits for it, and
      // this timer is the fallback.
      setTimeout(runPending, 250);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      keyboardUp.current = false;
      pending.current = null;
      setKeyboard(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [runPending]);
  const scroll = useMemo<ScreenScroll>(
    () => ({
      reveal: (target) => {
        if (!target) return;
        if (keyboardUp.current) scrollToTarget(target);
        else pending.current = target;
      },
    }),
    [scrollToTarget],
  );

  return (
    <View
      testID="screen-root"
      style={{ flex: 1, backgroundColor: background, paddingBottom: keyboard }}
    >
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
        ref={scrollRef}
        testID="screen-scroll"
        onLayout={() => {
          if (keyboardUp.current) runPending();
        }}
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
        <ScreenScrollContext.Provider value={scroll}>{children}</ScreenScrollContext.Provider>
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
