/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories must use require */
import { memoryStorage, setStorage } from './src/store/storage';

// MMKV is native; the tests use an in-memory store.
jest.mock('react-native-mmkv', () => ({ createMMKV: () => ({}) }));
setStorage(memoryStorage());

// Reanimated and worklets need native modules; the tests use their own mocks.
jest.mock('react-native-worklets', () => require('react-native-worklets/lib/module/mock'));
jest.mock('react-native-reanimated', () => {
  const RN = require('react-native');
  const layout = { duration: () => layout, delay: () => layout };
  const identity = (x: unknown) => x;
  return {
    __esModule: true,
    default: { View: RN.View, Text: RN.Text, createAnimatedComponent: identity },
    Easing: { linear: identity, quad: identity, out: () => identity },
    useSharedValue: (value: unknown) => ({ value }),
    useAnimatedStyle: (f: () => unknown) => f(),
    useAnimatedProps: (f: () => unknown) => f(),
    withTiming: identity,
    withRepeat: identity,
    withSpring: identity,
    useReducedMotion: () => false,
    FadeIn: layout,
    FadeOut: layout,
  };
});

// expo-notifications is native; the tests record what the app asks of it.
jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 5, HIGH: 6 },
  AndroidNotificationVisibility: { PUBLIC: 1 },
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  setNotificationChannelAsync: jest.fn(async () => null),
  setNotificationCategoryAsync: jest.fn(async () => ({})),
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[test]', type: 'expo' })),
  getDevicePushTokenAsync: jest.fn(async () => ({ data: 'fcm-device-token', type: 'android' })),
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval', DATE: 'date' },
  scheduleNotificationAsync: jest.fn(async () => 'local-1'),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  cancelAllScheduledNotificationsAsync: jest.fn(async () => undefined),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  dismissNotificationAsync: jest.fn(async () => undefined),
  dismissAllNotificationsAsync: jest.fn(async () => undefined),
  registerTaskAsync: jest.fn(async () => null),
  unregisterTaskAsync: jest.fn(async () => null),
  getExactAlarmPermissionsAsync: jest.fn(async () => ({ granted: false, status: 'denied' })),
  requestExactAlarmPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
}));

// expo-background-task is native; the tests record the registration.
jest.mock('expo-background-task', () => ({
  BackgroundTaskResult: { Success: 1, Failed: 2 },
  registerTaskAsync: jest.fn(async () => undefined),
  unregisterTaskAsync: jest.fn(async () => undefined),
}));

// expo-intent-launcher is native; the tests decide which activities exist.
jest.mock('expo-intent-launcher', () => ({
  startActivityAsync: jest.fn(async () => ({ resultCode: 0 })),
}));

// expo-task-manager is native; the tests keep the defined tasks in a map.
jest.mock('expo-task-manager', () => {
  const tasks = new Map<string, unknown>();
  return {
    defineTask: jest.fn((name: string, executor: unknown) => void tasks.set(name, executor)),
    isTaskDefined: jest.fn((name: string) => tasks.has(name)),
    __tasks: tasks,
  };
});

// expo-crypto is native; the tests use Node's.
jest.mock('expo-crypto', () => ({ randomUUID: () => require('node:crypto').randomUUID() }));

// MapLibre is native; the tests stub it (the map tests bring their own, with events).
jest.mock('@maplibre/maplibre-react-native', () => {
  const { View } = require('react-native');
  const Stub = ({ children }: { children?: unknown }) => children ?? null;
  return {
    __esModule: true,
    Map: View,
    Camera: Stub,
    GeoJSONSource: Stub,
    Layer: Stub,
    LogManager: { onLog: () => undefined },
  };
});
