import { useEffect, useState } from 'react';
import { gazetteerResponseSchema, type GazetteerResponse } from '@struja/shared';
import { api } from '../api/runtime';
import { storage, type KeyValueStorage } from '../store/storage';
import { buildIndex, type GazetteerIndex } from './search';

// The gazetteer of a city is cached on the device (MMKV) with its ETag. A refresh sends the ETag and
// a 304 keeps the cached copy; offline, the cached copy is used as it is.
const key = (city: string) => `gazetteer:${city}`;

export function readCached(kv: KeyValueStorage, city: string): GazetteerResponse | null {
  const raw = kv.getString(key(city));
  if (!raw) return null;
  try {
    return gazetteerResponseSchema.parse(JSON.parse(raw));
  } catch {
    // A damaged or outdated copy is dropped; the next refresh downloads it again.
    kv.remove(key(city));
    return null;
  }
}

export interface GazetteerSource {
  gazetteer(city: string, etag?: string): Promise<GazetteerResponse | null>;
}

/** A conditional refresh: the new copy is stored; a 304 (or no copy yet to compare) keeps the cached one. */
export async function refreshGazetteer(
  source: GazetteerSource,
  kv: KeyValueStorage,
  city: string,
): Promise<GazetteerResponse | null> {
  const cached = readCached(kv, city);
  const fresh = await source.gazetteer(city, cached?.etag);
  if (fresh) {
    kv.set(key(city), JSON.stringify(fresh));
    return fresh;
  }
  return cached;
}

export type GazetteerStatus = 'loading' | 'ready' | 'error';

/** The search index of a city: instant from the cache, refreshed in the background. */
export function useGazetteer(city: string): {
  index: GazetteerIndex | null;
  status: GazetteerStatus;
  retry: () => void;
} {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ index: GazetteerIndex | null; status: GazetteerStatus }>(
    () => {
      const cached = readCached(storage(), city);
      return cached
        ? { index: buildIndex(cached), status: 'ready' }
        : { index: null, status: 'loading' };
    },
  );
  useEffect(() => {
    let cancelled = false;
    if (attempt > 0) setState((s) => ({ index: s.index, status: s.index ? 'ready' : 'loading' }));
    refreshGazetteer(api, storage(), city)
      .then((g) => {
        if (cancelled) return;
        setState((s) =>
          g ? { index: buildIndex(g), status: 'ready' } : { index: s.index, status: 'error' },
        );
      })
      .catch(() => {
        // Offline or the server is down: keep what is cached, otherwise report the error.
        if (!cancelled) setState((s) => ({ index: s.index, status: s.index ? 'ready' : 'error' }));
      });
    return () => {
      cancelled = true;
    };
  }, [city, attempt]);
  return { ...state, retry: () => setAttempt((n) => n + 1) };
}
