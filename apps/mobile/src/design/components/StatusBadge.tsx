import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme';
import { icons, type StatusKey } from '../tokens';
import { AppText } from './AppText';
import { Icon } from './Icon';

export interface StatusBadgeProps {
  status: StatusKey;
  label: string;
  // On the status-coloured hero the badge is a translucent pill of the text colour; elsewhere it is
  // filled with the status colour.
  onFill?: boolean;
}

/** Small pill: icon and word, so the status is never colour alone. */
export function StatusBadge({ status, label, onFill }: StatusBadgeProps) {
  const { colors, radius } = useTheme();
  const s = colors.status[status];
  return (
    <View
      style={[
        styles.badge,
        { borderRadius: radius.full, backgroundColor: onFill ? s.onFill + '22' : s.fill },
      ]}
    >
      <Icon name={icons[status]} size={16} color={s.onFill} />
      <AppText variant="caption" color={s.onFill}>
        {label}
      </AppText>
    </View>
  );
}

export interface PossibleBadgeProps {
  label: string;
  // The status colour the badge sits next to or on (hero: translucent in its text colour).
  status?: StatusKey;
  onFill?: boolean;
}

/**
 * "Moguće": the address may be affected but we cannot be sure. A second pill beside the status
 * badge, which keeps the status colour; the question mark says what the word says.
 */
export function PossibleBadge({ label, status = 'upcoming', onFill }: PossibleBadgeProps) {
  const { colors, radius } = useTheme();
  const on = onFill ? colors.status[status].onFill : colors.chrome.text;
  return (
    <View
      style={[
        styles.badge,
        {
          borderRadius: radius.full,
          backgroundColor: onFill ? colors.status[status].onFill + '22' : colors.chrome.raised,
        },
      ]}
    >
      <Icon name={{ ios: 'questionmark.circle.fill', android: 'help' }} size={16} color={on} />
      <AppText variant="caption" color={on}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingLeft: 10,
    paddingRight: 12,
    paddingVertical: 6,
  },
});
