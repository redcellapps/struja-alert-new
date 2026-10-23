import { useRouter } from 'expo-router';
import { Linking } from 'react-native';
import { MAX_ADDRESSES } from '@struja/shared';
import { useNow } from '../../src/design/useNow';
import { HomeView } from '../../src/home/HomeView';
import { useHomeData } from '../../src/home/useHomeData';
import { useAddresses } from '../../src/store/addresses';
import { useSettings } from '../../src/store/settings';

export default function HomeScreen() {
  const router = useRouter();
  const now = useNow(1000);
  const data = useHomeData();
  const count = useAddresses((s) => s.items.length);
  const permission = useSettings((s) => s.notificationPermission);
  return (
    <HomeView
      {...data}
      now={now}
      notificationsOff={permission === 'denied'}
      canAdd={count < MAX_ADDRESSES}
      onAdd={() => router.push('/add-address')}
      onOpenSystemSettings={() => void Linking.openSettings()}
      onOpenAbout={() => router.navigate('/podesavanja')}
    />
  );
}
