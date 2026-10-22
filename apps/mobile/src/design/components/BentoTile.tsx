import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme';
import { CARD_PADDING, type IconName } from '../tokens';
import { AppText } from './AppText';
import { Icon } from './Icon';

export interface BentoTileProps {
  icon: IconName;
  // "Sledeće", "Trajanje".
  label: string;
  // The one big number or short headline ("08:30", "4 h").
  value: string;
  // A quiet line under it ("Sutra", "do 12:30").
  caption?: string;
  accessibilityLabel: string;
}

/** A half-width bento card: small icon and label, one big value, one quiet line. */
export function BentoTile({ icon, label, value, caption, accessibilityLabel }: BentoTileProps) {
  const { colors, radius } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.tile,
        { backgroundColor: colors.chrome.card, borderRadius: radius.xl, padding: CARD_PADDING },
      ]}
    >
      <View style={styles.head}>
        <Icon name={icon} size={20} color={colors.chrome.textSecondary} />
        <AppText variant="label" color="textSecondary">
          {label}
        </AppText>
      </View>
      <View>
        <AppText variant="tile" numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </AppText>
        {caption ? (
          <AppText variant="label" color="textSecondary">
            {caption}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, minHeight: 148, justifyContent: 'space-between', gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
