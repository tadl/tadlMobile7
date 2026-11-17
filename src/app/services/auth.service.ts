// src/app/services/auth.service.ts
import { Injectable, inject } from '@angular/core';
import {
  BehaviorSubject,
  Observable,
  from,
  switchMap,
  map,
  throwError,
  catchError,
  of,
  EMPTY,
  defer,
  filter,
} from 'rxjs';

import {
  AccountStoreService,
  StoredAccountMeta,
} from './account-store.service';
import { PatronService } from './patron.service';

export interface AuthState {
  isLoggedIn: boolean;
  activeAccountId: string | null;
  activeAccountMeta: StoredAccountMeta | null;
  profile: any | null; // raw Aspen profile
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private accounts = inject(AccountStoreService);
  private patron = inject(PatronService);

  private readonly profileRefreshThrottleMs = 5 * 60 * 1000;
  private lastProfileRefreshAt = 0;
  private lastProfileRefreshAccountId: string | null = null;
  private sessionRevision = 0;
  private sessionStorageTail: Promise<void> = Promise.resolve();

  private state$ = new BehaviorSubject<AuthState>({
    isLoggedIn: false,
    activeAccountId: null,
    activeAccountMeta: null,
    profile: null,
  });

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
    if (
      !snap.activeAccountId ||
      !snap.activeAccountMeta ||
      !snap.profile ||
      !delta
    )
      return;

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
    applyDelta(
      ['numHoldsAvailable', 'numHoldsAvailableIls', 'holds_ready'],
      delta.holdsReady
    );
    applyDelta(
      ['numHoldsRequested', 'numHoldsRequestedIls'],
      delta.holdsRequested
    );
    applyDelta(
      ['numCheckedOut', 'numCheckedOutIls', 'checkouts'],
      delta.checkouts
    );

    this.state$.next({
      ...snap,
      isLoggedIn: true,
      profile: nextProfile,
    });

    const revision = this.sessionRevision;
    void this.queueSessionStorage(async () => {
      if (this.isCurrentSession(snap.activeAccountId!, revision)) {
        await this.accounts.cacheProfile(snap.activeAccountId!, nextProfile);
      }
    }).catch(() => {});
  }

  /**
   * Call on app startup (e.g., AppComponent) to restore:
   * - active account id
   * - cached profile (fast UI)
   */
  restore(): Observable<AuthState> {
    const revision = this.sessionRevision;
    return this.sessionResult(revision, () => this.queueSessionStorage(async () => {
      if (!this.isCurrentIntent(revision)) return null;
      const activeId = await this.accounts.getActiveAccountId();
      if (!this.isCurrentIntent(revision)) return null;
      if (!activeId) return this.publishLoggedOut();

      const [meta, cachedProfile] = await Promise.all([
        this.accounts.getActiveAccountMeta(),
        this.accounts.getCachedProfile(activeId),
      ]);
      if (!this.isCurrentIntent(revision)) return null;
      const next: AuthState = {
        isLoggedIn: !!meta && !!cachedProfile,
        activeAccountId: activeId,
        activeAccountMeta: meta,
        profile: cachedProfile,
      };
      this.state$.next(next);
      return next;
    }));
  }

  /** Validate credentials, then commit only the latest session intent. */
  login(username: string, password: string): Observable<AuthState> {
    const u = (username ?? '').trim();
    const p = (password ?? '').trim();
    if (!u || !p) return throwError(() => new Error('missing_credentials'));
    const revision = ++this.sessionRevision;

    return defer(() => this.isCurrentIntent(revision)
      ? this.patron.getPatronProfile(u, p) : EMPTY).pipe(
      switchMap((res) => {
        if (!this.isCurrentIntent(revision)) return EMPTY;
        if (!res.success || !res.profile) return throwError(() => new Error('invalid_login'));
        return this.activateAccount(revision, {
          username: u, label: this.patron.displayNameFromProfile(res.profile),
        }, res.profile, p);
      }),
      catchError(error => this.isCurrentIntent(revision) ? throwError(() => error) : EMPTY),
    );
  }

  /** Revalidate a saved account without allowing an older switch to win. */
  switchAccount(accountId: string): Observable<AuthState> {
    const revision = ++this.sessionRevision;
    return defer(() => from(this.queueSessionStorage(async () => {
      if (!this.isCurrentIntent(revision)) return null;
      return this.accounts.listAccounts();
    }))).pipe(
      switchMap((list) => {
        if (!this.isCurrentIntent(revision)) return EMPTY;
        const meta = list?.find(account => account.id === accountId);
        if (!meta) return throwError(() => new Error('account_not_found'));
        return from(this.accounts.getPassword(meta.id)).pipe(
          switchMap((password) => {
            if (!this.isCurrentIntent(revision)) return EMPTY;
            if (!password) return throwError(() => new Error('missing_password'));
            return this.patron.getPatronProfile(meta.username, password, meta.id).pipe(
              switchMap((res) => {
                if (!this.isCurrentIntent(revision)) return EMPTY;
                if (!res.success || !res.profile) return throwError(() => new Error('invalid_login'));
                return this.activateAccount(revision, {
                  id: meta.id, username: meta.username,
                  label: this.patron.displayNameFromProfile(res.profile),
                }, res.profile);
              }),
            );
          }),
        );
      }),
      catchError(error => this.isCurrentIntent(revision) ? throwError(() => error) : EMPTY),
    );
  }

  /** Clear the active session, retaining saved accounts and passwords. */
  logout(options?: { removeStoredAccount?: boolean }): Observable<AuthState> {
    const revision = ++this.sessionRevision;
    return this.sessionResult(revision, () => this.queueSessionStorage(async () => {
      if (!this.isCurrentIntent(revision)) return null;
      const activeId = await this.accounts.getActiveAccountId();
      if (!this.isCurrentIntent(revision)) return null;
      if (activeId) {
        if (options?.removeStoredAccount) {
          await this.accounts.removeAccount(activeId, { clearActive: false });
        } else {
          await this.accounts.clearCachedProfile(activeId);
        }
      }
      if (!this.isCurrentIntent(revision)) return null;
      await this.accounts.setActiveAccountId(null);
      return this.isCurrentIntent(revision) ? this.publishLoggedOut() : null;
    }));
  }

  private activateAccount(
    revision: number,
    identity: Omit<StoredAccountMeta, 'id'> & { id?: string },
    profile: any,
    password?: string,
  ): Observable<AuthState> {
    return this.sessionResult(revision, () => this.queueSessionStorage(async () => {
      if (!this.isCurrentIntent(revision)) return null;
      const meta = await this.accounts.upsertAccountMeta(identity);
      if (!this.isCurrentIntent(revision)) return null;
      if (password !== undefined) await this.accounts.setPassword(meta.id, password);
      if (!this.isCurrentIntent(revision)) return null;
      await this.accounts.cacheProfile(meta.id, profile);
      if (!this.isCurrentIntent(revision)) return null;
      await this.accounts.setActiveAccountId(meta.id);
      if (!this.isCurrentIntent(revision)) return null;
      const next: AuthState = {
        isLoggedIn: true, activeAccountId: meta.id,
        activeAccountMeta: meta, profile,
      };
      this.state$.next(next);
      return next;
    }));
  }

  private sessionResult(
    revision: number,
    operation: () => Promise<AuthState | null>,
  ): Observable<AuthState> {
    return defer(() => from(operation())).pipe(
      filter((state): state is AuthState => state !== null && this.isCurrentIntent(revision)),
      catchError(error => this.isCurrentIntent(revision) ? throwError(() => error) : EMPTY),
    );
  }

  private queueSessionStorage<T>(operation: () => Promise<T>): Promise<T> {
    // An already-started storage write cannot be cancelled. Order later commits
    // after it so stale writes cannot become the final persisted session.
    const result = this.sessionStorageTail.then(operation);
    this.sessionStorageTail = result.then(() => {}, () => {});
    return result;
  }

  private isCurrentIntent(revision: number): boolean {
    return this.sessionRevision === revision;
  }

  private publishLoggedOut(): AuthState {
    const next: AuthState = {
      isLoggedIn: false, activeAccountId: null, activeAccountMeta: null, profile: null,
    };
    this.state$.next(next);
    return next;
  }

  /**
   * Optional helper: refresh profile for current user (update badges)
   */
  refreshActiveProfile(options?: { force?: boolean }): Observable<AuthState> {
    const snap = this.snapshot();
    if (!snap.activeAccountMeta || !snap.activeAccountId) {
      return from([snap]);
    }
    const accountId = snap.activeAccountId;
    const revision = this.sessionRevision;

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
      switchMap((password) => {
        if (!this.isCurrentSession(accountId, revision)) return of(this.snapshot());
        if (!password) {
          return from(this.invalidateActiveSession(accountId, revision, false)).pipe(
            map(() => this.snapshot())
          );
        }

        return this.patron
          .getPatronProfile(
            snap.activeAccountMeta!.username,
            password,
            snap.activeAccountId
          )
          .pipe(
            switchMap((res) => {
              if (!this.isCurrentSession(accountId, revision)) return of(this.snapshot());
              if (!res.success || !res.profile) {
                return from(this.invalidateActiveSession(accountId, revision, true)).pipe(
                  map(() => this.snapshot())
                );
              }

              return from(this.queueSessionStorage(async () => {
                if (!this.isCurrentSession(accountId, revision)) return this.snapshot();
                await this.accounts.cacheProfile(accountId, res.profile);
                if (!this.isCurrentSession(accountId, revision)) return this.snapshot();
                const next: AuthState = {
                  ...this.snapshot(), isLoggedIn: true, profile: res.profile,
                };
                this.state$.next(next);
                return next;
              }));
            }),
            catchError(() => of(this.snapshot()))
          );
      })
    );
  }

  async updateActiveAccountUsername(username: string): Promise<void> {
    const nextUsername = (username ?? '').trim();
    const snap = this.snapshot();
    const active = snap.activeAccountMeta;
    const revision = this.sessionRevision;
    if (!nextUsername || !active || !snap.activeAccountId) return;

    await this.queueSessionStorage(async () => {
      if (!this.isCurrentSession(active.id, revision)) return;
      const updatedMeta = await this.accounts.upsertAccountMeta({
        id: active.id, username: nextUsername, label: active.label,
      });
      if (!this.isCurrentSession(active.id, revision)) return;
      const current = this.snapshot();
      this.state$.next({
        ...current, activeAccountMeta: updatedMeta,
        profile: current.profile ? { ...current.profile, username: nextUsername } : current.profile,
      });
    });
  }

  private isCurrentSession(accountId: string, revision: number): boolean {
    return this.sessionRevision === revision && this.snapshot().activeAccountId === accountId;
  }

  private async invalidateActiveSession(
    accountId: string,
    revision: number,
    removeStoredAccount: boolean
  ): Promise<void> {
    await this.queueSessionStorage(async () => {
      if (!this.isCurrentSession(accountId, revision)) return;
      if (removeStoredAccount) {
        await this.accounts.removeAccount(accountId, { clearActive: false });
      } else {
        await this.accounts.clearCachedProfile(accountId);
      }
      if (!this.isCurrentSession(accountId, revision)) return;
      await this.accounts.setActiveAccountId(null);
      if (!this.isCurrentSession(accountId, revision)) return;
      this.publishLoggedOut();
    });
  }
}
