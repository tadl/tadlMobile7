import { Injectable } from '@angular/core';
import { lastValueFrom } from 'rxjs';

import { AuthService } from './auth.service';
import { AccountStoreService } from './account-store.service';
import { ListsService } from './lists.service';

@Injectable({ providedIn: 'root' })
export class CacheWarmService {
  constructor(
    private auth: AuthService,
    private accounts: AccountStoreService,
    private lists: ListsService,
  ) {}

  warmForActiveAccount(): void {
    // Keep account warm-up cheap: profile gives us counts/badges without pulling
    // the full holds/checkouts/fines/lists payloads up front.
    void this.safeRun(async () => {
      await this.accounts.prewarmActivePassword();
      await lastValueFrom(this.auth.refreshActiveProfile());
      await lastValueFrom(this.lists.fetchUserLists());
    });
  }

  private async safeRun(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch {
      // warm-up is best-effort by design.
    }
  }
}
