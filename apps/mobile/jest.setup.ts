import { memoryStorage, setStorage } from './src/store/storage';

// MMKV is native; the tests use an in-memory store.
jest.mock('react-native-mmkv', () => ({ createMMKV: () => ({}) }));
setStorage(memoryStorage());
