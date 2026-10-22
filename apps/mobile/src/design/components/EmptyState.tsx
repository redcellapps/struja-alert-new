import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme';
import { CARD_PADDING, type IconName } from '../tokens';
import { AppText } from './AppText';
import { Button } from './Button';
import { IconTile } from './IconTile';

export interface EmptyStateProps {
  icon: IconName;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}

/** An empty list, a first run, or an error with a retry: a card with an icon tile, a title, one action. */
export function EmptyState({ icon, title, body, actionLabel, onAction }: EmptyStateProps) {
  const { colors, radius } = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.chrome.card, borderRadius: radius.xl, padding: CARD_PADDING },
      ]}
    >
      <IconTile icon={icon} size={56} />
      <View style={{ gap: 6 }}>
        <AppText variant="title">{title}</AppText>
        {body ? (
          <AppText variant="body" color="textSecondary">
            {body}
          </AppText>
        ) : null}
      </View>
      {actionLabel ? (
        <Button label={actionLabel} variant="secondary" fullWidth onPress={onAction} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ card: { gap: 16 } });
