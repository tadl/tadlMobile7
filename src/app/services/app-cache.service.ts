import { Injectable } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { backendStorageKey } from './backend-storage';

interface CacheEnvelope<T> {
  updatedAt: number;
  value: T;
}

@Injectable({ providedIn: 'root' })
export class AppCacheService {
  private readonly prefix = backendStorageKey('cache:v1:');
  private readonly maxValueBytes = 1_000_000;
  private readonly lastSerializedByKey = new Map<string, string>();
  private readonly operationsByKey = new Map<string, Promise<void>>();
  private cleanupBarrier: Promise<void> = Promise.resolve();

  async read<T>(key: string): Promise<T | null> {
    const cacheKey = this.cacheKey(key);
    return this.inKeyOrder(cacheKey, async () => {
      try {
        const { value } = await Preferences.get({ key: cacheKey });
        if (!value) {
          this.lastSerializedByKey.delete(cacheKey);
          return null;
        }
        const parsed = JSON.parse(value) as CacheEnvelope<T> | T;
        const extracted = parsed && typeof parsed === 'object' && 'value' in parsed
          ? (parsed as CacheEnvelope<T>).value ?? null
          : (parsed as T) ?? null;
        this.lastSerializedByKey.set(cacheKey, JSON.stringify(extracted));
        return extracted;
      } catch {
        this.lastSerializedByKey.delete(cacheKey);
        return null;
      }
    });
  }

  async write<T>(key: string, value: T): Promise<void> {
    const cacheKey = this.cacheKey(key);
    const serializedValue = JSON.stringify(value ?? null);
    // Capture the supplied value now, before a caller can mutate it while queued.
    const serializedEnvelope = JSON.stringify({ updatedAt: Date.now(), value: value ?? null });
    await this.inKeyOrder(cacheKey, async () => {
      if (this.lastSerializedByKey.get(cacheKey) === serializedValue) return;
      if (this.byteLength(serializedEnvelope) > this.maxValueBytes) {
        await Preferences.remove({ key: cacheKey });
        this.lastSerializedByKey.delete(cacheKey);
        return;
      }
      await Preferences.set({ key: cacheKey, value: serializedEnvelope });
      this.lastSerializedByKey.set(cacheKey, serializedValue);
    });
  }

  async remove(key: string): Promise<void> {
    const cacheKey = this.cacheKey(key);
    await this.inKeyOrder(cacheKey, async () => {
      await Preferences.remove({ key: cacheKey });
      this.lastSerializedByKey.delete(cacheKey);
    });
  }

  async removeByPrefixes(prefixes: string[]): Promise<void> {
    const normalized = (prefixes ?? [])
      .map(prefix => (prefix ?? '').toString().trim())
      .filter(Boolean)
      .map(prefix => this.cacheKey(prefix));
    if (!normalized.length) return;

    const matches = (key: string) => normalized.some(prefix => key.startsWith(prefix));
    const pending = [...this.operationsByKey.entries()].filter(([key]) => matches(key));
    const previousCleanup = this.cleanupBarrier;
    const cleanup = previousCleanup.then(async () => {
      // Include keys whose writes are still pending and not yet listed on disk.
      await Promise.all(pending.map(([, operation]) => operation));
      const { keys } = await Preferences.keys();
      const toRemove = new Set([
        ...(keys ?? []).filter(matches),
        ...pending.map(([key]) => key),
      ]);
      const results = await Promise.allSettled([...toRemove].map(key => Preferences.remove({ key })));
      for (const key of toRemove) this.lastSerializedByKey.delete(key);
      const failed = results.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
    });
    // Later operations wait until enumeration and every removal finish. This
    // prevents an older cleanup from deleting a newly written login cache.
    this.cleanupBarrier = cleanup.catch(() => {});
    await cleanup;
  }

  private inKeyOrder<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.operationsByKey.get(key) ?? Promise.resolve();
    const cleanup = this.cleanupBarrier;
    const result = Promise.all([previous, cleanup]).then(operation).catch(error => {
      // A native call may fail after applying its side effect; its old value is
      // no longer a safe basis for skipping a future write.
      this.lastSerializedByKey.delete(key);
      throw error;
    });
    const tail = result.then(() => {}, () => {});
    this.operationsByKey.set(key, tail);
    void tail.then(() => {
      if (this.operationsByKey.get(key) === tail) this.operationsByKey.delete(key);
    });
    return result;
  }

  private cacheKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  private byteLength(value: string): number {
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(value).length;
    }
    return value.length;
  }
}
