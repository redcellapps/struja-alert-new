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

/** A 24-hour bar with the outage window and a "now" marker. */
export function TimelineBar({
  startHour,
  endHour,
  nowHour,
  status,
  accessibilityLabel,
}: TimelineBarProps) {
  const { colors, radius, spacing } = useTheme();
  const s = colors.status[status];
  const c = colors.chrome;
  const left = Math.min(Math.max(startHour, 0), 24) / 24;
  const width = Math.max(Math.min(endHour, 24) - Math.max(startHour, 0), 0.25) / 24;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={{ gap: spacing.xs }}
    >
      <View
        style={[
          styles.track,
          { backgroundColor: c.surfaceContainerHigh, borderRadius: radius.full },
        ]}
      >
        <View
          testID="timeline-window"
          style={[
            styles.window,
            {
              left: `${left * 100}%`,
              width: `${width * 100}%`,
              backgroundColor: s.accent,
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
                backgroundColor: c.onSurface,
                borderColor: c.surface,
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
          <AppText key={h} variant="caption" color="onSurfaceVariant" tabular>
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
    top: -4,
    width: 4,
    height: 22,
    marginLeft: -2,
    borderRadius: 2,
    borderWidth: 1,
  },
  ticks: { flexDirection: 'row', justifyContent: 'space-between' },
});
