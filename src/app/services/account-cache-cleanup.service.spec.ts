import { TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { of } from 'rxjs';

import { AccountCacheCleanupService } from './account-cache-cleanup.service';
import { AccountStoreService, type StoredAccountMeta } from './account-store.service';
import { AppCacheService } from './app-cache.service';
import { AuthService } from './auth.service';
import { ListLookupService } from './list-lookup.service';
import { PatronService } from './patron.service';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}

describe('Account profile cleanup ordering', () => {
  const accountA: StoredAccountMeta = { id: 'synthetic-a', username: 'alice-example', label: 'Example A' };
  const accountB: StoredAccountMeta = { id: 'synthetic-b', username: 'bob-example', label: 'Example B' };
  const profileA = { id: 101, firstname: 'Example A', numCheckedOut: 1 };
  const profileB = { id: 202, firstname: 'Example B' };
  const freshA = { ...profileA, numCheckedOut: 3 };
  let accounts: jasmine.SpyObj<AccountStoreService>;
  let cache: jasmine.SpyObj<AppCacheService>;
  let lookup: jasmine.SpyObj<ListLookupService>;
  let auth: AuthService;
  let cleanup: AccountCacheCleanupService;
  let profiles: Map<string, unknown>;
  let storedActive: string | null;

  beforeEach(fakeAsync(() => {
    storedActive = accountB.id;
    profiles = new Map<string, unknown>([[accountA.id, profileA], [accountB.id, profileB]]);
    accounts = jasmine.createSpyObj<AccountStoreService>('AccountStoreService', [
      'getActiveAccountId', 'getActiveAccountMeta', 'getCachedProfile', 'getPassword',
      'upsertAccountMeta', 'setPassword', 'setActiveAccountId', 'cacheProfile', 'clearCachedProfile',
    ]);
    accounts.getActiveAccountId.and.callFake(async () => storedActive);
    accounts.getActiveAccountMeta.and.resolveTo(accountB);
    accounts.getCachedProfile.and.callFake(async id => profiles.get(id));
    accounts.getPassword.and.resolveTo('synthetic-password');
    accounts.upsertAccountMeta.and.resolveTo(accountA);
    accounts.setPassword.and.resolveTo();
    accounts.setActiveAccountId.and.callFake(async id => { storedActive = id; });
    accounts.cacheProfile.and.callFake(async (id, profile) => { profiles.set(id, profile); });
    accounts.clearCachedProfile.and.callFake(async id => { profiles.delete(id); });
    const patron = jasmine.createSpyObj<PatronService>('PatronService', ['getPatronProfile', 'displayNameFromProfile']);
    patron.getPatronProfile.and.returnValue(of({ success: true, profile: freshA }));
    patron.displayNameFromProfile.and.returnValue('Example A');
    cache = jasmine.createSpyObj<AppCacheService>('AppCacheService', ['removeByPrefixes']);
    cache.removeByPrefixes.and.resolveTo();
    lookup = jasmine.createSpyObj<ListLookupService>('ListLookupService', ['clearAccountState']);
    TestBed.configureTestingModule({ providers: [
      { provide: AccountStoreService, useValue: accounts },
      { provide: PatronService, useValue: patron },
      { provide: AppCacheService, useValue: cache },
      { provide: ListLookupService, useValue: lookup },
    ] });
    auth = TestBed.inject(AuthService);
    cleanup = TestBed.inject(AccountCacheCleanupService);
    auth.restore().subscribe();
    flushMicrotasks();
  }));

  it('finishes inactive-account cleanup before a new login persists that same account profile', fakeAsync(() => {
    const cleared = deferred<void>();
    accounts.clearCachedProfile.and.callFake(async id => {
      await cleared.promise;
      profiles.delete(id);
    });
    let cleanupFinished = false;
    void cleanup.clearForAccount(accountA.id).then(() => { cleanupFinished = true; });
    flushMicrotasks();
    expect(accounts.clearCachedProfile).toHaveBeenCalledOnceWith(accountA.id);
    auth.login(accountA.username, 'synthetic-password').subscribe();
    flushMicrotasks();
    expect(auth.snapshot().activeAccountId).toBe(accountB.id);
    cleared.resolve();
    flushMicrotasks();
    expect(cleanupFinished).toBeTrue();
    expect(auth.snapshot().activeAccountId).toBe(accountA.id);
    expect(auth.snapshot().profile).toEqual(freshA);
    expect(storedActive).toBe(accountA.id);
    expect(profiles.get(accountA.id)).toEqual(freshA);
    expect(lookup.clearAccountState).toHaveBeenCalledOnceWith(accountA.id);
  }));

  it('skips profile deletion if the account is active again when cleanup reaches the queue', fakeAsync(() => {
    void cleanup.clearForAccount(accountB.id);
    flushMicrotasks();
    expect(accounts.clearCachedProfile).not.toHaveBeenCalled();
    expect(profiles.get(accountB.id)).toEqual(profileB);
    expect(cache.removeByPrefixes).toHaveBeenCalledOnceWith(jasmine.arrayContaining([
      `accounts:holds:${accountB.id}`, `checkouts:${accountB.id}`, `history:${accountB.id}:`,
    ]));
    expect(lookup.clearAccountState).toHaveBeenCalledOnceWith(accountB.id);
  }));
});
