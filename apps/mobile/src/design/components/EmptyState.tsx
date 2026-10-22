import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme';
import { AppText } from './AppText';
import { Button } from './Button';
import { Icon } from './Icon';

export interface EmptyStateProps {
  icon: { ios: string; android: string };
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}

/** An empty list, a first run, or an error with a retry: calm, centred, one action at most. */
export function EmptyState({ icon, title, body, actionLabel, onAction }: EmptyStateProps) {
  const { colors, spacing } = useTheme();
  return (
    <View style={[styles.box, { padding: spacing.xxxl, gap: spacing.md }]}>
      <View style={[styles.disc, { backgroundColor: colors.chrome.surfaceContainerHigh }]}>
        <Icon name={icon} size={32} color={colors.chrome.onSurfaceVariant} />
      </View>
      <AppText variant="title" style={styles.centre}>
        {title}
      </AppText>
      {body ? (
        <AppText variant="body" color="onSurfaceVariant" style={styles.centre}>
          {body}
        </AppText>
      ) : null}
      {actionLabel ? <Button label={actionLabel} variant="tonal" onPress={onAction} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
  disc: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  centre: { textAlign: 'center' },
});
