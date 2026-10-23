import { View } from 'react-native';
import { AppText, Chip } from '../design/components';
import { buildTheme, ThemeProvider, useTheme } from '../design/theme';
import { fontSets, type FontSetKey } from '../design/tokens';

// The type specimen: the three candidate fonts side by side, each on the same content.
const SR_LATIN = 'Isključenje struje: Vojvode Mišića 34, sutra 08:30–12:30';
const SR_CYRILLIC = 'Искључење струје: Војводе Мишића 34, сутра 08:30–12:30';
const LETTERS_LATIN = 'č ć š ž đ  Č Ć Š Ž Đ';
const LETTERS_CYRILLIC = 'ђ ћ љ њ џ ј  Ђ Ћ Љ Њ Џ Ј';

const DESCRIPTION: Record<FontSetKey, string> = {
  A: 'Onest za sve',
  B: 'Manrope za sve',
  C: 'Unbounded za naslove i brojeve, Onest za tekst',
};

function Candidate({ fontKey }: { fontKey: FontSetKey }) {
  const outer = useTheme();
  const theme = buildTheme(outer.name, outer.contrast, fontKey);
  const c = theme.colors.chrome;
  return (
    <ThemeProvider override={theme}>
      <View style={{ backgroundColor: c.card, borderRadius: 24, padding: 20, gap: 16 }}>
        <View style={{ gap: 2 }}>
          <AppText variant="label" color="textSecondary">
            {fontKey} · {fontSets[fontKey].name}
          </AppText>
          <AppText variant="caption" color="textSecondary">
            {DESCRIPTION[fontKey]}
          </AppText>
        </View>
        <AppText variant="headline">Uskoro bez struje</AppText>
        <AppText variant="display">1 h 12 min</AppText>
        <AppText variant="body" color="textSecondary">
          Elektrodistribucija je najavila isključenje struje za vašu adresu. Javićemo vam čim se
          nešto promeni.
        </AppText>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Chip label="Kuća" selected />
          <Chip label="Posao" onPress={() => {}} />
          <Chip label="Roditelji" onPress={() => {}} />
        </View>
        <View style={{ gap: 8 }}>
          <AppText variant="bodyStrong">{SR_LATIN}</AppText>
          <AppText variant="bodyStrong">{SR_CYRILLIC}</AppText>
        </View>
        <View style={{ gap: 4 }}>
          <AppText variant="title">{LETTERS_LATIN}</AppText>
          <AppText variant="title">{LETTERS_CYRILLIC}</AppText>
          <AppText variant="value">0123456789 · 11:11 · 88:88</AppText>
        </View>
      </View>
    </ThemeProvider>
  );
}

export function Specimen() {
  return (
    <>
      {(['A', 'B', 'C'] as const).map((k) => (
        <Candidate key={k} fontKey={k} />
      ))}
    </>
  );
}
