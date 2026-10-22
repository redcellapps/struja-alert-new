import type { Db } from '../db/client.ts';
import { loadGazetteer, type LoadedGazetteer } from './load.ts';

/**
 * The in-memory gazetteer (and its Resolver) per city, loaded from Postgres on first use and
 * rebuilt by `invalidate` after the street list or the aliases change.
 */
export class GazetteerService {
  private readonly db: Db;
  private readonly cache = new Map<string, Promise<LoadedGazetteer>>();

  // No constructor parameter properties: Node's type stripping cannot run them.
  constructor(db: Db) {
    this.db = db;
  }

  get(city: string): Promise<LoadedGazetteer> {
    let loaded = this.cache.get(city);
    if (!loaded) {
      loaded = loadGazetteer(this.db, city).catch((e) => {
        this.cache.delete(city);
        throw e;
      });
      this.cache.set(city, loaded);
    }
    return loaded;
  }

  invalidate(city?: string): void {
    if (city) this.cache.delete(city);
    else this.cache.clear();
  }
}
