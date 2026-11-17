import { Injectable, inject } from '@angular/core';
import { lastValueFrom } from 'rxjs';
import { HttpClient, HttpHeaders } from '@angular/common/http';

import { AuthService, type ActiveProfileSession } from './auth.service';
import { AccountStoreService } from './account-store.service';
import { ListsService } from './lists.service';
import { AccountPreferencesService } from './account-preferences.service';
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
    const username = (snap?.activeAccountMeta?.username ?? '').toString().trim();
    const session = this.auth.captureActiveProfileSession();
    if (!accountId || !username || session?.accountId !== accountId) return;

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
      const password = await this.accounts.getPassword(accountId);
      if (!password) return;
      const warmed = await this.warmFromBundledEndpoint(session, username, password);
      if (warmed) return;

      const currentSession = this.auth.captureActiveProfileSession();
      const accountStillActive = currentSession?.accountId === session.accountId &&
        currentSession.revision === session.revision;
      await Promise.all([
        ...(accountStillActive ? [
          this.settle(lastValueFrom(this.auth.refreshActiveProfile())),
          this.settle(lastValueFrom(this.lists.fetchUserLists())),
        ] : []),
        this.settle(this.warmPreferencesForAccount(accountId, username, password)),
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

  private async warmPreferencesForAccount(accountId: string, username: string, password: string): Promise<void> {
    await lastValueFrom(
      this.preferences.fetchForAccount(accountId, username, password)
    );
  }

  private async warmFromBundledEndpoint(session: ActiveProfileSession, username: string, password: string): Promise<boolean> {
    const accountId = session.accountId;
    const body = new URLSearchParams();
    body.set('username', username);
    body.set('password', password);
    // Explicit capability: older clients cannot handle asynchronous history states.
    body.set('historyCoordinator', '1');
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
    if (raw?.userapi?.result?.success === true && profile && typeof profile === 'object' && !Array.isArray(profile)) {
      await this.auth.commitProfileForSession(session, profile);
    }

    const listResult = raw?.listapi?.result;
    const rawLists = listResult?.lists;
    if (listResult?.success && Array.isArray(rawLists)) {
      const lists = rawLists as AspenUserList[];
      await this.cache.write(`lists:user:${accountId}`, lists);
    }

    const payload = this.preferences.parsePayload(raw?.preferences);
    if (payload) {
      await Promise.allSettled([
        this.preferences.persistTokenForAccount(accountId, payload.token),
        this.preferences.persistPreferencesForAccount(accountId, payload.preferences),
      ]);
    } else {
      await this.settle(this.warmPreferencesForAccount(accountId, username, password));
    }

    const locationsRaw = raw?.locations;
    if (Array.isArray(locationsRaw)) {
      await this.locations.hydrateLocations(locationsRaw);
    }

    return true;
  }
}
