import { TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ActionSheetController, AlertController, ModalController, type ActionSheetButton } from '@ionic/angular/lazy';
import { BehaviorSubject, Subject, of } from 'rxjs';

import { Globals } from '../../globals';
import { AuthService, type AuthState } from '../../services/auth.service';
import { CheckoutsService } from '../../services/checkouts.service';
import { DiscoveryUrlService } from '../../services/discovery-url.service';
import { HoldsService } from '../../services/holds.service';
import { HoldSupportService } from '../../services/hold-support.service';
import { ItemService } from '../../services/item.service';
import { ListLookupService, type ListLookupResult } from '../../services/list-lookup.service';
import { ListsService, type AspenListMutationResult, type AspenUserList } from '../../services/lists.service';
import { ToastService } from '../../services/toast.service';
import { ItemDetailComponent } from './item-detail.component';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}

describe('Item detail reading-list actions', () => {
  let component: ItemDetailComponent;
  let auth: BehaviorSubject<AuthState>;
  let lists: jasmine.SpyObj<ListsService>;
  let lookup: jasmine.SpyObj<ListLookupService>;
  let sheets: jasmine.SpyObj<ActionSheetController>;
  let toast: jasmine.Spy;
  let createResponse: Subject<AspenListMutationResult>;
  let addResponse: Subject<AspenListMutationResult>;
  let basics: jasmine.Spy;
  let visibility: jasmine.Spy;
  const listA = { id: '301', title: 'Example A list' };
  const listB = { id: '302', title: 'Example B list' };

  beforeEach(fakeAsync(() => {
    auth = new BehaviorSubject(account('synthetic-a'));
    createResponse = new Subject();
    addResponse = new Subject();
    lists = jasmine.createSpyObj<ListsService>('ListsService', ['createList', 'addTitlesToList', 'removeTitlesFromList', 'fetchUserLists']);
    lists.createList.and.returnValue(createResponse);
    lists.addTitlesToList.and.returnValue(addResponse);
    lists.fetchUserLists.and.returnValue(of([]));
    lookup = jasmine.createSpyObj<ListLookupService>('ListLookupService', [
      'lookup', 'membershipsForRecord', 'cachedMembershipsForRecord', 'replaceLists', 'upsertMembership', 'removeMembership',
    ]);
    lookup.lookup.and.resolveTo(result([]));
    lookup.membershipsForRecord.and.resolveTo([]);
    lookup.cachedMembershipsForRecord.and.returnValue([]);
    sheets = jasmine.createSpyObj<ActionSheetController>('ActionSheetController', ['create']);
    sheets.create.and.resolveTo(jasmine.createSpyObj<HTMLIonActionSheetElement>('Sheet', ['present', 'dismiss']));
    toast = jasmine.createSpy('presentToast');
    TestBed.configureTestingModule({ providers: [
      { provide: AuthService, useValue: { snapshot: () => auth.value, authState: () => auth.asObservable() } },
      { provide: ListsService, useValue: lists },
      { provide: ListLookupService, useValue: lookup },
      { provide: Globals, useValue: {} },
      { provide: ToastService, useValue: { presentToast: toast } },
      { provide: Router, useValue: {} },
      { provide: ModalController, useValue: { dismiss: async () => true } },
      { provide: ActionSheetController, useValue: sheets },
      { provide: AlertController, useValue: {} },
      { provide: DiscoveryUrlService, useValue: { normalize: (url: string) => url } },
      { provide: HoldsService, useValue: { fetchActiveHolds: () => of([]) } },
      { provide: CheckoutsService, useValue: { fetchActiveCheckouts: () => of([]) } },
      { provide: HoldSupportService, useValue: {} },
      { provide: ItemService, useValue: { getGroupedWork: () => of({ id: 'synthetic-work', title: 'Example title', formats: {} }) } },
    ] });
    component = TestBed.runInInjectionContext(() => new ItemDetailComponent());
    component.hit = { key: 'synthetic-work', title: 'Example title', itemList: [], raw: {} };
    component.ngOnInit();
    flushMicrotasks();
    const dialogs = component as unknown as {
      promptListBasics(): Promise<{ title: string; description: string } | null>;
      promptVisibility(): Promise<boolean | null>;
    };
    basics = spyOn(dialogs, 'promptListBasics').and.resolveTo({ title: 'Example A list', description: '' });
    visibility = spyOn(dialogs, 'promptVisibility').and.resolveTo(false);
  }));

  afterEach(() => component.ngOnDestroy());

  it('creates a new list and then adds the title instead of blocking its own addition', fakeAsync(() => {
    void component.addToAnyList();
    flushMicrotasks();
    expect(component.listActionBusy).toBeTrue();
    createResponse.next({ success: true, listId: '301' });
    createResponse.complete();
    flushMicrotasks();
    expect(lists.addTitlesToList).toHaveBeenCalledOnceWith('301', ['synthetic-work']);
    expect(component.listActionBusy).toBeTrue();
    addResponse.next({ success: true });
    addResponse.complete();
    expect(component.listActionBusy).toBeFalse();
    expect(lookup.upsertMembership).toHaveBeenCalledOnceWith('synthetic-work', '301', 'Example A list');
    expect(component.knownListMemberships).toEqual([{ listId: '301', listTitle: 'Example A list' }]);
  }));

  it('does not offer creation when loading existing lists fails', fakeAsync(() => {
    lookup.lookup.and.rejectWith(new Error('Synthetic lookup failure'));
    void component.addToAnyList();
    flushMicrotasks();
    expect(basics).not.toHaveBeenCalled();
    expect(lists.createList).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledOnceWith('Could not load your lists.');
  }));

  it('discards a delayed list lookup and clears memberships after an account change', fakeAsync(() => {
    const pending = deferred<ListLookupResult>();
    lookup.lookup.and.returnValue(pending.promise);
    component.knownListMemberships = [{ listId: '301', listTitle: 'Example A list' }];
    void component.addToAnyList();
    flushMicrotasks();
    lookup.lookup.and.resolveTo(result([listB]));
    auth.next(account('synthetic-b'));
    flushMicrotasks();
    pending.resolve(result([listA]));
    flushMicrotasks();
    expect(component.availableLists).toEqual([listB]);
    expect(component.knownListMemberships).toEqual([]);
    expect(sheets.create).not.toHaveBeenCalled();
    expect(lists.addTitlesToList).not.toHaveBeenCalled();
  }));

  it('rejects a picker from an earlier session even when the same account is active again', fakeAsync(() => {
    lookup.lookup.and.resolveTo(result([listA, listB]));
    void component.addToAnyList();
    flushMicrotasks();
    const button = sheets.create.calls.mostRecent().args[0]?.buttons?.[0] as ActionSheetButton;
    auth.next(account('synthetic-b'));
    auth.next(account('synthetic-a'));
    button.handler?.();
    flushMicrotasks();
    expect(lists.addTitlesToList).not.toHaveBeenCalled();
  }));

  it('does not let a stale addition alter the new account membership cache or busy state', fakeAsync(() => {
    lookup.lookup.and.resolveTo(result([listA]));
    void component.addToAnyList();
    flushMicrotasks();
    const newer = new Subject<AspenListMutationResult>();
    lists.addTitlesToList.and.returnValue(newer);
    lookup.lookup.and.resolveTo(result([listB]));
    auth.next(account('synthetic-b'));
    flushMicrotasks();
    void component.addToAnyList();
    flushMicrotasks();
    addResponse.next({ success: true });
    addResponse.complete();
    expect(lookup.upsertMembership).not.toHaveBeenCalled();
    expect(component.listActionBusy).toBeTrue();
    newer.next({ success: true });
    newer.complete();
    expect(lookup.upsertMembership).toHaveBeenCalledOnceWith('synthetic-work', '302', 'Example B list');
    expect(component.listActionBusy).toBeFalse();
  }));

  it('stops before adding when the account changes while creation is pending', fakeAsync(() => {
    void component.addToAnyList();
    flushMicrotasks();
    auth.next(account('synthetic-b'));
    createResponse.next({ success: true, listId: '301' });
    createResponse.complete();
    flushMicrotasks();
    expect(lists.addTitlesToList).not.toHaveBeenCalled();
    expect(lookup.replaceLists).not.toHaveBeenCalled();
  }));

  it('stops after closing the item while a list lookup is pending', fakeAsync(() => {
    const pending = deferred<ListLookupResult>();
    lookup.lookup.and.returnValue(pending.promise);
    void component.addToAnyList();
    flushMicrotasks();
    component.close();
    pending.resolve(result([]));
    flushMicrotasks();
    expect(basics).not.toHaveBeenCalled();
    expect(lists.createList).not.toHaveBeenCalled();
  }));

  function account(id: string): AuthState {
    return { isLoggedIn: true, activeAccountId: id, activeAccountMeta: { id, username: id, label: 'Example patron' }, profile: {} };
  }

  function result(userLists: AspenUserList[]): ListLookupResult {
    return { lists: userLists, membershipsByRecordId: {}, lastListUsed: null, membershipIndexUpdatedAt: null };
  }
});
