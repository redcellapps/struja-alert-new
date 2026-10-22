import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme';
import type { StatusKey } from '../tokens';
import { AppText } from './AppText';

export interface TimelineBarProps {
  // Fractional hours of the Belgrade day (0-24). An outage that crosses midnight is drawn to 24.
  startHour: number;
  endHour: number;
  // Where "now" is, when the day shown is today.
  nowHour?: number;
  status: StatusKey;
  accessibilityLabel: string;
}

const TICKS = [0, 6, 12, 18, 24];

/** A 24-hour bar: a 14-high track, the outage window in the status colour, "now" as a dot with a ring. */
export function TimelineBar({
  startHour,
  endHour,
  nowHour,
  status,
  accessibilityLabel,
}: TimelineBarProps) {
  const { colors, radius } = useTheme();
  const c = colors.chrome;
  const left = Math.min(Math.max(startHour, 0), 24) / 24;
  const width = Math.max(Math.min(endHour, 24) - Math.max(startHour, 0), 0.25) / 24;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={{ gap: 8 }}
    >
      <View style={[styles.track, { backgroundColor: c.raised, borderRadius: radius.full }]}>
        <View
          testID="timeline-window"
          style={[
            styles.window,
            {
              left: `${left * 100}%`,
              width: `${width * 100}%`,
              backgroundColor: colors.status[status].mark,
              borderRadius: radius.full,
            },
          ]}
        />
        {nowHour !== undefined ? (
          <View
            testID="timeline-now"
            style={[
              styles.now,
              {
                left: `${(Math.min(Math.max(nowHour, 0), 24) / 24) * 100}%`,
                backgroundColor: c.text,
                borderColor: c.card,
              },
            ]}
          />
        ) : null}
      </View>
      <View
        style={styles.ticks}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {TICKS.map((h) => (
          <AppText key={h} variant="caption" color="textSecondary" tabular>
            {String(h).padStart(2, '0')}
          </AppText>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 14, justifyContent: 'center' },
  window: { position: 'absolute', top: 0, bottom: 0 },
  now: {
    position: 'absolute',
    top: -5,
    width: 24,
    height: 24,
    marginLeft: -12,
    borderRadius: 12,
    borderWidth: 5,
  },
  ticks: { flexDirection: 'row', justifyContent: 'space-between' },
});
