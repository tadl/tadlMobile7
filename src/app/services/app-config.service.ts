import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';

import { Globals } from '../globals';
import { AppCacheService } from './app-cache.service';
import { parseAppConfig } from './app-config.types';

@Injectable({ providedIn: 'root' })
export class AppConfigService {
  private http = inject(HttpClient);
  private globals = inject(Globals);
  private cache = inject(AppCacheService);

  private readonly apiBase = this.globals.aspen_api_base.replace(/\/+$/, '');
  private readonly backend = this.globals.aspen_api_param_api;
  private readonly cacheKey = `app-config:v1:${encodeURIComponent(this.apiBase)}:${this.backend}`;
  private readonly refreshIntervalMs = 5 * 60 * 1000;
  private readonly retryIntervalMs = 30 * 1000;
  private initialized: Promise<void> | null = null;
  private inFlight: Promise<void> | null = null;
  private nextRefreshAt = 0;
  private receivedNetworkConfig = false;

  /** Startup waits only for local storage; the bundled mapping remains usable offline. */
  initialize(): Promise<void> {
    this.initialized ??= this.loadCachedConfig();
    return this.initialized;
  }

  refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const now = Date.now();
    if (now < this.nextRefreshAt) {
      return Promise.resolve();
    }
    this.nextRefreshAt = now + this.retryIntervalMs;
    this.inFlight = this.fetchConfig().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async loadCachedConfig(): Promise<void> {
    try {
      const config = parseAppConfig(await this.cache.read<unknown>(this.cacheKey), this.backend);
      if (config && !this.receivedNetworkConfig) this.globals.applyAppConfig(config);
    } catch {
      // Storage is optional; retain the bundled mapping if it is unavailable.
    }
    void this.refresh();
  }

  private async fetchConfig(): Promise<void> {
    try {
      const response = await firstValueFrom(this.http.get<unknown>(`${this.apiBase}/AppConfig`, {
        params: { api: this.backend },
        headers: { 'x-skip-global-loading': '1' },
      }).pipe(timeout(5000)));
      const config = parseAppConfig(response, this.backend);
      if (!config) return;
      this.globals.applyAppConfig(config);
      this.receivedNetworkConfig = true;
      this.nextRefreshAt = Date.now() + this.refreshIntervalMs;
      await this.cache.write(this.cacheKey, config);
    } catch {
      // Never replace a working mapping with a failed or malformed response.
    }
  }
}
