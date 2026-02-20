// src/app/services/auth.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, from, switchMap, map, tap, throwError } from 'rxjs';

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
  refreshActiveProfile(): Observable<AuthState> {
    const snap = this.snapshot();
    if (!snap.activeAccountMeta || !snap.activeAccountId) {
      return from([snap]);
    }

    return from(this.accounts.getPassword(snap.activeAccountId)).pipe(
      switchMap(password => {
        if (!password) return from([snap]);

        return this.patron.getPatronProfile(snap.activeAccountMeta!.username, password).pipe(
          switchMap(res => {
            if (!res.success || !res.profile) return from([snap]);

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
        );
      }),
    );
  }
}
