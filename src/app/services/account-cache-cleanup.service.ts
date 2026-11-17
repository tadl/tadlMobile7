import { Injectable, inject } from '@angular/core';

import { AuthService } from './auth.service';
import { AppCacheService } from './app-cache.service';
import { ListLookupService } from './list-lookup.service';

@Injectable({ providedIn: 'root' })
export class AccountCacheCleanupService {
  private auth = inject(AuthService);
  private cache = inject(AppCacheService);
  private listLookup = inject(ListLookupService);

  async clearForAccount(accountId: string | null | undefined): Promise<void> {
    const id = (accountId ?? '').toString().trim();
    if (!id) return;

    await Promise.all([
      this.auth.clearInactiveCachedProfile(id),
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
