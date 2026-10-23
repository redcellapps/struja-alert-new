import { Pressable, StyleSheet, View } from 'react-native';
import { haptics } from '../haptics';
import { useTheme } from '../theme';
import { CARD_GAP, type StatusKey } from '../tokens';
import { AppText } from './AppText';

export interface DayItem {
  // YYYY-MM-DD
  date: string;
  weekday: string;
  dayOfMonth: number;
  hasOutage: boolean;
  // The colour of the dot on a day with an outage (default: upcoming).
  status?: StatusKey;
  // Spoken: "utorak, 4. novembar, ima isključenja".
  accessibilityLabel: string;
}

export interface DayStripProps {
  days: DayItem[];
  selected: string;
  onSelect: (date: string) => void;
}

/** Today and the next three days (EDS publishes four): square tiles, the selected one filled lime. */
export function DayStrip({ days, selected, onSelect }: DayStripProps) {
  const { colors, radius } = useTheme();
  const c = colors.chrome;
  return (
    <View style={[styles.row, { gap: CARD_GAP }]} accessibilityRole="tablist">
      {days.map((d) => {
        const active = d.date === selected;
        const fg = active ? c.onAccent : c.text;
        const dot = active ? c.onAccent : colors.status[d.status ?? 'upcoming'].mark;
        return (
          <Pressable
            key={d.date}
            accessibilityRole="tab"
            accessibilityLabel={d.accessibilityLabel}
            accessibilityState={{ selected: active }}
            onPress={() => {
              haptics.selection();
              onSelect(d.date);
            }}
            style={[
              styles.day,
              { borderRadius: radius.lg, backgroundColor: active ? c.accent : c.card },
            ]}
          >
            <AppText variant="caption" color={active ? c.onAccent : c.textSecondary}>
              {d.weekday}
            </AppText>
            <AppText variant="value" color={fg}>
              {String(d.dayOfMonth)}
            </AppText>
            {/* Keyed by its colour: Android keeps the square background of a view whose colour changed
                from transparent, so a dot that appears or changes colour is made again. */}
            <View
              key={d.hasOutage ? dot : 'none'}
              style={[styles.dot, { backgroundColor: d.hasOutage ? dot : 'transparent' }]}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  day: { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 2 },
});
