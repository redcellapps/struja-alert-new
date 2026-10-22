import { StyleSheet, View } from 'react-native';
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
  return (
    <View style={styles.row}>
      <AppText variant="title" accessibilityRole="header">
        {title}
      </AppText>
      {actionLabel ? (
        <Button label={actionLabel} variant="text" onPress={onAction} />
      ) : trailing ? (
        <AppText variant="label" color="textSecondary">
          {trailing}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 32,
  },
});
