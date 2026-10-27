import { StyleSheet, View } from 'react-native';
import { useStackHeader } from '../largeText';
import { AppText } from './AppText';
import { Button } from './Button';

export interface SectionHeaderProps {
  title: string;
  // A quiet count or note on the right ("3 isključenja").
  trailing?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function SectionHeader({ title, trailing, actionLabel, onAction }: SectionHeaderProps) {
  // when the title and the action do not fit on one line the action goes under the title, full width
  const stackHeader = useStackHeader();
  const stacked = stackHeader && !!actionLabel;
  return (
    <View testID="section-header" style={[styles.row, stacked && styles.stacked]}>
      <AppText variant="title" accessibilityRole="header" style={styles.title}>
        {title}
      </AppText>
      {actionLabel ? (
        <Button label={actionLabel} variant="text" fullWidth={stacked} onPress={onAction} />
      ) : trailing ? (
        <AppText variant="label" color="textSecondary">
          {trailing}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { flexShrink: 1 },
  stacked: { flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-start' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 32,
  },
});
