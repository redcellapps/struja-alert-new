import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme';
import { CARD_PADDING, MIN_TOUCH, type StatusKey } from '../tokens';
import { AppText } from './AppText';
import { Button } from './Button';
import { PossibleBadge, StatusBadge } from './StatusBadge';

export interface AddressCardProps {
  // "Kuća", "Posao", or null when the address has no label.
  label?: string | null;
  address: string;
  primary?: boolean;
  primaryLabel?: string;
  status: StatusKey;
  statusLabel: string;
  // The time as a large bold line ("08:30–12:30"); struck through for a cancelled outage.
  time?: string;
  // The secondary line under it ("Sutra · 4 h") or "Nema najavljenih isključenja".
  summary: string;
  // "Moguće": the address may be affected, we cannot be sure (the badge label).
  possible?: string;
  // One action under the summary ("Dodaj broj").
  action?: { label: string; onPress: () => void };
  onPress?: () => void;
  accessibilityLabel: string;
}

/** One saved address with its next outage: label and address, status badge, big time, a quiet line. */
export function AddressCard({
  label,
  address,
  primary,
  primaryLabel,
  status,
  statusLabel,
  time,
  summary,
  possible,
  action,
  onPress,
  accessibilityLabel,
}: AddressCardProps) {
  const { colors, radius } = useTheme();
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
          padding: CARD_PADDING,
          borderRadius: radius.xl,
          backgroundColor: pressed ? c.raised : c.card,
        },
      ]}
    >
      <View style={styles.top}>
        <View style={styles.titles}>
          {label ? (
            <AppText variant="label" color="textSecondary">
              {label}
              {primary && primaryLabel ? ` · ${primaryLabel}` : ''}
            </AppText>
          ) : null}
          <AppText variant="bodyStrong">{address}</AppText>
        </View>
        <View style={styles.badges}>
          <StatusBadge status={status} label={statusLabel} />
          {possible ? <PossibleBadge label={possible} /> : null}
        </View>
      </View>
      <View style={styles.bottom}>
        {time ? (
          <AppText
            variant="value"
            color={status === 'past' ? 'textSecondary' : 'text'}
            style={status === 'past' ? styles.struck : undefined}
          >
            {time}
          </AppText>
        ) : null}
        <AppText variant="body" color="textSecondary">
          {summary}
        </AppText>
      </View>
      {action ? (
        <View style={styles.action}>
          <Button label={action.label} variant="secondary" onPress={action.onPress} />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: 14 },
  top: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  titles: { flex: 1, gap: 2 },
  bottom: { gap: 2 },
  badges: { alignItems: 'flex-end', gap: 6 },
  action: { alignItems: 'flex-start' },
  struck: { textDecorationLine: 'line-through' },
});
