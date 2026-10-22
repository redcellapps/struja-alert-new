import { createMMKV } from 'react-native-mmkv';

// The one key-value store of the app (MMKV). Tests swap it with setStorage().
export interface KeyValueStorage {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
}

let current: KeyValueStorage | null = null;

export function storage(): KeyValueStorage {
  if (!current) {
    const mmkv = createMMKV({ id: 'struja-alert' });
    current = {
      getString: (key) => mmkv.getString(key),
      set: (key, value) => mmkv.set(key, value),
      remove: (key) => {
        mmkv.remove(key);
      },
    };
  }
  return current;
}

export function setStorage(kv: KeyValueStorage): void {
  current = kv;
}

export function memoryStorage(): KeyValueStorage {
  const data = new Map<string, string>();
  return {
    getString: (key) => data.get(key),
    set: (key, value) => void data.set(key, value),
    remove: (key) => void data.delete(key),
  };
}

// zustand's persist middleware wants this shape.
export const zustandStorage = {
  getItem: (name: string) => storage().getString(name) ?? null,
  setItem: (name: string, value: string) => storage().set(name, value),
  removeItem: (name: string) => storage().remove(name),
};
