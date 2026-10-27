import { View } from 'react-native';
import { useStackTiles } from '../largeText';
import { CARD_GAP } from '../tokens';

/** Bento tiles side by side; one per row on a narrow screen or with a large font (see `useStackTiles`). */
export function BentoRow({ children }: { children: React.ReactNode }) {
  const stacked = useStackTiles();
  return (
    <View testID="bento-row" style={{ flexDirection: stacked ? 'column' : 'row', gap: CARD_GAP }}>
      {children}
    </View>
  );
}
