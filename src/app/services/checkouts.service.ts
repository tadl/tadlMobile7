// src/app/services/checkouts.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, map, switchMap, from, throwError } from 'rxjs';
import { Preferences } from '@capacitor/preferences';

import { Globals } from '../globals';
import { AuthService } from './auth.service';
import { AccountStoreService } from './account-store.service';

export interface AspenCheckout {
  id: number;
  type: string; // "ils"
  source: string; // "ils"
  userId?: number;
  sourceId?: number;

  recordId?: number;
  groupedWorkId?: string;

  title?: string;
  author?: string;
  coverUrl?: string;
  linkUrl?: string;

  format?: string;

  itemId?: number;
  itemIndex?: number | null;

  barcode?: string;

  checkoutDate?: number; // epoch seconds
  dueDate?: number; // epoch seconds
  renewalDate?: string;

  canRenew?: boolean;
  renewCount?: number | null;
  maxRenewals?: number | null;

  renewError?: string | null;
  renewMessage?: string;

  overdue?: boolean;
  daysUntilDue?: number;

  // allow extra fields without TS4111 pain
  [k: string]: any;
}

export interface AspenMutationResult {
  success: boolean;
  title?: string;
  message?: string;
  raw?: any;
}

const PREF_APP_SESSION_ID = 'app:aspenSessionId';

@Injectable({ providedIn: 'root' })
export class CheckoutsService {
  private sessionId: string | null = null;

  constructor(
    private http: HttpClient,
    private globals: Globals,
    private auth: AuthService,
    private accounts: AccountStoreService,
  ) {}

  /**
   * POST /API/UserAPI?method=getPatronCheckedOutItems
   * Body: username/password (x-www-form-urlencoded)
   */
  fetchActiveCheckouts(): Observable<AspenCheckout[]> {
    const snap = this.auth.snapshot();
    if (!snap.isLoggedIn || !snap.activeAccountId || !snap.activeAccountMeta) {
      return from([[]]);
    }

    return from(this.accounts.getPassword(snap.activeAccountId)).pipe(
      switchMap(password => {
        if (!password) return throwError(() => new Error('missing_password'));

        const params = new HttpParams().set('method', 'getPatronCheckedOutItems');

        const body = new URLSearchParams();
        body.set('username', snap.activeAccountMeta!.username);
        body.set('password', password);

        const headers = new HttpHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' });

        return this.http
          .post<any>(`${this.globals.aspen_api_base}/UserAPI`, body.toString(), { params, headers })
          .pipe(
            map(raw => raw?.result ?? raw),
            map((r: any) => {
              if (!r?.success) return [];
              const list = Array.isArray(r?.checkedOutItems) ? (r.checkedOutItems as AspenCheckout[]) : [];
              return list.filter((c) => c?.type === 'ils' || c?.source === 'ils');
            }),
          );
      }),
    );
  }

  /**
   * Renew using UserAPI method "renewItem" (recommended).
   *
   * POST /API/UserAPI?method=renewItem
   * params: itemSource=ils, itemBarcode, recordId
   * body: username/password
   */
  renewCheckout(checkout: AspenCheckout): Observable<AspenMutationResult> {
    const recordId = this.pickRecordId(checkout);
    const barcode = (checkout?.barcode ?? '').toString().trim();

    if (!recordId) return throwError(() => new Error('missing_record_id'));
    if (!barcode) return throwError(() => new Error('missing_barcode'));

    return this.callUserApiMutation('renewItem', {
      itemSource: this.pickItemSource(checkout),
      itemBarcode: barcode,
      recordId: String(recordId),
    });
  }

  // ---------- Core mutation plumbing (same pattern as HoldsService) ----------

  private callUserApiMutation(method: string, extraParams: Record<string, string>): Observable<AspenMutationResult> {
    const snap = this.auth.snapshot();
    if (!snap.isLoggedIn || !snap.activeAccountId || !snap.activeAccountMeta) {
      return throwError(() => new Error('not_logged_in'));
    }

    const userId = this.pickPatronId(snap.profile);
    if (!userId) return throwError(() => new Error('missing_user_id'));

    return from(this.accounts.getPassword(snap.activeAccountId)).pipe(
      switchMap(password => {
        if (!password) return throwError(() => new Error('missing_password'));

        return from(this.getOrCreateSessionId()).pipe(
          switchMap(sessionId => {
            let params = new HttpParams().set('method', method);

            params = params.set('sessionId', sessionId);
            params = params.set('userId', String(userId));

            for (const [k, v] of Object.entries(extraParams)) {
              params = params.set(k, (v ?? '').toString());
            }

            const body = new URLSearchParams();
            body.set('username', snap.activeAccountMeta!.username);
            body.set('password', password);

            const headers = new HttpHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' });

            return this.http
              .post<any>(`${this.globals.aspen_api_base}/UserAPI`, body.toString(), { params, headers })
              .pipe(
                map(raw => raw?.result ?? raw),
                map((r: any) => {
                  const success = r?.success !== undefined ? !!r.success : true;
                  return {
                    success,
                    title: typeof r?.title === 'string' ? r.title : undefined,
                    message: typeof r?.message === 'string' ? r.message : (typeof r?.renewMessage === 'string' ? r.renewMessage : undefined),
                    raw: r,
                  } satisfies AspenMutationResult;
                }),
              );
          }),
        );
      }),
    );
  }

  // ---------- Session id ----------

  private async getOrCreateSessionId(): Promise<string> {
    if (this.sessionId) return this.sessionId;

    const { value } = await Preferences.get({ key: PREF_APP_SESSION_ID });
    if (value && value.trim()) {
      this.sessionId = value.trim();
      return this.sessionId;
    }

    const sid = 'sid_' + Math.random().toString(36).slice(2) + '_' + Date.now().toString(36);
    await Preferences.set({ key: PREF_APP_SESSION_ID, value: sid });
    this.sessionId = sid;
    return sid;
  }

  // ---------- Small helpers ----------

  private pickPatronId(profile: any): number | null {
    const n = Number(profile?.id);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  private pickRecordId(checkout: AspenCheckout): number | null {
    const n = Number((checkout as any)?.recordId);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  private pickItemSource(checkout: AspenCheckout): string {
    const s = ((checkout as any)?.source ?? (checkout as any)?.type ?? 'ils').toString().trim();
    return s || 'ils';
  }
}
