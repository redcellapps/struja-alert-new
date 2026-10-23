import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme';
import { AppText } from './AppText';

export interface RangeChip {
  // "26–40", "непарни 1–41", "cela ulica"
  label: string;
  // The user's house number falls in this range.
  contains?: boolean;
}

export interface RangeChipsProps {
  ranges: RangeChip[];
  // A sentence under the chips, e.g. "Vaš broj 34 je u opsegu 26–40".
  note?: string;
}

/** The house ranges of the user's street; the range holding their number is filled lime. */
export function RangeChips({ ranges, note }: RangeChipsProps) {
  const { colors, radius } = useTheme();
  const c = colors.chrome;
  return (
    <View style={{ gap: 12 }}>
      <View style={styles.wrap}>
        {ranges.map((r) => (
          <View
            key={r.label}
            accessible
            accessibilityLabel={r.contains ? `${r.label}, vaš broj` : r.label}
            style={[
              styles.chip,
              { borderRadius: radius.md, backgroundColor: r.contains ? c.accent : c.raised },
            ]}
          >
            <AppText variant="label" color={r.contains ? c.onAccent : c.text}>
              {r.label}
            </AppText>
          </View>
        ))}
      </View>
      {note ? (
        <AppText variant="body" color="textSecondary">
          {note}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 40, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
});
