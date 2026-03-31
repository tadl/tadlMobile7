import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

import { AppCacheService } from './app-cache.service';

@Injectable({ providedIn: 'root' })
export class ServiceAlertService {
  private readonly cacheKey = 'proxy:service-alert';
  private readonly alertSubject = new BehaviorSubject<string | null>(null);

  constructor(private cache: AppCacheService) {
    void this.restoreFromCache();
  }

  alert$(): Observable<string | null> {
    return this.alertSubject.asObservable();
  }

  snapshot(): string | null {
    return this.alertSubject.value;
  }

  async set(message: string | null | undefined): Promise<void> {
    const next = this.normalize(message);
    if (next === this.alertSubject.value) return;

    this.alertSubject.next(next);
    if (next) {
      await this.cache.write(this.cacheKey, next);
    } else {
      await this.cache.remove(this.cacheKey);
    }
  }

  async clear(): Promise<void> {
    await this.set(null);
  }

  private async restoreFromCache(): Promise<void> {
    const cached = await this.cache.read<string>(this.cacheKey);
    const next = this.normalize(cached);
    this.alertSubject.next(next);
  }

  private normalize(message: string | null | undefined): string | null {
    const normalized = (message ?? '').toString().trim();
    return normalized || null;
  }
}
