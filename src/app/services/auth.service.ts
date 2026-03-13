// src/app/services/auth.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, from, switchMap, map, tap, throwError, catchError, of } from 'rxjs';

import { AccountStoreService, StoredAccountMeta } from './account-store.service';
import { PatronService } from './patron.service';

export interface AuthState {
  isLoggedIn: boolean;
  activeAccountId: string | null;
  activeAccountMeta: StoredAccountMeta | null;
  profile: any | null; // raw Aspen profile
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly profileRefreshThrottleMs = 5 * 60 * 1000;
  private lastProfileRefreshAt = 0;
  private lastProfileRefreshAccountId: string | null = null;

  private state$ = new BehaviorSubject<AuthState>({
    isLoggedIn: false,
    activeAccountId: null,
    activeAccountMeta: null,
    profile: null,
  });

  constructor(
    private accounts: AccountStoreService,
    private patron: PatronService,
  ) {}

  authState(): Observable<AuthState> {
    return this.state$.asObservable();
  }

  snapshot(): AuthState {
    return this.state$.value;
  }

  applyActiveProfile(profile: any): void {
    const snap = this.state$.value;
    if (!snap.activeAccountId || !snap.activeAccountMeta) return;
    this.state$.next({
      ...snap,
      isLoggedIn: true,
      profile,
    });
  }

  adjustActiveProfileCounts(delta: {
    holds?: number;
    holdsReady?: number;
    holdsRequested?: number;
    checkouts?: number;
  }): void {
    const snap = this.state$.value;
    if (!snap.activeAccountId || !snap.activeAccountMeta || !snap.profile || !delta) return;

    const nextProfile: any = { ...snap.profile };

    const applyDelta = (keys: string[], amount?: number) => {
      const n = Number(amount ?? 0);
      if (!Number.isFinite(n) || n === 0) return;

      for (const key of keys) {
        if (!(key in nextProfile)) continue;
        const current = Number(nextProfile[key]);
        const base = Number.isFinite(current) ? current : 0;
        nextProfile[key] = Math.max(0, base + n);
      }
    };

    applyDelta(['numHolds', 'numHoldsIls', 'holds'], delta.holds);
    applyDelta(['numHoldsAvailable', 'numHoldsAvailableIls', 'holds_ready'], delta.holdsReady);
    applyDelta(['numHoldsRequested', 'numHoldsRequestedIls'], delta.holdsRequested);
    applyDelta(['numCheckedOut', 'numCheckedOutIls', 'checkouts'], delta.checkouts);

    this.state$.next({
      ...snap,
      isLoggedIn: true,
      profile: nextProfile,
    });

    this.accounts.cacheProfile(snap.activeAccountId, nextProfile).catch(() => {});
  }

  /**
   * Call on app startup (e.g., AppComponent) to restore:
   * - active account id
   * - cached profile (fast UI)
   */
  restore(): Observable<AuthState> {
    return from(this.accounts.getActiveAccountId()).pipe(
      switchMap(activeId => {
        if (!activeId) {
          const next: AuthState = { isLoggedIn: false, activeAccountId: null, activeAccountMeta: null, profile: null };
          this.state$.next(next);
          return from([next]);
        }

        return from(Promise.all([
          this.accounts.getActiveAccountMeta(),
          this.accounts.getCachedProfile(activeId),
        ])).pipe(
          map(([meta, cachedProfile]) => {
            const next: AuthState = {
              isLoggedIn: !!meta && !!cachedProfile,
              activeAccountId: activeId,
              activeAccountMeta: meta,
              profile: cachedProfile,
            };
            this.state$.next(next);
            return next;
          }),
        );
      }),
    );
  }

  /**
   * Login with raw creds (from form).
   * - validates via getPatronProfile
   * - stores account meta + password
   * - sets active account
   * - caches profile
   */
  login(username: string, password: string): Observable<AuthState> {
    const u = (username ?? '').trim();
    const p = (password ?? '').trim();
    if (!u || !p) {
      return throwError(() => new Error('missing_credentials'));
    }

    return this.patron.getPatronProfile(u, p).pipe(
      switchMap(res => {
        if (!res.success || !res.profile) {
          return throwError(() => new Error('invalid_login'));
        }

        const label = this.patron.displayNameFromProfile(res.profile);

        return from(this.accounts.upsertAccountMeta({ username: u, label })).pipe(
          switchMap(meta =>
            from(this.accounts.setPassword(meta.id, p)).pipe(
              switchMap(() => from(this.accounts.setActiveAccountId(meta.id))),
              switchMap(() => from(this.accounts.cacheProfile(meta.id, res.profile))),
              map(() => {
                const next: AuthState = {
                  isLoggedIn: true,
                  activeAccountId: meta.id,
                  activeAccountMeta: meta,
                  profile: res.profile,
                };
                this.state$.next(next);
                return next;
              }),
            ),
          ),
        );
      }),
    );
  }

  /**
   * Switch to a stored account (by id).
   * - reads password from secure storage
   * - re-validates by calling getPatronProfile
   * - sets active + caches fresh profile
   */
  switchAccount(accountId: string): Observable<AuthState> {
    return from(this.accounts.listAccounts()).pipe(
      map(list => list.find(a => a.id === accountId) ?? null),
      switchMap(meta => {
        if (!meta) return throwError(() => new Error('account_not_found'));

        return from(this.accounts.getPassword(meta.id)).pipe(
          switchMap(password => {
            if (!password) return throwError(() => new Error('missing_password'));
            return this.patron.getPatronProfile(meta.username, password).pipe(
              switchMap(res => {
                if (!res.success || !res.profile) return throwError(() => new Error('invalid_login'));

                // label might change; keep it updated
                const label = this.patron.displayNameFromProfile(res.profile);

                return from(this.accounts.upsertAccountMeta({ id: meta.id, username: meta.username, label })).pipe(
                  switchMap(updatedMeta =>
                    from(this.accounts.setActiveAccountId(updatedMeta.id)).pipe(
                      switchMap(() => from(this.accounts.cacheProfile(updatedMeta.id, res.profile))),
                      map(() => {
                        const next: AuthState = {
                          isLoggedIn: true,
                          activeAccountId: updatedMeta.id,
                          activeAccountMeta: updatedMeta,
                          profile: res.profile,
                        };
                        this.state$.next(next);
                        return next;
                      }),
                    ),
                  ),
                );
              }),
            );
          }),
        );
      }),
    );
  }

  /**
   * Logout:
   * - clears active account id
   * - keeps stored accounts + passwords by default (matches your current app)
   */
  logout(): Observable<AuthState> {
    return from(this.accounts.getActiveAccountId()).pipe(
      tap(() => {}),
      switchMap(activeId => {
        if (activeId) {
          // keep password; clear cached profile
          return from(this.accounts.clearCachedProfile(activeId)).pipe(
            switchMap(() => from(this.accounts.setActiveAccountId(null))),
          );
        }
        return from(this.accounts.setActiveAccountId(null));
      }),
      map(() => {
        const next: AuthState = { isLoggedIn: false, activeAccountId: null, activeAccountMeta: null, profile: null };
        this.state$.next(next);
        return next;
      }),
    );
  }

  /**
   * Optional helper: refresh profile for current user (update badges)
   */
  refreshActiveProfile(options?: { force?: boolean }): Observable<AuthState> {
    const snap = this.snapshot();
    if (!snap.activeAccountMeta || !snap.activeAccountId) {
      return from([snap]);
    }

    const force = options?.force === true;
    const now = Date.now();
    if (
      !force &&
      this.lastProfileRefreshAccountId === snap.activeAccountId &&
      now - this.lastProfileRefreshAt < this.profileRefreshThrottleMs
    ) {
      return from([snap]);
    }

    this.lastProfileRefreshAt = now;
    this.lastProfileRefreshAccountId = snap.activeAccountId;

    return from(this.accounts.getPassword(snap.activeAccountId)).pipe(
      switchMap(password => {
        if (!password) {
          return from(this.invalidateActiveSession(false)).pipe(
            map(() => this.snapshot()),
          );
        }

        return this.patron.getPatronProfile(snap.activeAccountMeta!.username, password).pipe(
          switchMap(res => {
            if (!res.success || !res.profile) {
              return from(this.invalidateActiveSession(true)).pipe(
                map(() => this.snapshot()),
              );
            }

            return from(this.accounts.cacheProfile(snap.activeAccountId!, res.profile)).pipe(
              map(() => {
                const next: AuthState = {
                  ...snap,
                  isLoggedIn: true,
                  profile: res.profile,
                };
                this.state$.next(next);
                return next;
              }),
            );
          }),
          catchError(() => of(snap)),
        );
      }),
    );
  }

  async updateActiveAccountUsername(username: string): Promise<void> {
    const nextUsername = (username ?? '').trim();
    const snap = this.snapshot();
    const active = snap.activeAccountMeta;
    if (!nextUsername || !active || !snap.activeAccountId) return;

    const updatedMeta = await this.accounts.upsertAccountMeta({
      id: active.id,
      username: nextUsername,
      label: active.label,
    });

    const next: AuthState = {
      ...snap,
      activeAccountMeta: updatedMeta,
      profile: snap.profile ? { ...snap.profile, username: nextUsername } : snap.profile,
    };
    this.state$.next(next);
  }

  private async invalidateActiveSession(removeStoredAccount: boolean): Promise<void> {
    const snap = this.snapshot();
    if (snap.activeAccountId) {
      if (removeStoredAccount) {
        await this.accounts.removeAccount(snap.activeAccountId);
      } else {
        await this.accounts.clearCachedProfile(snap.activeAccountId);
        await this.accounts.setActiveAccountId(null);
      }
    } else {
      await this.accounts.setActiveAccountId(null);
    }

    this.state$.next({
      isLoggedIn: false,
      activeAccountId: null,
      activeAccountMeta: null,
      profile: null,
    });
  }
}
