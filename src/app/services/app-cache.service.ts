import { Injectable } from '@angular/core';
import { Preferences } from '@capacitor/preferences';

interface CacheEnvelope<T> {
  updatedAt: number;
  value: T;
}

@Injectable({ providedIn: 'root' })
export class AppCacheService {
  private readonly prefix = 'cache:v1:';
  private readonly lastSerializedByKey = new Map<string, string>();

  async read<T>(key: string): Promise<T | null> {
    try {
      const cacheKey = this.cacheKey(key);
      const { value } = await Preferences.get({ key: cacheKey });
      if (!value) return null;
      const parsed = JSON.parse(value) as CacheEnvelope<T> | T;

      // Backward-compatible: allow plain value writes.
      if (parsed && typeof parsed === 'object' && 'value' in (parsed as any)) {
        const extracted = (parsed as CacheEnvelope<T>).value ?? null;
        try {
          this.lastSerializedByKey.set(cacheKey, JSON.stringify(extracted));
        } catch {
          this.lastSerializedByKey.delete(cacheKey);
        }
        return extracted;
      }
      const extracted = (parsed as T) ?? null;
      try {
        this.lastSerializedByKey.set(cacheKey, JSON.stringify(extracted));
      } catch {
        this.lastSerializedByKey.delete(cacheKey);
      }
      return extracted;
    } catch {
      return null;
    }
  }

  async write<T>(key: string, value: T): Promise<void> {
    const cacheKey = this.cacheKey(key);
    const serializedValue = JSON.stringify(value ?? null);
    const previous = this.lastSerializedByKey.get(cacheKey);
    if (previous === serializedValue) return;

    const envelope: CacheEnvelope<T> = {
      updatedAt: Date.now(),
      value,
    };

    await Preferences.set({
      key: cacheKey,
      value: JSON.stringify(envelope),
    });
    this.lastSerializedByKey.set(cacheKey, serializedValue);
  }

  async remove(key: string): Promise<void> {
    const cacheKey = this.cacheKey(key);
    await Preferences.remove({ key: cacheKey });
    this.lastSerializedByKey.delete(cacheKey);
  }

  private cacheKey(key: string): string {
    return `${this.prefix}${key}`;
  }
}
