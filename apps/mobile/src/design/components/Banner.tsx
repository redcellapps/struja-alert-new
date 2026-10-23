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
  // The action on the right ("Uključi"); it wraps under the message at large font sizes.
  actionLabel?: string;
  onAction?: () => void;
}

const ICONS: Record<BannerTone, IconName> = {
  offline: { ios: 'wifi.slash', android: 'cloud_off' },
  warning: { ios: 'bell.slash.fill', android: 'notifications_off' },
};

/** A persistent notice under the header, one row: icon, message, and an optional action. */
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
        {
          backgroundColor: colors.chrome.card,
          borderRadius: radius.xl,
          paddingVertical: 12,
          paddingLeft: CARD_PADDING,
          paddingRight: actionLabel ? 8 : CARD_PADDING,
        },
      ]}
    >
      <IconTile icon={ICONS[tone]} color={mark} />
      <AppText variant="bodyStrong" style={styles.text}>
        {message}
      </AppText>
      {actionLabel ? <Button label={actionLabel} variant="text" onPress={onAction} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Wraps: at a large font the action drops under the message instead of squeezing it.
  card: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 14, rowGap: 4 },
  text: { flex: 1, minWidth: 140 },
});
