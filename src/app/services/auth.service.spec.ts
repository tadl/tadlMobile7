import { TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { Subject, firstValueFrom, of } from 'rxjs';
import { Preferences } from '@capacitor/preferences';

import { AccountStoreService, type StoredAccountMeta } from './account-store.service';
import { AuthService, type AuthState } from './auth.service';
import { PatronService, type AspenPatronProfileResponse } from './patron.service';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}

describe('AuthService profile refresh account isolation', () => {
  const accountA: StoredAccountMeta = { id: 'synthetic-a', username: 'alice-example', label: 'Example A' };
  const accountB: StoredAccountMeta = { id: 'synthetic-b', username: 'bob-example', label: 'Example B' };
  const profileA = { id: 101, firstname: 'Example A' };
  const profileB = { id: 202, firstname: 'Example B' };
  const updatedA = { ...profileA, numCheckedOut: 3 };
  let service: AuthService;
  let accounts: jasmine.SpyObj<AccountStoreService>;
  let patron: jasmine.SpyObj<PatronService>;
  let refresh: Subject<AspenPatronProfileResponse>;
  let storedActive: string | null;

  beforeEach(fakeAsync(() => {
    storedActive = accountA.id;
    refresh = new Subject<AspenPatronProfileResponse>();
    accounts = jasmine.createSpyObj<AccountStoreService>('AccountStoreService', [
      'getActiveAccountId', 'getActiveAccountMeta', 'getCachedProfile', 'listAccounts',
      'getPassword', 'upsertAccountMeta', 'setActiveAccountId', 'cacheProfile',
      'clearCachedProfile', 'removeAccount',
    ]);
    accounts.getActiveAccountId.and.callFake(() => Promise.resolve(storedActive));
    accounts.getActiveAccountMeta.and.resolveTo(accountA);
    accounts.getCachedProfile.and.resolveTo(profileA);
    accounts.listAccounts.and.resolveTo([accountA, accountB]);
    accounts.getPassword.and.resolveTo('synthetic-password');
    accounts.upsertAccountMeta.and.callFake(meta => Promise.resolve({ ...meta, id: meta.id || accountA.id }));
    accounts.setActiveAccountId.and.callFake(id => {
      storedActive = id;
      return Promise.resolve();
    });
    accounts.cacheProfile.and.resolveTo();
    accounts.clearCachedProfile.and.resolveTo();
    accounts.removeAccount.and.callFake(id => {
      if (storedActive === id) storedActive = null;
      return Promise.resolve();
    });
    patron = jasmine.createSpyObj<PatronService>('PatronService', ['getPatronProfile', 'displayNameFromProfile']);
    patron.getPatronProfile.and.callFake(username => username === accountA.username
      ? refresh : of({ success: true, profile: profileB }));
    patron.displayNameFromProfile.and.callFake(profile => profile.firstname);
    TestBed.configureTestingModule({ providers: [
      { provide: AccountStoreService, useValue: accounts },
      { provide: PatronService, useValue: patron },
    ] });
    service = TestBed.inject(AuthService);
    service.restore().subscribe();
    flushMicrotasks();
  }));

  function switchToB() {
    service.switchAccount(accountB.id).subscribe();
    flushMicrotasks();
    expect(service.snapshot().activeAccountId).toBe(accountB.id);
  }

  it('updates the current account normally', fakeAsync(() => {
    service.refreshActiveProfile().subscribe();
    flushMicrotasks();
    refresh.next({ success: true, profile: updatedA });
    flushMicrotasks();
    expect(service.snapshot().profile).toEqual(updatedA);
    expect(accounts.cacheProfile).toHaveBeenCalledWith(accountA.id, updatedA);
  }));

  it('invalidates only the current rejected account', fakeAsync(() => {
    service.refreshActiveProfile().subscribe();
    flushMicrotasks();
    refresh.next({ success: false });
    flushMicrotasks();
    expect(accounts.removeAccount).toHaveBeenCalledOnceWith(accountA.id, { clearActive: false });
    expect(service.snapshot().isLoggedIn).toBeFalse();
  }));

  it('does not start the old profile request after password loading outlives an account switch', fakeAsync(() => {
    const password = deferred<string | null>();
    accounts.getPassword.and.callFake(id => id === accountA.id
      ? password.promise : Promise.resolve('synthetic-password'));
    service.refreshActiveProfile().subscribe();
    switchToB();
    password.resolve(null);
    flushMicrotasks();
    expect(patron.getPatronProfile).toHaveBeenCalledOnceWith(accountB.username, 'synthetic-password', accountB.id);
    expect(accounts.clearCachedProfile).not.toHaveBeenCalled();
    expect(service.snapshot().activeAccountId).toBe(accountB.id);
  }));

  for (const success of [true, false]) {
    it(`ignores a late ${success ? 'successful' : 'rejected'} profile after switching accounts`, fakeAsync(() => {
      service.refreshActiveProfile().subscribe();
      flushMicrotasks();
      switchToB();
      refresh.next({ success, profile: success ? updatedA : undefined });
      flushMicrotasks();
      expect(service.snapshot().activeAccountId).toBe(accountB.id);
      expect(service.snapshot().profile).toEqual(profileB);
      expect(accounts.cacheProfile).not.toHaveBeenCalledWith(accountA.id, updatedA);
      expect(accounts.removeAccount).not.toHaveBeenCalled();
    }));
  }

  it('returns the current account when a stale refresh has a transport error', fakeAsync(() => {
    let received: AuthState | undefined;
    service.refreshActiveProfile().subscribe(state => { received = state; });
    flushMicrotasks();
    switchToB();
    refresh.error(new Error('Synthetic network failure'));
    expect(received?.activeAccountId).toBe(accountB.id);
    expect(service.snapshot().activeAccountId).toBe(accountB.id);
  }));

  it('does not reactivate the old account after its cache write completes', fakeAsync(() => {
    const saved = deferred<void>();
    accounts.cacheProfile.and.callFake(id => id === accountA.id ? saved.promise : Promise.resolve());
    service.refreshActiveProfile().subscribe();
    flushMicrotasks();
    refresh.next({ success: true, profile: updatedA });
    switchToB();
    saved.resolve();
    flushMicrotasks();
    expect(service.snapshot().activeAccountId).toBe(accountB.id);
    expect(service.snapshot().profile).toEqual(profileB);
  }));

  it('honors logout intent before logout storage has completed', fakeAsync(() => {
    const active = deferred<string | null>();
    service.refreshActiveProfile().subscribe();
    flushMicrotasks();
    accounts.getActiveAccountId.and.returnValue(active.promise);
    service.logout().subscribe();
    refresh.next({ success: true, profile: updatedA });
    flushMicrotasks();
    expect(accounts.cacheProfile).not.toHaveBeenCalled();
    active.resolve(accountA.id);
    flushMicrotasks();
    expect(service.snapshot().isLoggedIn).toBeFalse();
    expect(service.snapshot().activeAccountId).toBeNull();
  }));

  it('does not clear the new account when an old account removal completes late', fakeAsync(() => {
    const removed = deferred<void>();
    accounts.removeAccount.and.returnValue(removed.promise);
    service.refreshActiveProfile().subscribe();
    flushMicrotasks();
    refresh.next({ success: false });
    expect(accounts.removeAccount).toHaveBeenCalledOnceWith(accountA.id, { clearActive: false });
    switchToB();
    removed.resolve();
    flushMicrotasks();
    expect(service.snapshot().activeAccountId).toBe(accountB.id);
    expect(storedActive).toBe(accountB.id);
    expect(accounts.setActiveAccountId).not.toHaveBeenCalledWith(null);
  }));

  it('does not clear the new active account after an old missing-password cache cleanup', fakeAsync(() => {
    const cleared = deferred<void>();
    accounts.getPassword.and.callFake(id => Promise.resolve(id === accountA.id ? null : 'synthetic-password'));
    accounts.clearCachedProfile.and.returnValue(cleared.promise);
    service.refreshActiveProfile().subscribe();
    flushMicrotasks();
    expect(accounts.clearCachedProfile).toHaveBeenCalledOnceWith(accountA.id);
    switchToB();
    cleared.resolve();
    flushMicrotasks();
    expect(service.snapshot().activeAccountId).toBe(accountB.id);
    expect(accounts.setActiveAccountId).not.toHaveBeenCalledWith(null);
  }));

  it('disables the actual store removal active-clearing side effect during a stale refresh', async () => {
    const removedPassword = deferred<void>();
    const passwordRemovalStarted = deferred<void>();
    const actualStore = new AccountStoreService();
    spyOn(Preferences, 'set').and.resolveTo();
    spyOn(actualStore, 'listAccounts').and.resolveTo([accountA, accountB]);
    spyOn(actualStore, 'deletePassword').and.callFake(() => {
      passwordRemovalStarted.resolve();
      return removedPassword.promise;
    });
    const readActive = spyOn(actualStore, 'getActiveAccountId').and.callFake(() => Promise.resolve(storedActive));
    const clearActive = spyOn(actualStore, 'setActiveAccountId').and.callFake(id => {
      storedActive = id;
      return Promise.resolve();
    });
    spyOn(actualStore, 'clearCachedProfile').and.resolveTo();
    accounts.removeAccount.and.callFake((id, options) => actualStore.removeAccount(id, options));

    const refreshed = firstValueFrom(service.refreshActiveProfile());
    await Promise.resolve();
    refresh.next({ success: false });
    await passwordRemovalStarted.promise;
    expect(actualStore.deletePassword).toHaveBeenCalledOnceWith(accountA.id);
    await firstValueFrom(service.switchAccount(accountB.id));
    removedPassword.resolve();
    await refreshed;

    expect(readActive).not.toHaveBeenCalled();
    expect(clearActive).not.toHaveBeenCalled();
    expect(storedActive).toBe(accountB.id);
    expect(service.snapshot().activeAccountId).toBe(accountB.id);
  });

  it('preserves active-account clearing for an explicit account removal', async () => {
    const actualStore = new AccountStoreService();
    spyOn(Preferences, 'set').and.resolveTo();
    spyOn(actualStore, 'listAccounts').and.resolveTo([accountA, accountB]);
    spyOn(actualStore, 'deletePassword').and.resolveTo();
    spyOn(actualStore, 'getActiveAccountId').and.resolveTo(accountA.id);
    const clearActive = spyOn(actualStore, 'setActiveAccountId').and.resolveTo();
    spyOn(actualStore, 'clearCachedProfile').and.resolveTo();
    await actualStore.removeAccount(accountA.id);
    expect(clearActive).toHaveBeenCalledOnceWith(null);
  });
});
