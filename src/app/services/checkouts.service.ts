// src/app/services/checkouts.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, map, switchMap, from, throwError, concat, filter, tap, finalize, shareReplay, timer } from 'rxjs';
import { Preferences } from '@capacitor/preferences';

import { Globals } from '../globals';
import { AuthService } from './auth.service';
import { AccountStoreService } from './account-store.service';
import { AppCacheService } from './app-cache.service';
import { DiscoveryUrlService } from './discovery-url.service';
import { UserApiQueueService } from './user-api-queue.service';
import { AccountPreferencesService } from './account-preferences.service';

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
const SUSPICIOUS_EMPTY_CHECKOUTS_CACHE_THRESHOLD = 10;
const SUSPICIOUS_EMPTY_CHECKOUTS_RETRY_DELAY_MS = 750;

@Injectable({ providedIn: 'root' })
export class CheckoutsService {
  private sessionId: string | null = null;
  private activeFetch$: Observable<AspenCheckout[]> | null = null;

  constructor(
    private http: HttpClient,
    private globals: Globals,
    private auth: AuthService,
    private accounts: AccountStoreService,
    private cache: AppCacheService,
    private discoveryUrls: DiscoveryUrlService,
    private userApiQueue: UserApiQueueService,
    private preferences: AccountPreferencesService,
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

    const cacheKey = `checkouts:${snap.activeAccountId}`;
    const cached$ = from(this.cache.read<AspenCheckout[]>(cacheKey)).pipe(
      filter((v): v is AspenCheckout[] => Array.isArray(v)),
    );

    const network$ = this.activeFetch$ ?? this.fetchCheckoutsNetwork(snap, cacheKey).pipe(
      finalize(() => {
        this.activeFetch$ = null;
      }),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    this.activeFetch$ = network$;

    return concat(cached$, network$);
  }

  fetchFreshActiveCheckouts(refreshCheckouts = false): Observable<AspenCheckout[]> {
    const snap = this.auth.snapshot();
    if (!snap.isLoggedIn || !snap.activeAccountId || !snap.activeAccountMeta) {
      return from([[]]);
    }

    const cacheKey = `checkouts:${snap.activeAccountId}`;
    return this.fetchCheckoutsNetwork(snap, cacheKey, refreshCheckouts);
  }

  private fetchCheckoutsNetwork(
    snap: ReturnType<AuthService['snapshot']>,
    cacheKey: string,
    refreshCheckouts = false,
  ): Observable<AspenCheckout[]> {
    return from(Promise.all([
      this.preferences.getCachedToken(snap.activeAccountId!),
      this.accounts.getPassword(snap.activeAccountId!),
      this.cache.read<AspenCheckout[]>(cacheKey),
    ])).pipe(
      switchMap(([token, password, cached]) => {
        if (!token && !password) return throwError(() => new Error('missing_auth'));
        const cachedCheckouts = Array.isArray(cached) ? cached : [];

        return this.userApiQueue.run(snap.activeAccountId, () =>
          this.requestPatronCheckouts(snap, token, password, refreshCheckouts).pipe(
            switchMap((r) => {
              const checkouts = this.checkoutsFromResponse(r);
              if (!this.isSuspiciousEmptyCheckouts(checkouts, cachedCheckouts)) return from([checkouts]);

              return timer(SUSPICIOUS_EMPTY_CHECKOUTS_RETRY_DELAY_MS).pipe(
                switchMap(() => this.requestPatronCheckouts(snap, token, password, true)),
                map((retryResponse) => {
                  const retryCheckouts = this.checkoutsFromResponse(retryResponse);
                  return this.isSuspiciousEmptyCheckouts(retryCheckouts, cachedCheckouts)
                    ? cachedCheckouts
                    : retryCheckouts;
                }),
              );
            }),
            tap((list) => {
              this.cache.write(cacheKey, list).catch(() => {});
            }),
          ),
        );
      }),
    );
  }

  private requestPatronCheckouts(
    snap: ReturnType<AuthService['snapshot']>,
    token: string | null,
    password: string | null,
    refreshCheckouts = false,
  ): Observable<any> {
    let params = new HttpParams()
      .set('method', 'getPatronCheckedOutItems');
    if (refreshCheckouts) params = params.set('refreshCheckouts', 'true');

    const body = this.authBodyFor(snap, token, password);

    const headers = new HttpHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' });

    return this.http
      .post<any>(`${this.globals.aspen_api_base}/UserAPI`, body.toString(), { params, headers })
      .pipe(
        map(raw => raw?.result ?? raw),
        tap((result) => this.persistReturnedHelperToken(snap, result)),
      );
  }

  private checkoutsFromResponse(r: any): AspenCheckout[] {
    if (!r?.success) return [];
    const list = Array.isArray(r?.checkedOutItems) ? (r.checkedOutItems as AspenCheckout[]) : [];
    return list
      .filter((c) => c?.type === 'ils' || c?.source === 'ils')
      .map((checkout) => this.normalizeCheckout(checkout));
  }

  private isSuspiciousEmptyCheckouts(checkouts: AspenCheckout[], cachedCheckouts: AspenCheckout[]): boolean {
    return checkouts.length === 0 && cachedCheckouts.length >= SUSPICIOUS_EMPTY_CHECKOUTS_CACHE_THRESHOLD;
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
    const barcode = this.pickItemBarcode(checkout);

    if (!barcode) return throwError(() => new Error('missing_barcode'));

    const params: Record<string, string> = {
      itemSource: this.pickItemSource(checkout),
      itemBarcode: barcode,
    };
    if (recordId) params['recordId'] = recordId;

    return this.callUserApiMutation('renewItem', params, { includeSessionId: false, includeUserId: true });
  }

  // ---------- Core mutation plumbing (same pattern as HoldsService) ----------

  private callUserApiMutation(
    method: string,
    extraParams: Record<string, string>,
    options?: { includeSessionId?: boolean; includeUserId?: boolean },
  ): Observable<AspenMutationResult> {
    const snap = this.auth.snapshot();
    if (!snap.isLoggedIn || !snap.activeAccountId || !snap.activeAccountMeta) {
      return throwError(() => new Error('not_logged_in'));
    }

    const userId = this.pickPatronId(snap.profile);

    return from(Promise.all([
      this.preferences.getCachedToken(snap.activeAccountId),
      this.accounts.getPassword(snap.activeAccountId),
    ])).pipe(
      switchMap(([token, password]) => {
        if (!token && !password) return throwError(() => new Error('missing_auth'));

        return from(this.getOrCreateSessionId()).pipe(
          switchMap(sessionId => {
            let params = new HttpParams()
              .set('method', method)
              .set('userApiBackend', 'helper');

            const includeSessionId = options?.includeSessionId !== false;
            const includeUserId = options?.includeUserId !== false;
            if (includeSessionId) params = params.set('sessionId', sessionId);
            if (includeUserId && userId) params = params.set('userId', String(userId));

            for (const [k, v] of Object.entries(extraParams)) {
              params = params.set(k, (v ?? '').toString());
            }

            const body = this.authBodyFor(snap, token, password);

            const headers = new HttpHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' });

            return this.userApiQueue.run(snap.activeAccountId, () =>
              this.http.post<any>(`${this.globals.aspen_api_base}/UserAPI`, body.toString(), { params, headers })
                .pipe(
                  map(raw => raw?.result ?? raw),
                  tap((r) => this.persistReturnedHelperToken(snap, r)),
                  map((r: any) => {
                    const success = r?.success !== undefined ? !!r.success : true;
                    return {
                      success,
                      title: typeof r?.title === 'string' ? r.title : undefined,
                      message: typeof r?.message === 'string' ? r.message : (typeof r?.renewMessage === 'string' ? r.renewMessage : undefined),
                      raw: r,
                    } satisfies AspenMutationResult;
                  }),
                ),
            );
          }),
        );
      }),
    );
  }

  private authBodyFor(
    snap: ReturnType<AuthService['snapshot']>,
    token: string | null,
    password: string | null,
  ): URLSearchParams {
    const body = new URLSearchParams();
    if (token) body.set('token', token);
    body.set('username', snap.activeAccountMeta!.username);
    if (password) body.set('password', password);
    return body;
  }

  private persistReturnedHelperToken(snap: ReturnType<AuthService['snapshot']>, result: any): void {
    const token = (result?.helperToken ?? result?.token ?? '').toString().trim();
    if (!token || !snap.activeAccountId) return;
    this.preferences.persistTokenForAccount(snap.activeAccountId, token).catch(() => {});
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

  private normalizeCheckout(checkout: AspenCheckout): AspenCheckout {
    const raw: any = checkout ?? {};
    return {
      id: Number(raw?.id ?? raw?.itemId ?? 0) || 0,
      type: (raw?.type ?? 'ils').toString(),
      source: (raw?.source ?? 'ils').toString(),
      userId: this.numberOrUndefined(raw?.userId),
      sourceId: this.numberOrUndefined(raw?.sourceId),
      recordId: this.numberOrUndefined(raw?.recordId),
      groupedWorkId: this.stringOrUndefined(raw?.groupedWorkId),
      title: this.stringOrUndefined(raw?.title),
      author: this.stringOrUndefined(raw?.author),
      coverUrl: this.discoveryUrls.normalize(raw?.coverUrl),
      linkUrl: this.stringOrUndefined(raw?.linkUrl),
      format: this.compactFormat(raw?.format) as any,
      itemId: this.numberOrUndefined(raw?.itemId),
      itemIndex: this.numberOrUndefined(raw?.itemIndex) ?? null,
      barcode: this.stringOrUndefined(raw?.barcode),
      checkoutDate: this.numberOrUndefined(raw?.checkoutDate),
      dueDate: this.numberOrUndefined(raw?.dueDate),
      renewalDate: this.stringOrUndefined(raw?.renewalDate),
      canRenew: this.boolOrUndefined(raw?.canRenew),
      canrenew: this.boolOrUndefined(raw?.canrenew),
      renewCount: this.numberOrUndefined(raw?.renewCount) ?? null,
      maxRenewals: this.numberOrUndefined(raw?.maxRenewals) ?? null,
      renewError: this.stringOrUndefined(raw?.renewError) ?? null,
      renewMessage: this.stringOrUndefined(raw?.renewMessage),
      overdue: this.boolOrUndefined(raw?.overdue),
      daysUntilDue: this.numberOrUndefined(raw?.daysUntilDue),
    };
  }

  // ---------- Small helpers ----------

  private stringOrUndefined(value: any): string | undefined {
    const text = (value ?? '').toString().trim();
    return text || undefined;
  }

  private numberOrUndefined(value: any): number | undefined {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }

  private boolOrUndefined(value: any): boolean | undefined {
    if (value === true || value === false) return value;
    const text = (value ?? '').toString().trim().toLowerCase();
    if (['true', '1', 'yes'].includes(text)) return true;
    if (['false', '0', 'no'].includes(text)) return false;
    return undefined;
  }

  private compactFormat(value: any): string | string[] | undefined {
    if (Array.isArray(value)) {
      const items = value.map((item) => this.stringOrUndefined(item)).filter((item): item is string => !!item);
      return items.length ? items : undefined;
    }
    return this.stringOrUndefined(value);
  }

  private pickPatronId(profile: any): number | null {
    const n = Number(profile?.id);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  private pickRecordId(checkout: AspenCheckout): string | null {
    const candidates = [
      (checkout as any)?.recordId,
      (checkout as any)?.id,
      (checkout as any)?.sourceId,
    ];
    for (const v of candidates) {
      const s = (v ?? '').toString().trim();
      if (s) return s;
    }
    return null;
  }

  private pickItemBarcode(checkout: AspenCheckout): string {
    const candidates = [
      (checkout as any)?.itemId,
      (checkout as any)?.barcode,
      (checkout as any)?.id,
    ];
    for (const v of candidates) {
      const s = (v ?? '').toString().trim();
      if (s) return s;
    }
    return '';
  }

  private pickItemSource(checkout: AspenCheckout): string {
    const s = ((checkout as any)?.source ?? (checkout as any)?.type ?? 'ils').toString().trim();
    return s || 'ils';
  }
}
