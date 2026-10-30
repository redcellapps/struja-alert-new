import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { createClient } from './client';
import {
  ensureRegistered,
  getCredentials,
  singleFlightRecovery,
  type DeviceDeps,
  type SecretStore,
} from './device';
import { endpoints } from './endpoints';
import { useAddresses } from '../store/addresses';
import { useSettings } from '../store/settings';
import { nativePushToken, realPushToken } from '../notifications/token';
import { newId } from '../util/uuid';

// 10.0.2.2 is the host machine as seen from the Android emulator. Release builds set
// EXPO_PUBLIC_API_URL to the https address of the server.
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:3000';

export const secureStore: SecretStore = {
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value),
  remove: (key) => SecureStore.deleteItemAsync(key),
};

const deps = (): DeviceDeps => ({
  secrets: secureStore,
  // Late-bound: the device endpoints do not need credentials.
  api: publicApi,
  platform: Platform.OS === 'ios' ? 'ios' : 'android',
  locale: () => {
    const { language, script } = useSettings.getState();
    return { language, script };
  },
  randomId: newId,
  addresses: () => useAddresses.getState().items,
  realPushToken,
  nativePushToken,
});

const publicClient = createClient({
  baseUrl: API_URL,
  fetch: (...args) => fetch(...args),
  getCredentials: () => getCredentials(secureStore),
});
const publicApi = endpoints(publicClient);

// The client the screens use: signed requests, and a lost secret is recovered once per request.
export const client = createClient({
  baseUrl: API_URL,
  fetch: (...args) => fetch(...args),
  getCredentials: async () => (await getCredentials(secureStore)) ?? ensureRegistered(deps()),
  onUnauthorized: singleFlightRecovery(deps()),
});
export const api = endpoints(client);
