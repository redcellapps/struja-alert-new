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
    useReducedMotion: () => false,
    FadeIn: layout,
    FadeOut: layout,
  };
});
