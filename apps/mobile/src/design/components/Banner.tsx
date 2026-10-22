import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme';
import { AppText } from './AppText';
import { Button } from './Button';
import { Icon } from './Icon';

export type BannerTone = 'offline' | 'warning';

export interface BannerProps {
  tone: BannerTone;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

const ICONS: Record<BannerTone, { ios: string; android: string }> = {
  offline: { ios: 'wifi.slash', android: 'cloud_off' },
  warning: { ios: 'bell.slash.fill', android: 'notifications_off' },
};

/** A persistent notice under the header: offline (showing saved data) or notifications turned off. */
export function Banner({ tone, message, actionLabel, onAction }: BannerProps) {
  const { colors, radius, spacing } = useTheme();
  const s = tone === 'offline' ? colors.status.past : colors.status.upcoming;
  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLabel={message}
      style={[
        styles.row,
        {
          backgroundColor: s.container,
          borderRadius: radius.md,
          padding: spacing.md,
          gap: spacing.md,
        },
      ]}
    >
      <Icon name={ICONS[tone]} size={22} color={s.accent} />
      <AppText variant="label" color={s.onContainer} style={styles.text}>
        {message}
      </AppText>
      {actionLabel ? <Button label={actionLabel} variant="text" onPress={onAction} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  text: { flex: 1 },
});
