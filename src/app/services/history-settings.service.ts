import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, from, map, switchMap } from 'rxjs';
import { Globals } from '../globals';
import { AppCacheService } from './app-cache.service';
import { UserApiQueueService } from './user-api-queue.service';

export interface HistoryUpdate {
  success: boolean;
  complete: boolean;
  historyStatus: string;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class HistorySettingsService {
  private http = inject(HttpClient);
  private globals = inject(Globals);
  private cache = inject(AppCacheService);
  private queue = inject(UserApiQueueService);

  update(accountId: string, username: string, password: string, enabled: boolean): Observable<HistoryUpdate> {
    return this.request(accountId, username, password, 'update', enabled);
  }

  status(accountId: string, username: string, password: string): Observable<HistoryUpdate> {
    return this.request(accountId, username, password, 'status');
  }

  private request(accountId: string, username: string, password: string, operation: string, enabled?: boolean): Observable<HistoryUpdate> {
    const body = new URLSearchParams({ username, password, operation });
    if (enabled !== undefined) body.set('enabled', String(enabled));
    return from(this.cache.removeByPrefixes([`history:${accountId}:`])).pipe(
      switchMap(() => this.queue.run(accountId, () => this.http.post<{ result: HistoryUpdate }>(
        `${this.globals.aspen_api_base}/ReadingHistory`, body.toString(),
        { headers: new HttpHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }) }
      ))),
      map(response => response.result),
    );
  }
}
