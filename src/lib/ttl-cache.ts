interface Entry<V> {
  value: V;
  expiresAt: number;
}

/**
 * Minimal in-memory TTL cache. Upstream data (TLEs, Kp forecasts) changes
 * slowly, so we can serve it from a short-lived cache instead of hitting
 * CelesTrak / NOAA on every page load. Not shared across serverless
 * instances, but it still removes the bulk of redundant upstream traffic.
 */
export class TtlCache<K, V> {
  private entries = new Map<K, Entry<V>>();

  constructor(private readonly now: () => number = Date.now) {}

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V, ttlMs: number): void {
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  clear(): void {
    this.entries.clear();
  }
}
