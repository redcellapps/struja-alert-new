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
