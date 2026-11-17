import { TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { ActionSheetController, AlertController, ModalController, type ActionSheetButton } from '@ionic/angular/lazy';
import { Subject, of } from 'rxjs';

import { Globals } from '../../globals';
import { AuthService, type ActiveProfileSession } from '../../services/auth.service';
import { FormatFamilyService } from '../../services/format-family.service';
import { HoldSupportService } from '../../services/hold-support.service';
import { HoldsService } from '../../services/holds.service';
import { ListLookupService, type ListLookupResult } from '../../services/list-lookup.service';
import { ListsService, type AspenListMutationResult, type AspenUserList } from '../../services/lists.service';
import { SearchService, type AspenSearchHit } from '../../services/search.service';
import { ToastService } from '../../services/toast.service';
import { SearchPage } from './search.page';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}

describe('Search reading-list actions', () => {
  const hit: AspenSearchHit = { key: 'synthetic-work', title: 'Example title', itemList: [], raw: {} };
  const createdList: AspenUserList = { id: '301', title: 'Example list' };
  let page: SearchPage;
  let session: ActiveProfileSession;
  let lists: jasmine.SpyObj<ListsService>;
  let lookup: jasmine.SpyObj<ListLookupService>;
  let sheets: jasmine.SpyObj<ActionSheetController>;
  let toast: jasmine.Spy;
  let createResponse: Subject<AspenListMutationResult>;
  let addResponse: Subject<AspenListMutationResult>;
  let basics: jasmine.Spy;
  let visibility: jasmine.Spy;
  let holds: jasmine.SpyObj<HoldsService>;
  let holdSupport: jasmine.SpyObj<HoldSupportService>;

  beforeEach(() => {
    session = { accountId: 'synthetic-a', revision: 1 };
    createResponse = new Subject();
    addResponse = new Subject();
    lists = jasmine.createSpyObj<ListsService>('ListsService', ['createList', 'addTitlesToList']);
    lists.createList.and.returnValue(createResponse);
    lists.addTitlesToList.and.returnValue(addResponse);
    lookup = jasmine.createSpyObj<ListLookupService>('ListLookupService', [
      'lookup', 'replaceLists', 'upsertMembership', 'cachedMembershipsForRecord',
    ]);
    lookup.lookup.and.resolveTo(lookupResult([]));
    lookup.cachedMembershipsForRecord.and.returnValue([]);
    sheets = jasmine.createSpyObj<ActionSheetController>('ActionSheetController', ['create']);
    sheets.create.and.resolveTo(jasmine.createSpyObj<HTMLIonActionSheetElement>('Sheet', ['present', 'remove']));
    toast = jasmine.createSpy('presentToast');
    holds = jasmine.createSpyObj<HoldsService>('HoldsService', ['placeHold']);
    holds.placeHold.and.returnValue(of({ success: false }));
    holdSupport = jasmine.createSpyObj<HoldSupportService>('HoldSupportService', ['defaultPickupBranchCode']);
    holdSupport.defaultPickupBranchCode.and.resolveTo('example-main');
    TestBed.configureTestingModule({ providers: [
      { provide: Globals, useValue: { pickupLocations: [{ name: 'Example Main', code: 'example-main' }] } },
      { provide: AuthService, useValue: {
        captureActiveProfileSession: () => session,
        snapshot: () => ({ isLoggedIn: true, activeAccountId: session.accountId, activeAccountMeta: {} }),
      } },
      { provide: ListsService, useValue: lists },
      { provide: ListLookupService, useValue: lookup },
      { provide: SearchService, useValue: {} },
      { provide: ToastService, useValue: { presentToast: toast } },
      { provide: ActivatedRoute, useValue: {} },
      { provide: Router, useValue: {} },
      { provide: ModalController, useValue: {} },
      { provide: ActionSheetController, useValue: sheets },
      { provide: AlertController, useValue: {} },
      { provide: FormatFamilyService, useValue: { hasPhysicalHoldableFormat: () => true } },
      { provide: HoldsService, useValue: holds },
      { provide: HoldSupportService, useValue: holdSupport },
    ] });
    page = TestBed.runInInjectionContext(() => new SearchPage());
    const dialogs = page as unknown as {
      promptListBasics(): Promise<{ title: string; description: string } | null>;
      promptVisibility(): Promise<boolean | null>;
    };
    basics = spyOn(dialogs, 'promptListBasics').and.resolveTo({ title: 'Example list', description: '' });
    visibility = spyOn(dialogs, 'promptVisibility').and.resolveTo(false);
  });

  it('creates the first list and adds the selected title while keeping the row busy through both requests', fakeAsync(() => {
    start();
    expect(page.rowActionBusy(hit)).toBeTrue();
    finishCreate();
    expect(lists.addTitlesToList).toHaveBeenCalledOnceWith('301', ['synthetic-work']);
    expect(page.rowActionBusy(hit)).toBeTrue();
    expect(lookup.upsertMembership).not.toHaveBeenCalled();
    addResponse.next({ success: true });
    addResponse.complete();
    expect(page.rowActionBusy(hit)).toBeFalse();
    expect(lookup.upsertMembership).toHaveBeenCalledOnceWith('synthetic-work', '301', 'Example list');
    expect(toast).toHaveBeenCalledOnceWith('Added to list.');
  }));

  it('stops before adding when list creation fails', fakeAsync(() => {
    start();
    createResponse.error(new Error('Synthetic create failure'));
    expect(lists.addTitlesToList).not.toHaveBeenCalled();
    expect(lookup.replaceLists).not.toHaveBeenCalled();
    expect(lookup.upsertMembership).not.toHaveBeenCalled();
    expect(page.rowActionBusy(hit)).toBeFalse();
    expect(toast).toHaveBeenCalledOnceWith('Could not create list.');
  }));

  for (const transportError of [true, false]) {
    it(`reports a created list with an unsuccessful addition after ${transportError ? 'a network' : 'an API'} failure`, fakeAsync(() => {
      start();
      finishCreate();
      if (transportError) addResponse.error(new Error('Synthetic add failure'));
      else { addResponse.next({ success: false }); addResponse.complete(); }
      expect(lookup.replaceLists).toHaveBeenCalledOnceWith([jasmine.objectContaining({ id: '301' })]);
      expect(lookup.upsertMembership).not.toHaveBeenCalled();
      expect(page.rowActionBusy(hit)).toBeFalse();
      expect(toast).toHaveBeenCalledOnceWith('List created, but could not add this title. Please try again.');
    }));
  }

  it('discards a delayed lookup after switching away and back to the same account', fakeAsync(() => {
    const pending = deferred<ListLookupResult>();
    lookup.lookup.and.returnValue(pending.promise);
    void page['addHitToList'](hit);
    session = { accountId: 'synthetic-a', revision: 3 };
    pending.resolve(lookupResult([createdList]));
    flushMicrotasks();
    expect(lists.createList).not.toHaveBeenCalled();
    expect(lists.addTitlesToList).not.toHaveBeenCalled();
    expect(basics).not.toHaveBeenCalled();
  }));

  for (const stage of ['basics', 'visibility']) {
    it(`does not create a list after the account changes during the ${stage} prompt`, fakeAsync(() => {
      if (stage === 'basics') {
        const pending = deferred<{ title: string; description: string }>();
        basics.and.returnValue(pending.promise);
        start();
        session = { accountId: 'synthetic-b', revision: 2 };
        pending.resolve({ title: 'Example list', description: '' });
      } else {
        const pending = deferred<boolean>();
        visibility.and.returnValue(pending.promise);
        start();
        session = { accountId: 'synthetic-b', revision: 2 };
        pending.resolve(false);
      }
      flushMicrotasks();
      expect(lists.createList).not.toHaveBeenCalled();
      expect(lists.addTitlesToList).not.toHaveBeenCalled();
    }));
  }

  it('does not add an item after its pending create response belongs to an older session', fakeAsync(() => {
    start();
    session = { accountId: 'synthetic-b', revision: 2 };
    finishCreate();
    expect(lists.addTitlesToList).not.toHaveBeenCalled();
    expect(lookup.replaceLists).not.toHaveBeenCalled();
    expect(page.rowActionBusy(hit)).toBeFalse();
    expect(toast).not.toHaveBeenCalled();
  }));

  it('ignores a delayed existing-list picker handler after the account changes', fakeAsync(() => {
    lookup.lookup.and.resolveTo(lookupResult([createdList, { id: '302', title: 'Other example list' }]));
    start();
    const button = sheets.create.calls.mostRecent().args[0]!.buttons![0] as ActionSheetButton;
    session = { accountId: 'synthetic-b', revision: 2 };
    button.handler?.();
    expect(lists.addTitlesToList).not.toHaveBeenCalled();
  }));

  for (const createFirst of [true, false]) {
    it(`does not update another session after a delayed ${createFirst ? 'new' : 'existing'} list addition`, fakeAsync(() => {
      if (!createFirst) lookup.lookup.and.resolveTo(lookupResult([createdList]));
      start();
      if (createFirst) finishCreate();
      session = { accountId: 'synthetic-a', revision: 3 };
      addResponse.next({ success: true });
      addResponse.complete();
      expect(lookup.upsertMembership).not.toHaveBeenCalled();
      expect(toast).not.toHaveBeenCalled();
      expect(page.rowActionBusy(hit)).toBeFalse();
    }));

    it(`keeps a new account's request busy when an older ${createFirst ? 'created' : 'existing'} list addition finishes`, fakeAsync(() => {
      if (!createFirst) lookup.lookup.and.resolveTo(lookupResult([createdList]));
      start();
      if (createFirst) finishCreate();
      const newer = new Subject<AspenListMutationResult>();
      lists.addTitlesToList.and.returnValue(newer);
      lookup.lookup.and.resolveTo(lookupResult([createdList]));
      session = { accountId: 'synthetic-b', revision: 2 };
      start();
      expect(lists.addTitlesToList).toHaveBeenCalledTimes(2);
      addResponse.next({ success: true });
      addResponse.complete();
      expect(page.rowActionBusy(hit)).toBeTrue();
      expect(lookup.upsertMembership).not.toHaveBeenCalled();
      newer.next({ success: true });
      newer.complete();
      expect(page.rowActionBusy(hit)).toBeFalse();
      expect(lookup.upsertMembership).toHaveBeenCalledTimes(1);
    }));
  }

  it('does not place a hold for a different account after a delayed pickup preference resolves', fakeAsync(() => {
    const pickup = deferred<string | null>();
    holdSupport.defaultPickupBranchCode.and.returnValue(pickup.promise);
    void page['placeHoldFromHit'](hit, [{ recordId: '901001', label: 'Book', formatLabel: 'Book' }]);
    flushMicrotasks();
    session = { accountId: 'synthetic-b', revision: 2 };
    pickup.resolve('example-main');
    flushMicrotasks();
    expect(holds.placeHold).not.toHaveBeenCalled();
  }));

  it('rejects an earlier account pickup picker handler', fakeAsync(() => {
    holdSupport.defaultPickupBranchCode.and.resolveTo(null);
    void page['placeHoldFromHit'](hit, [{ recordId: '901001', label: 'Book', formatLabel: 'Book' }]);
    flushMicrotasks();
    const button = sheets.create.calls.mostRecent().args[0]!.buttons![0] as ActionSheetButton;
    session = { accountId: 'synthetic-b', revision: 2 };
    button.handler?.();
    expect(holds.placeHold).not.toHaveBeenCalled();
  }));

  function lookupResult(availableLists: AspenUserList[]): ListLookupResult {
    return { lists: availableLists, membershipsByRecordId: {}, lastListUsed: null, membershipIndexUpdatedAt: null };
  }

  function start() {
    void page['addHitToList'](hit);
    flushMicrotasks();
  }

  function finishCreate() {
    createResponse.next({ success: true, listId: '301', listTitle: 'Example list' });
    createResponse.complete();
  }
});
