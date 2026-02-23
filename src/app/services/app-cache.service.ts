import { Injectable } from '@angular/core';
import { Preferences } from '@capacitor/preferences';

interface CacheEnvelope<T> {
  updatedAt: number;
  value: T;
}

@Injectable({ providedIn: 'root' })
export class AppCacheService {
  private readonly prefix = 'cache:v1:';

  async read<T>(key: string): Promise<T | null> {
    try {
      const { value } = await Preferences.get({ key: this.cacheKey(key) });
      if (!value) return null;
      const parsed = JSON.parse(value) as CacheEnvelope<T> | T;

      // Backward-compatible: allow plain value writes.
      if (parsed && typeof parsed === 'object' && 'value' in (parsed as any)) {
        return (parsed as CacheEnvelope<T>).value ?? null;
      }
      return (parsed as T) ?? null;
    } catch {
      return null;
    }
  }

  async write<T>(key: string, value: T): Promise<void> {
    const envelope: CacheEnvelope<T> = {
      updatedAt: Date.now(),
      value,
    };
    await Preferences.set({
      key: this.cacheKey(key),
      value: JSON.stringify(envelope),
    });
  }

  async remove(key: string): Promise<void> {
    await Preferences.remove({ key: this.cacheKey(key) });
  }

  private cacheKey(key: string): string {
    return `${this.prefix}${key}`;
  }
}

