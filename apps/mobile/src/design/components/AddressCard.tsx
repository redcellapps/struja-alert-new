import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme';
import { icons, MIN_TOUCH, type StatusKey } from '../tokens';
import { AppText } from './AppText';
import { Icon } from './Icon';

export interface AddressCardProps {
  // "Kuća", "Posao", or null when the address has no label.
  label?: string | null;
  address: string;
  primary?: boolean;
  primaryLabel?: string;
  status: StatusKey;
  statusLabel: string;
  // "Utorak 08:30–12:30" or "Nema najavljenih isključenja".
  summary: string;
  onPress?: () => void;
  accessibilityLabel: string;
}

/** One saved address with its next outage. The status shows as an icon, a word and a colour. */
export function AddressCard({
  label,
  address,
  primary,
  primaryLabel,
  status,
  statusLabel,
  summary,
  onPress,
  accessibilityLabel,
}: AddressCardProps) {
  const { colors, radius, spacing } = useTheme();
  const s = colors.status[status];
  const c = colors.chrome;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          minHeight: MIN_TOUCH * 2,
          padding: spacing.lg,
          gap: spacing.sm,
          borderRadius: radius.lg,
          backgroundColor: c.surfaceContainer,
          opacity: pressed ? 0.9 : 1,
        },
      ]}
    >
      <View style={styles.top}>
        <View style={styles.titles}>
          {label ? (
            <AppText variant="label" color="onSurfaceVariant">
              {label}
              {primary && primaryLabel ? ` · ${primaryLabel}` : ''}
            </AppText>
          ) : null}
          <AppText variant="bodyStrong">{address}</AppText>
        </View>
        <View style={[styles.badge, { backgroundColor: s.container, borderRadius: radius.full }]}>
          <Icon name={icons[status]} size={16} color={s.accent} />
          <AppText variant="caption" color={s.onContainer}>
            {statusLabel}
          </AppText>
        </View>
      </View>
      <AppText variant="body" color="onSurfaceVariant">
        {summary}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { justifyContent: 'center' },
  top: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  titles: { flex: 1, gap: 2 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
});
