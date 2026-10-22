import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme';
import { CARD_PADDING, type IconName } from '../tokens';
import { AppText } from './AppText';
import { Button } from './Button';
import { IconTile } from './IconTile';

export type BannerTone = 'offline' | 'warning';

export interface BannerProps {
  tone: BannerTone;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

const ICONS: Record<BannerTone, IconName> = {
  offline: { ios: 'wifi.slash', android: 'cloud_off' },
  warning: { ios: 'bell.slash.fill', android: 'notifications_off' },
};

/** A persistent notice under the header: offline (showing saved data) or notifications turned off. */
export function Banner({ tone, message, actionLabel, onAction }: BannerProps) {
  const { colors, radius } = useTheme();
  const mark = (tone === 'offline' ? colors.status.past : colors.status.upcoming).mark;
  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLabel={message}
      style={[
        styles.card,
        { backgroundColor: colors.chrome.card, borderRadius: radius.xl, padding: CARD_PADDING },
      ]}
    >
      <View style={styles.row}>
        <IconTile icon={ICONS[tone]} color={mark} />
        <AppText variant="bodyStrong" style={styles.text}>
          {message}
        </AppText>
      </View>
      {actionLabel ? (
        <View style={styles.action}>
          <Button label={actionLabel} variant="text" onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  text: { flex: 1 },
  action: { alignItems: 'flex-start', marginLeft: -12 },
});
