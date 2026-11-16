import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, finalize, from, map, shareReplay, switchMap } from 'rxjs';

import { Globals } from '../globals';
import { AuthService } from './auth.service';
import { AccountStoreService } from './account-store.service';
import { UserApiQueueService } from './user-api-queue.service';

export interface AspenFine {
  reason?: string;
  amount?: string;
  amountVal?: number;
  amountOutstanding?: string;
  amountOutstandingVal?: number;
  amountOriginal?: string;
  amountOriginalVal?: number;
  message?: string;
  date?: string;
  [k: string]: any;
}

export interface AspenPatronFinesResponse {
  success: boolean;
  fines: AspenFine[];
  totalOwed: number;
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class FinesService {
  private http = inject(HttpClient);
  private globals = inject(Globals);
  private auth = inject(AuthService);
  private accounts = inject(AccountStoreService);
  private userApiQueue = inject(UserApiQueueService);

  private activeFetches = new Map<string, Observable<AspenPatronFinesResponse>>();

  fetchPatronFines(): Observable<AspenPatronFinesResponse> {
    const snap = this.auth.snapshot();
    if (!snap.isLoggedIn || !snap.activeAccountId || !snap.activeAccountMeta) {
      return from([
        {
          success: false,
          fines: [],
          totalOwed: 0,
          message: 'not_logged_in',
        } satisfies AspenPatronFinesResponse,
      ]);
    }

    const accountId = snap.activeAccountId;
    const existing = this.activeFetches.get(accountId);
    if (existing) return existing;

    const request$: Observable<AspenPatronFinesResponse> = from(this.accounts.getPassword(accountId)).pipe(
      switchMap((password) => {
        if (!password) {
          return from([
            {
              success: false,
              fines: [],
              totalOwed: 0,
              message: 'missing_password',
            } satisfies AspenPatronFinesResponse,
          ]);
        }

        const params = new HttpParams()
          .set('method', 'getPatronFines')
          .set('includeLinkedUsers', 'true');

        const body = new URLSearchParams();
        body.set('username', snap.activeAccountMeta!.username);
        body.set('password', password);

        const headers = new HttpHeaders({
          'Content-Type': 'application/x-www-form-urlencoded',
        });

        return this.userApiQueue
          .run(snap.activeAccountId, () =>
            this.http.post<any>(
              `${this.globals.aspen_api_base}/UserAPI`,
              body.toString(),
              { params, headers }
            )
          )
          .pipe(
            map((raw) => {
              const result = raw?.result ?? raw ?? {};
              const fines = this.normalizeFineCollection(result?.fines);
              const totalOwed = this.computeTotalOwed(fines, result?.totalOwed);

              return {
                success: !!result?.success,
                fines,
                totalOwed,
                message:
                  typeof result?.message === 'string'
                    ? result.message
                    : undefined,
              } satisfies AspenPatronFinesResponse;
            })
          );
      }),
      finalize(() => {
        if (this.activeFetches.get(accountId) === request$) {
          this.activeFetches.delete(accountId);
        }
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.activeFetches.set(accountId, request$);
    return request$;
  }

  private normalizeFineCollection(input: any): AspenFine[] {
    if (!input) return [];
    if (Array.isArray(input)) return input as AspenFine[];
    if (typeof input !== 'object') return [];

    const out: AspenFine[] = [];
    for (const value of Object.values(input)) {
      if (Array.isArray(value)) {
        out.push(...(value as AspenFine[]));
      }
    }
    return out;
  }

  private computeTotalOwed(fines: AspenFine[], rawTotal: any): number {
    const summed = (fines ?? []).reduce((sum, fine) => {
      const outstanding = Number(fine?.amountOutstandingVal);
      if (Number.isFinite(outstanding)) return sum + outstanding;

      const amountVal = Number(fine?.amountVal);
      if (Number.isFinite(amountVal)) return sum + amountVal;

      return sum;
    }, 0);

    if (summed > 0) return summed;

    const reported = Number(rawTotal);
    return Number.isFinite(reported) ? reported : 0;
  }
}
