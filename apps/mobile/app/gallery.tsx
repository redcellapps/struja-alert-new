import { Redirect, useLocalSearchParams } from 'expo-router';
import { ScrollView, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../src/design/components';
import { useTheme } from '../src/design/theme';
import { SIDE_MARGIN, STATUS_KEYS, type StatusKey } from '../src/design/tokens';
import { Cards, Feedback, Heroes } from '../src/gallery/Components';
import { Controls } from '../src/gallery/Controls';
import { HomePreview } from '../src/gallery/HomePreview';
import { Specimen } from '../src/gallery/Specimen';

// Development-only gallery for the design review (adb screenshots, light and dark).
//   strujaalert://gallery?section=specimen   the three candidate fonts side by side
//   strujaalert://gallery?section=home       a composed Početna from mock data
//   strujaalert://gallery?section=controls   radio, checkbox, switch, segmented, buttons, chips
//   strujaalert://gallery?section=components heroes, address cards, banners and states
//   strujaalert://gallery?section=components&status=active   one hero state
const SECTIONS = ['specimen', 'components', 'home', 'controls'] as const;
type Section = (typeof SECTIONS)[number];

export default function Gallery() {
  const { section, status } = useLocalSearchParams<{ section?: string; status?: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  if (!__DEV__) return <Redirect href="/" />;

  const which: Section = (SECTIONS as readonly string[]).includes(section ?? '')
    ? (section as Section)
    : 'components';
  const one = (STATUS_KEYS as readonly string[]).includes(status ?? '')
    ? (status as StatusKey)
    : undefined;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.chrome.background }}
      contentContainerStyle={{
        paddingTop: insets.top + 16,
        paddingBottom: insets.bottom + 32,
        paddingHorizontal: SIDE_MARGIN,
        gap: 28,
      }}
    >
      <StatusBar barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'} />
      <AppText variant="label" color="textSecondary">
        Galerija · {which} · {theme.name} · font {theme.fontKey}
      </AppText>
      {which === 'specimen' && <Specimen />}
      {which === 'components' && (
        <>
          <Heroes only={one} />
          {!one && <Cards />}
          {!one && <Feedback />}
        </>
      )}
      {which === 'home' && <HomePreview />}
      {which === 'controls' && <Controls />}
    </ScrollView>
  );
}
