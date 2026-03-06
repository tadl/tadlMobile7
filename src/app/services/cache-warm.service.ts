import { Injectable } from '@angular/core';
import { lastValueFrom } from 'rxjs';

import { AuthService } from './auth.service';
import { AccountStoreService } from './account-store.service';
import { ListsService } from './lists.service';
import { AccountPreferencesService } from './account-preferences.service';

@Injectable({ providedIn: 'root' })
export class CacheWarmService {
  constructor(
    private auth: AuthService,
    private accounts: AccountStoreService,
    private lists: ListsService,
    private preferences: AccountPreferencesService,
  ) {}

  warmForActiveAccount(): void {
    // Keep account warm-up cheap: profile gives us counts/badges without pulling
    // the full holds/checkouts/fines/lists payloads up front.
    void this.safeRun(async () => {
      await this.accounts.prewarmActivePassword();
      await lastValueFrom(this.auth.refreshActiveProfile());
      await lastValueFrom(this.lists.fetchUserLists());
      await this.warmPreferencesForActiveAccount();
    });
  }

  private async safeRun(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch {
      // warm-up is best-effort by design.
    }
  }

  private async warmPreferencesForActiveAccount(): Promise<void> {
    const snap = this.auth.snapshot();
    const accountId = (snap?.activeAccountId ?? '').toString().trim();
    const username = (snap?.activeAccountMeta?.username ?? '').toString().trim();
    if (!accountId || !username) return;

    const password = await this.accounts.getPassword(accountId);
    if (!password) return;

    await lastValueFrom(
      this.preferences.fetchForAccount(accountId, username, password),
    );
  }
}
