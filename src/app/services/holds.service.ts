// src/app/services/holds.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, map, switchMap, from, throwError, concat, filter, tap, finalize, shareReplay, timer } from 'rxjs';

import { Globals } from '../globals';
import { AuthService } from './auth.service';
import { AccountStoreService } from './account-store.service';
import { AppCacheService } from './app-cache.service';
import { DiscoveryUrlService } from './discovery-url.service';
import { UserApiQueueService } from './user-api-queue.service';
import { AccountPreferencesService } from './account-preferences.service';

export interface AspenHold {
  id: number; // transactionId-ish
  type: string; // "ils"
  source: string; // "ils"
  recordId?: number;
  groupedWorkId?: string;

  title?: string;
  author?: string;
  coverUrl?: string;
  linkUrl?: string;

  available?: boolean;
  frozen?: boolean;
  status?: string;
  statusMessage?: string;

  position?: number;
  holdQueueLength?: number;
  create?: number;
  createTime?: number;
  availableDate?: number;
  availableTime?: number;
  expirationDate?: number;
  expire?: number;

  pickupLocationId?: string;
  pickupLocationName?: string;

  cancelable?: boolean;
  cancelId?: number;

  canFreeze?: boolean;
  freezable?: boolean;
  allowFreezeHolds?: string;

  [k: string]: any;
}

export interface PatronHoldsResponse {
  success: boolean;
  holds: {
    available: Record<string, AspenHold> | AspenHold[];
    unavailable: Record<string, AspenHold> | AspenHold[];
  };
  sortMethods?: any;
}

export interface AspenMutationResult {
  success: boolean;
  title?: string;
  message?: string;
  raw?: any;
}

const PREF_HOLDS_CACHE_PREFIX = 'accounts:holds:'; // + accountId
const SUSPICIOUS_EMPTY_HOLDS_CACHE_THRESHOLD = 10;
const SUSPICIOUS_EMPTY_HOLDS_RETRY_DELAY_MS = 750;
const HOLD_MUTATION_VERIFY_DELAY_MS = 3500;
const HELPER_BACKED_HOLD_MUTATION_METHODS = new Set([
  'freezeHold',
  'activateHold',
  'changeHoldPickUpLocation',
]);

@Injectable({ providedIn: 'root' })
export class HoldsService {
  private activeFetch$: Observable<AspenHold[]> | null = null;

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

  // ---------- Cache ----------

  async getCachedHolds(accountId: string): Promise<{ holds: AspenHold[] } | null> {
    const holds = await this.cache.read<AspenHold[]>(PREF_HOLDS_CACHE_PREFIX + accountId);
    if (!Array.isArray(holds)) return null;
    return { holds };
  }

  async setCachedHolds(accountId: string, holds: AspenHold[]): Promise<void> {
    await this.cache.write(PREF_HOLDS_CACHE_PREFIX + accountId, (holds ?? []).map((hold) => this.normalizeHold(hold)));
  }

  // ---------- Fetch holds ----------

  /**
   * POST /API/UserAPI?method=getPatronHolds
   * Body: username/password (x-www-form-urlencoded)
   */
  fetchActiveHolds(): Observable<AspenHold[]> {
    const snap = this.auth.snapshot();
    if (!snap.isLoggedIn || !snap.activeAccountId || !snap.activeAccountMeta) {
      return from([[]]);
    }

    const cacheKey = PREF_HOLDS_CACHE_PREFIX + snap.activeAccountId;
    const cached$ = from(this.cache.read<AspenHold[]>(cacheKey)).pipe(
      filter((v): v is AspenHold[] => Array.isArray(v)),
    );

    const network$ = this.activeFetch$ ?? this.fetchHoldsNetwork(snap, cacheKey).pipe(
      finalize(() => {
        this.activeFetch$ = null;
      }),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    this.activeFetch$ = network$;

    return concat(cached$, network$);
  }

  fetchFreshActiveHolds(refreshHolds = true): Observable<AspenHold[]> {
    const snap = this.auth.snapshot();
    if (!snap.isLoggedIn || !snap.activeAccountId || !snap.activeAccountMeta) {
      return from([[]]);
    }

    const cacheKey = PREF_HOLDS_CACHE_PREFIX + snap.activeAccountId;
    return this.fetchHoldsNetwork(snap, cacheKey, refreshHolds);
  }

  async removeCachedHold(hold: AspenHold): Promise<void> {
    const cacheKey = this.activeHoldsCacheKey();
    if (!cacheKey) return;

    const existing = await this.cache.read<AspenHold[]>(cacheKey);
    const current = Array.isArray(existing) ? existing : [];
    const next = current.filter((candidate) => !this.holdMatches(candidate, hold));
    await this.cache.write(cacheKey, next.map((hold) => this.normalizeHold(hold)));
  }

  async upsertCachedHold(hold: AspenHold): Promise<void> {
    const cacheKey = this.activeHoldsCacheKey();
    if (!cacheKey) return;

    const existing = await this.cache.read<AspenHold[]>(cacheKey);
    const current = Array.isArray(existing) ? existing : [];
    let matched = false;
    const next = current.map((candidate) => {
      if (!this.holdMatches(candidate, hold)) return candidate;
      matched = true;
      return this.normalizeHold({ ...(candidate as any), ...(hold as any) } as AspenHold);
    });

    if (!matched) next.unshift(this.normalizeHold(hold));
    await this.cache.write(cacheKey, next.map((candidate) => this.normalizeHold(candidate)));
  }

  private normalizeHoldCollection(input: any): AspenHold[] {
    if (!input) return [];
    if (Array.isArray(input)) return input as AspenHold[];

    if (typeof input === 'object') {
      return Object.values(input) as AspenHold[];
    }

    return [];
  }

  private normalizeHold(hold: AspenHold): AspenHold {
    const raw: any = hold ?? {};
    return {
      id: Number(raw?.id ?? raw?.cancelId ?? 0) || 0,
      type: (raw?.type ?? 'ils').toString(),
      source: (raw?.source ?? 'ils').toString(),
      recordId: Number(raw?.recordId ?? 0) || undefined,
      groupedWorkId: this.stringOrUndefined(raw?.groupedWorkId),
      title: this.stringOrUndefined(raw?.title),
      author: this.stringOrUndefined(raw?.author),
      coverUrl: this.discoveryUrls.normalize(raw?.coverUrl),
      linkUrl: this.stringOrUndefined(raw?.linkUrl),
      available: this.boolOrUndefined(raw?.available),
      frozen: this.boolOrUndefined(raw?.frozen),
      status: this.stringOrUndefined(raw?.status),
      statusMessage: this.stringOrUndefined(raw?.statusMessage),
      position: this.numberOrUndefined(raw?.position),
      holdQueueLength: this.numberOrUndefined(raw?.holdQueueLength),
      create: this.numberOrUndefined(raw?.create),
      createTime: this.numberOrUndefined(raw?.createTime),
      availableDate: this.numberOrUndefined(raw?.availableDate),
      availableTime: this.numberOrUndefined(raw?.availableTime),
      pickupLocationId: this.stringOrUndefined(raw?.pickupLocationId),
      pickupLocationName: this.stringOrUndefined(raw?.pickupLocationName),
      currentPickupId: this.stringOrUndefined(raw?.currentPickupId),
      currentPickupName: this.stringOrUndefined(raw?.currentPickupName),
      cancelable: this.boolOrUndefined(raw?.cancelable),
      cancelId: this.numberOrUndefined(raw?.cancelId),
      canFreeze: this.boolOrUndefined(raw?.canFreeze),
      freezable: this.boolOrUndefined(raw?.freezable),
      allowFreezeHolds: this.stringOrUndefined(raw?.allowFreezeHolds),
      expirationDate: this.numberOrUndefined(raw?.expirationDate),
      expire: this.numberOrUndefined(raw?.expire),
      format: this.compactFormat(raw?.format),
    };
  }

  // ---------- Place hold (ILS item hold) ----------

  /**
   * Place an item-level hold for the active user.
   * Aspen/LiDA does this by calling UserAPI "placeHold" with holdType=item.
   */
  placeHold(recordId: string, pickupBranch: string, sublocation: string | null): Observable<AspenMutationResult> {
    const rid = (recordId ?? '').toString().trim();
    const pb = (pickupBranch ?? '').toString().trim();
    if (!rid) return throwError(() => new Error('missing_record_id'));
    if (!pb) return throwError(() => new Error('missing_pickup_branch'));

    return this.callUserApiMutation('placeHold', {
      itemSource: 'ils',
      pickupBranch: pb,
      sublocation: (sublocation ?? '').toString(),
      holdType: 'item',
      recordId: rid,
      useHoldNotificationPreferences: 'true',
    });
  }

  // ---------- Hold actions ----------

  /**
   * Freeze (suspend) a hold.
   *
   * IMPORTANT: This now preserves “indefinite” freezes by only sending
   * reactivationDate when the caller supplies a date.
   */
  freezeHold(hold: AspenHold, selectedReactivationDate?: Date | string | null): Observable<AspenMutationResult> {
    const holdId = this.pickHoldIdForFreeze(hold);
    if (!holdId) return throwError(() => new Error('missing_hold_id'));
    const recordId = this.pickRecordId(hold);
    if (!recordId) return throwError(() => new Error('missing_record_id'));

    // Explicitly-typed payload so TS allows payload.reactivationDate
    const payload: {
      holdId: string;
      recordId: string;
      itemSource: string;
      reactivationDate?: string;
    } = {
      holdId: String(holdId),
      recordId: String(recordId),
      itemSource: this.pickItemSource(hold),
    };

    const reactivationDate = this.computeReactivationDate(selectedReactivationDate);
    if (reactivationDate) {
      payload.reactivationDate = reactivationDate;
    }

    return this.callUserApiMutation('freezeHold', payload);
  }

  /**
   * Explicit helper for an indefinite freeze.
   * (No reactivationDate param will be sent.)
   */
  freezeHoldIndefinitely(hold: AspenHold): Observable<AspenMutationResult> {
    return this.freezeHold(hold, null);
  }

  thawHold(hold: AspenHold): Observable<AspenMutationResult> {
    const holdId = this.pickHoldIdForFreeze(hold);
    if (!holdId) return throwError(() => new Error('missing_hold_id'));
    const recordId = this.pickRecordId(hold);
    if (!recordId) return throwError(() => new Error('missing_record_id'));

    return this.callUserApiMutation('activateHold', {
      holdId: String(holdId),
      recordId: String(recordId),
      itemSource: this.pickItemSource(hold),
    });
  }

  verifyHoldFrozenStateAfterDelay(
    hold: AspenHold,
    expectedFrozen: boolean,
    delayMs = HOLD_MUTATION_VERIFY_DELAY_MS,
  ): Observable<AspenHold | null> {
    return timer(delayMs).pipe(
      switchMap(() => this.fetchFreshActiveHolds(true)),
      map((holds) => {
        const match = this.findMatchingHold(holds ?? [], hold);
        if (!match) return null;
        return this.holdLooksFrozen(match) === expectedFrozen ? match : null;
      }),
    );
  }

  cancelHold(hold: AspenHold): Observable<AspenMutationResult> {
    const cancelId = this.pickCancelId(hold);
    if (!cancelId) return throwError(() => new Error('missing_cancel_id'));
    const recordId = this.pickRecordId(hold);
    if (!recordId) return throwError(() => new Error('missing_record_id'));

    return this.callUserApiMutation('cancelHold', {
      cancelId: String(cancelId),
      recordId: String(recordId),
      itemSource: this.pickItemSource(hold),
    });
  }

  /**
   * Change pickup location.
   *
   * Aspen expects `newLocation` in the form "<locationId>_<pickupBranchCode>" (e.g. "2_TADL-EBB")
   * and your build validates `pickupBranch`, which must be the code portion (e.g. "TADL-EBB").
   */
  changeHoldPickUpLocation(
    holdId: number,
    newLocation: string,
    newSublocation: string | null,
  ): Observable<AspenMutationResult> {
    if (!holdId) return throwError(() => new Error('missing_hold_id'));
    const loc = (newLocation ?? '').trim();
    if (!loc) return throwError(() => new Error('missing_new_location'));

    const sub = (newSublocation ?? '').toString();

    // Accept either "TADL-EBB" or "2_TADL-EBB"
    const pickupBranch = this.extractPickupBranchCode(loc);

    return this.callUserApiMutation('changeHoldPickUpLocation', {
      holdId: String(holdId),

      // required by Aspen:
      newLocation: loc,
      newSublocation: sub,

      // required by your build's validatePickupBranch():
      pickupBranch,

      // compatibility aliases (harmless if ignored):
      sublocation: sub,
      newPickupBranch: pickupBranch,
    });
  }

  private extractPickupBranchCode(newLocation: string): string {
    const s = (newLocation ?? '').trim();
    const parts = s.split('_');
    if (parts.length >= 2) {
      return parts.slice(1).join('_').trim();
    }
    return s;
  }

  private fetchHoldsNetwork(
    snap: ReturnType<AuthService['snapshot']>,
    cacheKey: string,
    refreshHolds = true,
  ): Observable<AspenHold[]> {
    return from(Promise.all([
      this.preferences.getCachedToken(snap.activeAccountId!),
      this.accounts.getPassword(snap.activeAccountId!),
      this.cache.read<AspenHold[]>(cacheKey),
    ])).pipe(
      switchMap(([token, password, cached]) => {
        if (!token && !password) return throwError(() => new Error('missing_auth'));
        const cachedHolds = Array.isArray(cached) ? cached : [];

        return this.userApiQueue.run(snap.activeAccountId, () =>
          this.requestPatronHolds(snap, token, password, refreshHolds).pipe(
            switchMap((r) => {
              const holds = this.holdsFromResponse(r);
              if (!this.isSuspiciousEmptyHolds(holds, cachedHolds)) return from([holds]);

              return timer(SUSPICIOUS_EMPTY_HOLDS_RETRY_DELAY_MS).pipe(
                switchMap(() => this.requestPatronHolds(snap, token, password, true)),
                map((retryResponse) => {
                  const retryHolds = this.holdsFromResponse(retryResponse);
                  return this.isSuspiciousEmptyHolds(retryHolds, cachedHolds) ? cachedHolds : retryHolds;
                }),
              );
            }),
            tap((holds) => {
              this.cache.write(cacheKey, holds).catch(() => {});
            }),
          ),
        );
      }),
    );
  }

  private requestPatronHolds(
    snap: ReturnType<AuthService['snapshot']>,
    token: string | null,
    password: string | null,
    refreshHolds = true,
  ): Observable<PatronHoldsResponse> {
    let params = new HttpParams()
      .set('method', 'getPatronHolds');
    if (refreshHolds) params = params.set('refreshHolds', 'true');

    const body = this.authBodyFor(snap, token, password);

    const headers = new HttpHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' });

    return this.http
      .post<any>(`${this.globals.aspen_api_base}/UserAPI`, body.toString(), { params, headers })
      .pipe(
        map(raw => (raw?.result ?? raw) as PatronHoldsResponse),
        tap((result) => this.persistReturnedHelperToken(snap, result)),
      );
  }

  private holdsFromResponse(r: PatronHoldsResponse): AspenHold[] {
    if (!r?.success) return [];
    const all = [
      ...this.normalizeHoldCollection(r?.holds?.available),
      ...this.normalizeHoldCollection(r?.holds?.unavailable),
    ];
    return all
      .filter(h => (h?.type === 'ils' || h?.source === 'ils'))
      .map((hold) => this.normalizeHold(hold));
  }

  private isSuspiciousEmptyHolds(holds: AspenHold[], cachedHolds: AspenHold[]): boolean {
    return holds.length === 0 && cachedHolds.length >= SUSPICIOUS_EMPTY_HOLDS_CACHE_THRESHOLD;
  }

  private findMatchingHold(holds: AspenHold[], target: AspenHold): AspenHold | null {
    const targetKeys = this.holdMatchKeys(target);
    return (holds ?? []).find((hold) => {
      const keys = this.holdMatchKeys(hold);
      return keys.some((key) => targetKeys.includes(key));
    }) ?? null;
  }

  private holdMatchKeys(hold: AspenHold): string[] {
    const keys = [
      (hold as any)?.cancelId ? `cancel:${(hold as any).cancelId}` : '',
      (hold as any)?.id ? `id:${(hold as any).id}` : '',
      (hold as any)?.recordId ? `record:${(hold as any).recordId}` : '',
      (hold as any)?.groupedWorkId ? `grouped:${(hold as any).groupedWorkId}` : '',
    ];
    return keys.map((key) => key.toString().trim()).filter(Boolean);
  }

  private holdLooksFrozen(hold: AspenHold): boolean {
    if ((hold as any)?.frozen === true) return true;
    const status = `${hold?.statusMessage ?? ''} ${hold?.status ?? ''}`.toLowerCase();
    return status.includes('frozen') || status.includes('suspend') || status.includes('suspended');
  }

  // ---------- Core mutation plumbing ----------

  private callUserApiMutation(method: string, extraParams: Record<string, string>): Observable<AspenMutationResult> {
    const snap = this.auth.snapshot();
    if (!snap.isLoggedIn || !snap.activeAccountId || !snap.activeAccountMeta) {
      return throwError(() => new Error('not_logged_in'));
    }

    return from(Promise.all([
      this.preferences.getCachedToken(snap.activeAccountId),
      this.accounts.getPassword(snap.activeAccountId),
    ])).pipe(
      switchMap(([token, password]) => {
        if (!token && !password) return throwError(() => new Error('missing_auth'));

        let params = new HttpParams()
          .set('method', method);
        if (HELPER_BACKED_HOLD_MUTATION_METHODS.has(method)) {
          params = params.set('userApiBackend', 'helper');
        }
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
                  message: typeof r?.message === 'string' ? r.message : undefined,
                  raw: r,
                } satisfies AspenMutationResult;
              }),
            ),
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

  private pickRecordId(hold: AspenHold): number | null {
    const n = Number((hold as any)?.recordId);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  private pickItemSource(hold: AspenHold): string {
    const s = ((hold as any)?.source ?? (hold as any)?.type ?? 'ils').toString().trim();
    return s || 'ils';
  }

  private pickCancelId(hold: AspenHold): number | null {
    const n = Number((hold as any)?.cancelId ?? (hold as any)?.id);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  private pickHoldIdForFreeze(hold: AspenHold): number | null {
    const n = Number((hold as any)?.cancelId ?? (hold as any)?.id);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  private activeHoldsCacheKey(): string | null {
    const snap = this.auth.snapshot();
    const accountId = (snap.activeAccountId ?? '').toString().trim();
    return accountId ? PREF_HOLDS_CACHE_PREFIX + accountId : null;
  }

  private holdMatches(a: AspenHold | null | undefined, b: AspenHold | null | undefined): boolean {
    if (!a || !b) return false;
    const aCancelId = this.pickCancelId(a);
    const bCancelId = this.pickCancelId(b);
    if (aCancelId && bCancelId) return aCancelId === bCancelId;

    const aId = this.pickHoldIdForFreeze(a);
    const bId = this.pickHoldIdForFreeze(b);
    if (aId && bId) return aId === bId;

    const aRecordId = this.pickRecordId(a);
    const bRecordId = this.pickRecordId(b);
    const aGrouped = ((a as any)?.groupedWorkId ?? '').toString().trim();
    const bGrouped = ((b as any)?.groupedWorkId ?? '').toString().trim();
    return !!aRecordId && !!bRecordId && aRecordId === bRecordId && !!aGrouped && aGrouped === bGrouped;
  }

  /**
   * If selected is null/undefined => return null so we OMIT reactivationDate.
   * If selected is provided => return YYYY-MM-DD.
   */
  private computeReactivationDate(selected: Date | string | null | undefined): string | null {
    if (selected === null || selected === undefined) return null;

    let d: Date | null = null;
    if (selected instanceof Date) d = selected;
    else if (typeof selected === 'string' && selected.trim()) {
      const parsed = new Date(selected);
      if (!Number.isNaN(parsed.getTime())) d = parsed;
    }

    if (!d) return null;

    return this.formatYmd(d);
  }

  private formatYmd(dt: Date): string {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}
