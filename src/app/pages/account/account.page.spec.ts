import { TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ActionSheetController, ModalController } from '@ionic/angular/lazy';

import { Globals } from '../../globals';
import { AccountStoreService } from '../../services/account-store.service';
import { AuthService, type AuthState } from '../../services/auth.service';
import { ListLookupService } from '../../services/list-lookup.service';
import { PatronService } from '../../services/patron.service';
import { ToastService } from '../../services/toast.service';
import { AccountPage } from './account.page';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}

describe('Account list-count request identity', () => {
  let active: AuthState;
  let revision: number;
  let lookup: jasmine.SpyObj<ListLookupService>;
  let page: AccountPage;

  function switchAccount(id: string, count = 0) {
    revision += 1;
    active = { isLoggedIn: true, activeAccountId: id,
      activeAccountMeta: { id, username: `synthetic-${id}`, label: 'Example patron' }, profile: { numLists: count } };
  }

  beforeEach(() => {
    revision = 0;
    switchAccount('account-a', 2);
    lookup = jasmine.createSpyObj<ListLookupService>('ListLookupService', ['cachedListCount']);
    TestBed.configureTestingModule({ providers: [
      { provide: Globals, useValue: {} },
      { provide: AuthService, useValue: {
        snapshot: () => active,
        captureActiveProfileSession: () => active.isLoggedIn && active.activeAccountId
          ? { accountId: active.activeAccountId, revision } : null,
      } },
      { provide: AccountStoreService, useValue: {} },
      { provide: ListLookupService, useValue: lookup },
      { provide: PatronService, useValue: {} },
      { provide: ToastService, useValue: {} },
      { provide: Router, useValue: {} },
      { provide: ActionSheetController, useValue: {} },
      { provide: ModalController, useValue: {} },
    ] });
    page = TestBed.runInInjectionContext(() => new AccountPage());
  });

  it('does not overwrite a new account count with an older account response', fakeAsync(() => {
    const first = deferred<number | null>();
    const second = deferred<number | null>();
    lookup.cachedListCount.and.returnValues(first.promise, second.promise);
    void page['refreshMyListsCount']();
    switchAccount('account-b', 9);
    void page['refreshMyListsCount']();
    second.resolve(9);
    flushMicrotasks();
    first.resolve(2);
    flushMicrotasks();
    expect(page.myListsCount).toBe(9);
  }));

  it('keeps the newest request within the same session', fakeAsync(() => {
    const first = deferred<number | null>();
    const second = deferred<number | null>();
    lookup.cachedListCount.and.returnValues(first.promise, second.promise);
    void page['refreshMyListsCount']();
    void page['refreshMyListsCount']();
    second.resolve(9);
    flushMicrotasks();
    first.resolve(2);
    flushMicrotasks();
    expect(page.myListsCount).toBe(9);
  }));

  it('does not restore a previous count after logout', fakeAsync(() => {
    const pending = deferred<number | null>();
    lookup.cachedListCount.and.returnValue(pending.promise);
    void page['refreshMyListsCount']();
    active = { isLoggedIn: false, activeAccountId: null, activeAccountMeta: null, profile: null };
    revision += 1;
    void page['refreshMyListsCount']();
    pending.resolve(4);
    flushMicrotasks();
    expect(page.myListsCount).toBe(0);
  }));

  it('ignores a previous session even when the same account becomes active again', fakeAsync(() => {
    const pending = deferred<number | null>();
    lookup.cachedListCount.and.returnValue(pending.promise);
    void page['refreshMyListsCount']();
    switchAccount('account-b');
    switchAccount('account-a');
    page.myListsCount = 7;
    pending.resolve(2);
    flushMicrotasks();
    expect(page.myListsCount).toBe(7);
  }));

  it('uses the current profile count when no cached count exists', fakeAsync(() => {
    lookup.cachedListCount.and.resolveTo(null);
    void page['refreshMyListsCount']();
    flushMicrotasks();
    expect(page.myListsCount).toBe(2);
  }));
});
