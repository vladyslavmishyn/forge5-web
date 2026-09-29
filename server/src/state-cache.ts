/**
 * Tiny TTL cache with single-flight loading and generation-based invalidation, used for the public
 * GET /api/state payload (identical for every caller — it is built from the database only).
 *
 * - Hits within `ttlMs` return the cached value.
 * - Concurrent misses share one in-flight load.
 * - invalidate() bumps a generation: a load that started before the invalidation is neither cached
 *   nor handed to callers that arrive after it, so a read right after a mutation always sees it.
 */
export interface StateCache<T> {
  get(): Promise<T>;
  invalidate(): void;
}

export function createStateCache<T>(load: () => Promise<T>, ttlMs = 2000): StateCache<T> {
  let gen = 0;
  let cached: { data: T; at: number; gen: number } | null = null;
  let inflight: { promise: Promise<T>; gen: number } | null = null;

  return {
    get() {
      if (cached && cached.gen === gen && Date.now() - cached.at < ttlMs) return Promise.resolve(cached.data);
      if (inflight && inflight.gen === gen) return inflight.promise;
      const myGen = gen;
      const promise: Promise<T> = load()
        .then((data) => {
          if (myGen === gen) cached = { data, at: Date.now(), gen: myGen };
          return data;
        })
        .finally(() => {
          if (inflight?.promise === promise) inflight = null;
        });
      inflight = { promise, gen: myGen };
      return promise;
    },
    invalidate() {
      gen++;
      cached = null;
    },
  };
}
