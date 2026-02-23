// src/app/services/holds.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, map, switchMap, from, throwError, concat, filter, tap } from 'rxjs';
import { Preferences } from '@capacitor/preferences';

import { Globals } from '../globals';
import { AuthService } from './auth.service';
import { AccountStoreService } from './account-store.service';
import { AppCacheService } from './app-cache.service';

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
const PREF_APP_SESSION_ID = 'app:aspenSessionId';

@Injectable({ providedIn: 'root' })
export class HoldsService {
  private sessionId: string | null = null;

  constructor(
    private http: HttpClient,
    private globals: Globals,
    private auth: AuthService,
    private accounts: AccountStoreService,
    private cache: AppCacheService,
  ) {}

  // ---------- Cache ----------

  async getCachedHolds(accountId: string): Promise<{ holds: AspenHold[] } | null> {
    const holds = await this.cache.read<AspenHold[]>(PREF_HOLDS_CACHE_PREFIX + accountId);
    if (!Array.isArray(holds)) return null;
    return { holds };
  }

  async setCachedHolds(accountId: string, holds: AspenHold[]): Promise<void> {
    await this.cache.write(PREF_HOLDS_CACHE_PREFIX + accountId, holds ?? []);
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

    const network$ = from(this.accounts.getPassword(snap.activeAccountId)).pipe(
      switchMap(password => {
        if (!password) return throwError(() => new Error('missing_password'));

        const params = new HttpParams().set('method', 'getPatronHolds');

        const body = new URLSearchParams();
        body.set('username', snap.activeAccountMeta!.username);
        body.set('password', password);

        const headers = new HttpHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' });

        return this.http
          .post<any>(`${this.globals.aspen_api_base}/UserAPI`, body.toString(), { params, headers })
          .pipe(
            map(raw => (raw?.result ?? raw) as PatronHoldsResponse),
            map(r => {
              if (!r?.success) return [];
              const all = [
                ...this.normalizeHoldCollection(r?.holds?.available),
                ...this.normalizeHoldCollection(r?.holds?.unavailable),
              ];
              return all.filter(h => (h?.type === 'ils' || h?.source === 'ils'));
            }),
            tap((holds) => {
              this.cache.write(cacheKey, holds).catch(() => {});
            }),
          );
      }),
    );

    return concat(cached$, network$);
  }

  private normalizeHoldCollection(input: any): AspenHold[] {
    if (!input) return [];
    if (Array.isArray(input)) return input as AspenHold[];

    if (typeof input === 'object') {
      return Object.values(input) as AspenHold[];
    }

    return [];
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

  // ---------- Core mutation plumbing ----------

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
                    message: typeof r?.message === 'string' ? r.message : undefined,
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
