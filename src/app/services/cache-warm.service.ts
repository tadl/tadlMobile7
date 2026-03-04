import { Injectable } from '@angular/core';
import { lastValueFrom } from 'rxjs';

import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class CacheWarmService {
  constructor(
    private auth: AuthService,
  ) {}

  warmForActiveAccount(): void {
    // Keep account warm-up cheap: profile gives us counts/badges without pulling
    // the full holds/checkouts/fines/lists payloads up front.
    void this.safeRun(async () => {
      await lastValueFrom(this.auth.refreshActiveProfile());
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
