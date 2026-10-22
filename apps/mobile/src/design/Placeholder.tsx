import { StyleSheet, Text, useColorScheme, View } from 'react-native';

export function Placeholder({ title }: { title: string }) {
  const dark = useColorScheme() === 'dark';
  return (
    <View style={[styles.root, { backgroundColor: dark ? '#000' : '#fff' }]}>
      <Text style={[styles.title, { color: dark ? '#fff' : '#000' }]}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '600' },
});
