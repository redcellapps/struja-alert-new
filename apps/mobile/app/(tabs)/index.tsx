import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { AppState, Linking } from 'react-native';
import { MAX_ADDRESSES } from '@struja/shared';
import { useMinuteNow } from '../../src/design/useNow';
import { HomeView } from '../../src/home/HomeView';
import { useHomeData } from '../../src/home/useHomeData';
import { useExactAlarms } from '../../src/notifications/useExactAlarms';
import { isHonorOrHuawei, openAppLaunchSettings } from '../../src/notifications/vendor';
import { checkNotificationPermission } from '../../src/notifications/permission';
import { useAddresses } from '../../src/store/addresses';
import { useSettings } from '../../src/store/settings';

export default function HomeScreen() {
  const router = useRouter();
  const now = useMinuteNow();
  const data = useHomeData();
  const count = useAddresses((s) => s.items.length);
  const permission = useSettings((s) => s.notificationPermission);
  const set = useSettings((s) => s.set);

  const { exactAlarms, request: requestExactAlarms } = useExactAlarms();

  // The permission can change outside the app: read it again on opening and on coming back.
  useEffect(() => {
    const read = () =>
      void checkNotificationPermission().then((p) => {
        if (p !== 'undetermined') set({ notificationPermission: p });
      });
    read();
    const sub = AppState.addEventListener('change', (state) => state === 'active' && read());
    return () => sub.remove();
  }, [set]);
  return (
    <HomeView
      {...data}
      now={now}
      notificationsOff={permission === 'denied'}
      vendorCard={
        isHonorOrHuawei()
          ? {
              onOpenAppLaunch: () => void openAppLaunchSettings(),
              exactAlarms,
              onRequestExactAlarms: requestExactAlarms,
            }
          : null
      }
      canAdd={count < MAX_ADDRESSES}
      onAdd={() => router.push('/add-address')}
      onAddNumber={(id) => router.push({ pathname: '/edit-address', params: { id: String(id) } })}
      onOpenOutage={(id, addressId) =>
        router.push({
          pathname: '/outage/[id]',
          params: { id: String(id), addressId: String(addressId) },
        })
      }
      onOpenSystemSettings={() => void Linking.openSettings()}
      onOpenAbout={() => router.navigate('/podesavanja')}
    />
  );
}
