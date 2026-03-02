import { Injectable } from '@angular/core';
import { lastValueFrom } from 'rxjs';

import { AuthService } from './auth.service';
import { HoldsService } from './holds.service';
import { CheckoutsService } from './checkouts.service';
import { ListsService } from './lists.service';
import { NewsService } from './news.service';
import { EventsService } from './events.service';
import { LocationsService } from './locations.service';

@Injectable({ providedIn: 'root' })
export class CacheWarmService {
  constructor(
    private auth: AuthService,
    private holds: HoldsService,
    private checkouts: CheckoutsService,
    private lists: ListsService,
    private news: NewsService,
    private events: EventsService,
    private locations: LocationsService,
  ) {}

  warmForActiveAccount(): void {
    // Fire-and-forget background warm-up. This should never block UI.
    void Promise.all([
      this.safeRun(async () => {
        await lastValueFrom(this.auth.refreshActiveProfile());
      }),
      this.safeRun(async () => {
        await lastValueFrom(this.holds.fetchActiveHolds());
      }),
      this.safeRun(async () => {
        await lastValueFrom(this.checkouts.fetchActiveCheckouts());
      }),
      this.safeRun(async () => {
        await lastValueFrom(this.lists.fetchUserLists());
      }),
      this.safeRun(async () => {
        await lastValueFrom(this.news.getPosts());
      }),
      this.safeRun(async () => {
        await lastValueFrom(this.events.getEvents('all'));
      }),
      this.safeRun(async () => {
        await lastValueFrom(this.locations.getLocations());
      }),
    ]);
  }

  private async safeRun(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch {
      // warm-up is best-effort by design.
    }
  }
}
