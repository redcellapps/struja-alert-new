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

/** The house ranges of the user's street, with the range containing their number highlighted. */
export function RangeChips({ ranges, note }: RangeChipsProps) {
  const { colors, radius, spacing } = useTheme();
  const c = colors.chrome;
  const hit = colors.status.imminent;
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={[styles.wrap, { gap: spacing.sm }]}>
        {ranges.map((r) => (
          <View
            key={r.label}
            accessible
            accessibilityLabel={r.contains ? `${r.label}, vaš broj` : r.label}
            style={[
              styles.chip,
              {
                borderRadius: radius.full,
                paddingHorizontal: spacing.lg,
                backgroundColor: r.contains ? hit.container : c.surfaceContainer,
                borderColor: r.contains ? hit.accent : c.outline,
                borderWidth: r.contains ? 2 : 1,
              },
            ]}
          >
            <AppText variant="label" color={r.contains ? hit.onContainer : c.onSurface} tabular>
              {r.label}
            </AppText>
          </View>
        ))}
      </View>
      {note ? (
        <AppText variant="body" color="onSurfaceVariant">
          {note}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { minHeight: 36, alignItems: 'center', justifyContent: 'center' },
});
