import { Injectable } from '@angular/core';

import { AccountStoreService } from './account-store.service';
import { AppCacheService } from './app-cache.service';
import { ListLookupService } from './list-lookup.service';

@Injectable({ providedIn: 'root' })
export class AccountCacheCleanupService {
  constructor(
    private accounts: AccountStoreService,
    private cache: AppCacheService,
    private listLookup: ListLookupService,
  ) {}

  async clearForAccount(accountId: string | null | undefined): Promise<void> {
    const id = (accountId ?? '').toString().trim();
    if (!id) return;

    await Promise.all([
      this.accounts.clearCachedProfile(id),
      this.cache.removeByPrefixes([
        `accounts:holds:${id}`,
        `checkouts:${id}`,
        `history:${id}:`,
        `lists:user:${id}`,
        `lists:titles:${id}:`,
        `preferences:token:${id}`,
        `preferences:data:${id}`,
      ]),
    ]);

    this.listLookup.clearAccountState(id);
  }
}
