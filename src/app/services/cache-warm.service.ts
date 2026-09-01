import { Injectable, inject } from '@angular/core';
import { lastValueFrom } from 'rxjs';
import { HttpClient, HttpHeaders } from '@angular/common/http';

import { AuthService } from './auth.service';
import { AccountStoreService } from './account-store.service';
import { ListsService } from './lists.service';
import {
  AccountPreferences,
  AccountPreferencesService,
} from './account-preferences.service';
import { AppCacheService } from './app-cache.service';
import { Globals } from '../globals';
import { AspenUserList } from './lists.service';
import { LocationsService } from './locations.service';

@Injectable({ providedIn: 'root' })
export class CacheWarmService {
  private http = inject(HttpClient);
  private globals = inject(Globals);
  private auth = inject(AuthService);
  private accounts = inject(AccountStoreService);
  private lists = inject(ListsService);
  private preferences = inject(AccountPreferencesService);
  private cache = inject(AppCacheService);
  private locations = inject(LocationsService);

  private readonly warmThrottleMs = 5 * 60 * 1000;
  private lastWarmAt = 0;
  private lastWarmAccountId: string | null = null;

  warmForActiveAccount(): void {
    const snap = this.auth.snapshot();
    const accountId = (snap?.activeAccountId ?? '').toString().trim();
    if (!accountId) return;

    const now = Date.now();
    if (
      this.lastWarmAccountId === accountId &&
      now - this.lastWarmAt < this.warmThrottleMs
    ) {
      return;
    }
    this.lastWarmAt = now;
    this.lastWarmAccountId = accountId;

    // Keep account warm-up cheap: profile gives us counts/badges without pulling
    // the full holds/checkouts/fines/lists payloads up front.
    void this.safeRun(async () => {
      await this.accounts.prewarmActivePassword();
      const warmed = await this.warmFromBundledEndpoint();
      if (warmed) return;

      await Promise.all([
        this.settle(lastValueFrom(this.auth.refreshActiveProfile())),
        this.settle(lastValueFrom(this.lists.fetchUserLists())),
        this.settle(this.warmPreferencesForActiveAccount()),
        this.settle(lastValueFrom(this.locations.getLocations())),
      ]);
    });
  }

  private async safeRun(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch {
      // warm-up is best-effort by design.
    }
  }

  private async settle(promise: Promise<unknown>): Promise<void> {
    try {
      await promise;
    } catch {
      // Individual warm-up calls should not block the rest of the batch.
    }
  }

  private async warmPreferencesForActiveAccount(): Promise<void> {
    const snap = this.auth.snapshot();
    const accountId = (snap?.activeAccountId ?? '').toString().trim();
    const username = (snap?.activeAccountMeta?.username ?? '')
      .toString()
      .trim();
    if (!accountId || !username) return;

    const password = await this.accounts.getPassword(accountId);
    if (!password) return;

    await lastValueFrom(
      this.preferences.fetchForAccount(accountId, username, password)
    );
  }

  private async warmFromBundledEndpoint(): Promise<boolean> {
    const snap = this.auth.snapshot();
    const accountId = (snap?.activeAccountId ?? '').toString().trim();
    const username = (snap?.activeAccountMeta?.username ?? '')
      .toString()
      .trim();
    if (!accountId || !username) return false;

    const password = await this.accounts.getPassword(accountId);
    if (!password) return false;

    const body = new URLSearchParams();
    body.set('username', username);
    body.set('password', password);
    const headers = new HttpHeaders({
      'Content-Type': 'application/x-www-form-urlencoded',
    });

    let raw: any;
    try {
      raw = await lastValueFrom(
        this.http.post<any>(
          `${this.globals.aspen_api_base}/CacheWarm`,
          body.toString(),
          { headers }
        )
      );
    } catch {
      return false;
    }

    if (!raw?.ok) return false;

    const profile = raw?.userapi?.result?.profile;
    if (profile && typeof profile === 'object') {
      await this.accounts.cacheProfile(accountId, profile);
      this.auth.applyActiveProfile(profile);
    }

    const rawLists = raw?.listapi?.result?.lists;
    if (Array.isArray(rawLists)) {
      const lists = rawLists as AspenUserList[];
      await this.cache.write(`lists:user:${accountId}`, lists);
    }

    const token = (raw?.preferences?.user?.token ?? '').toString().trim();
    if (token) {
      await this.preferences.persistTokenForAccount(accountId, token);
    }

    const prefsRaw = raw?.preferences?.preferences;
    if (prefsRaw && typeof prefsRaw === 'object') {
      await this.preferences.persistPreferencesForAccount(
        accountId,
        prefsRaw as AccountPreferences
      );
    }

    const locationsRaw = raw?.locations;
    if (Array.isArray(locationsRaw)) {
      await this.locations.hydrateLocations(locationsRaw);
    }

    return true;
  }
}
