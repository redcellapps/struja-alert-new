import { QueryClient } from '@tanstack/react-query';
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';
import { storage } from '../store/storage';

// Offline-first: data stays "fresh enough" for a few minutes, is kept for a week, and the whole
// cache is persisted so Home, Najave and Istorija show the last data without a connection.
export const CACHE_MAX_AGE_MS = 7 * 24 * 3600_000;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60_000,
        gcTime: CACHE_MAX_AGE_MS,
        retry: 1,
        networkMode: 'offlineFirst',
      },
    },
  });
}

const KEY = 'query-cache';

// A persister over the same MMKV store as the rest of the app.
export const mmkvPersister: Persister = {
  persistClient: (client: PersistedClient) => {
    storage().set(KEY, JSON.stringify(client));
  },
  restoreClient: () => {
    const raw = storage().getString(KEY);
    return raw ? (JSON.parse(raw) as PersistedClient) : undefined;
  },
  removeClient: () => {
    storage().remove(KEY);
  },
};
