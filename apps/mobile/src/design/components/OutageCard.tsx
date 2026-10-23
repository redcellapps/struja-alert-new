import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme';
import { CARD_PADDING, MIN_TOUCH, type IconName } from '../tokens';
import { AppText } from './AppText';
import { TagPill } from './StatusBadge';

export interface OutageCardTag {
  label: string;
  icon?: IconName;
}

export interface OutageCardProps {
  // "08:30–12:30"; struck through for a cancelled outage.
  time: string;
  cancelled?: boolean;
  // The municipality, quietly above the time.
  place: string;
  // "Bulevar Nemanjića, Kosmajska, Čegarska" and "i još 2".
  streets: string;
  more?: string;
  tags?: OutageCardTag[];
  onPress?: () => void;
  accessibilityLabel: string;
}

/** One outage in a list: the time big, where, which streets, and a few tags ("Vaša adresa", "Izmenjeno"). */
export function OutageCard({
  time,
  cancelled,
  place,
  streets,
  more,
  tags,
  onPress,
  accessibilityLabel,
}: OutageCardProps) {
  const { colors, radius } = useTheme();
  const c = colors.chrome;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      disabled={!onPress}
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
        <AppText variant="label" color="textSecondary" style={styles.place}>
          {place}
        </AppText>
        {tags && tags.length > 0 ? (
          <View style={styles.tags}>
            {tags.map((tag) => (
              <TagPill key={tag.label} label={tag.label} icon={tag.icon} />
            ))}
          </View>
        ) : null}
      </View>
      <AppText
        variant="value"
        color={cancelled ? 'textSecondary' : 'text'}
        style={cancelled ? styles.struck : undefined}
      >
        {time}
      </AppText>
      <AppText variant="body" color="textSecondary">
        {streets}
        {more ? ` · ${more}` : ''}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: 6 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  place: { flexShrink: 1 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6 },
  struck: { textDecorationLine: 'line-through' },
});
