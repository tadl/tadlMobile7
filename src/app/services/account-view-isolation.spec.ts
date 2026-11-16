import { TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { ActionSheetController, AlertController, ModalController } from '@ionic/angular/lazy';
import { Subject } from 'rxjs';

import { Globals } from '../globals';
import { FinesPage } from '../pages/fines/fines.page';
import { MyListDetailPage } from '../pages/my-list-detail/my-list-detail.page';
import { MyListsPage } from '../pages/my-lists/my-lists.page';
import { AuthService, type AuthState } from './auth.service';
import { FinesService, type AspenPatronFinesResponse } from './fines.service';
import { FormatFamilyService } from './format-family.service';
import { HoldsService, type AspenMutationResult } from './holds.service';
import { HoldSupportService } from './hold-support.service';
import { ListLookupService } from './list-lookup.service';
import { ListsService, type AspenListTitlesResult, type AspenUserList } from './lists.service';
import { ToastService } from './toast.service';

describe('Account view isolation', () => {
  let active: AuthState;
  let lists: jasmine.SpyObj<ListsService>;
  let fines: jasmine.SpyObj<FinesService>;
  let holds: jasmine.SpyObj<HoldsService>;
  let holdSupport: jasmine.SpyObj<HoldSupportService>;
  let adjustProfile: jasmine.Spy;

  function switchAccount(id: string) {
    active = {
      isLoggedIn: true, activeAccountId: id,
      activeAccountMeta: { id, username: `synthetic-${id}`, label: 'Example patron' }, profile: null,
    };
  }

  beforeEach(() => {
    switchAccount('account-a');
    lists = jasmine.createSpyObj<ListsService>('ListsService', ['fetchUserLists', 'fetchListTitles']);
    fines = jasmine.createSpyObj<FinesService>('FinesService', ['fetchPatronFines']);
    holds = jasmine.createSpyObj<HoldsService>('HoldsService', ['placeHold']);
    holdSupport = jasmine.createSpyObj<HoldSupportService>('HoldSupportService', ['cacheOptimisticPlacedHold']);
    holdSupport.cacheOptimisticPlacedHold.and.resolveTo();
    adjustProfile = jasmine.createSpy('adjustActiveProfileCounts');
    TestBed.configureTestingModule({ providers: [
      { provide: AuthService, useValue: { snapshot: () => active, adjustActiveProfileCounts: adjustProfile } },
      { provide: ListsService, useValue: lists },
      { provide: FinesService, useValue: fines },
      { provide: Globals, useValue: {} },
      { provide: ToastService, useValue: { presentToast: jasmine.createSpy(), presentHoldPlacedToast: jasmine.createSpy() } },
      { provide: ListLookupService, useValue: { replaceLists: jasmine.createSpy(), observeListPage: jasmine.createSpy() } },
      { provide: ActivatedRoute, useValue: { snapshot: {
        paramMap: { get: () => '301' }, queryParamMap: { get: () => 'Example list' },
      } } },
      { provide: Router, useValue: {} },
      { provide: ActionSheetController, useValue: {} },
      { provide: AlertController, useValue: {} },
      { provide: ModalController, useValue: {} },
      { provide: HoldsService, useValue: holds },
      { provide: FormatFamilyService, useValue: {} },
      { provide: HoldSupportService, useValue: holdSupport },
    ] });
  });

  it('clears prior lists on account change and ignores that account’s unfinished response', () => {
    const first = new Subject<AspenUserList[]>();
    const second = new Subject<AspenUserList[]>();
    lists.fetchUserLists.and.returnValues(first, second);
    const page = TestBed.runInInjectionContext(() => new MyListsPage());
    page.refresh();
    first.next([{ id: 301, title: 'Example account A' }]);
    switchAccount('account-b');
    page.refresh();
    expect(page.lists).toEqual([]);
    first.next([{ id: 301, title: 'Example stale account A' }]);
    second.next([{ id: 302, title: 'Example account B' }]);
    second.complete();
    expect(page.lists.map(list => list.title)).toEqual(['Example account B']);
    expect(page.loading).toBeFalse();
    expect(TestBed.inject(ListLookupService).replaceLists).not.toHaveBeenCalledWith([
      { id: 301, title: 'Example stale account A' },
    ]);
  });

  it('ignores a late list response even before the new account refresh begins', () => {
    const pending = new Subject<AspenUserList[]>();
    lists.fetchUserLists.and.returnValue(pending);
    const page = TestBed.runInInjectionContext(() => new MyListsPage());
    page.refresh();
    switchAccount('account-b');
    pending.next([{ id: 301, title: 'Example account A' }]);
    pending.complete();
    expect(page.lists).toEqual([]);
    expect(TestBed.inject(ListLookupService).replaceLists).not.toHaveBeenCalled();
  });

  it('clears the prior fine balance and does not display a late charge from that account', () => {
    const first = new Subject<AspenPatronFinesResponse>();
    const second = new Subject<AspenPatronFinesResponse>();
    fines.fetchPatronFines.and.returnValues(first, second);
    const page = TestBed.runInInjectionContext(() => new FinesPage());
    page.refresh();
    first.next({ success: true, fines: [{ reason: 'Example account A' }], totalOwed: 3 });
    switchAccount('account-b');
    page.refresh();
    expect(page.totalOwed).toBe(0);
    expect(page.fines).toEqual([]);
    first.next({ success: true, fines: [{ reason: 'Example stale account A' }], totalOwed: 30 });
    second.next({ success: true, fines: [{ reason: 'Example account B' }], totalOwed: 4 });
    second.complete();
    expect(page.totalOwed).toBe(4);
    expect(page.fines.map(fine => fine.reason)).toEqual(['Example account B']);
    expect(page.loading).toBeFalse();
  });

  it('does not grant list ownership or append titles from a previous account', fakeAsync(() => {
    const firstLists = new Subject<AspenUserList[]>();
    const secondLists = new Subject<AspenUserList[]>();
    const firstTitles = new Subject<AspenListTitlesResult>();
    const secondTitles = new Subject<AspenListTitlesResult>();
    lists.fetchUserLists.and.returnValues(firstLists, secondLists);
    lists.fetchListTitles.and.returnValues(firstTitles, secondTitles);
    const page = TestBed.runInInjectionContext(() => new MyListDetailPage());
    page.ionViewWillEnter();
    switchAccount('account-b');
    page.ionViewWillEnter();
    secondLists.next([]);
    secondLists.complete();
    firstLists.next([{ id: 301, title: 'Example account A list' }]);
    firstLists.complete();
    firstTitles.next({ success: true, titles: [{ id: 'synthetic-a', title: 'Example account A title' }] });
    secondTitles.next({ success: true, titles: [{ id: 'synthetic-b', title: 'Example account B title' }] });
    secondTitles.complete();
    flushMicrotasks();
    expect(page.canEditList).toBeFalse();
    expect(page.titles.map(title => title.title)).toEqual(['Example account B title']);
    expect(page.loading).toBeFalse();
    page.ionViewDidLeave();
  }));

  for (const failed of [false, true]) {
    it(`ignores a previous account's late hold ${failed ? 'error' : 'success'} before optimistic updates`, () => {
      const pending = new Subject<AspenMutationResult>();
      holds.placeHold.and.returnValue(pending);
      const page = TestBed.runInInjectionContext(() => new MyListDetailPage());
      page['placeHoldNowForTitle']({ id: 'synthetic-work', title: 'Example title' }, '901001', 'EXAMPLE', 'Book');
      expect(holds.placeHold).toHaveBeenCalledOnceWith('901001', 'EXAMPLE', null);
      switchAccount('account-b');
      page.actionRecordId = 'synthetic-second-work';
      if (failed) pending.error(new Error('Synthetic upstream error'));
      else {
        pending.next({ success: true });
        pending.complete();
      }
      expect(adjustProfile).not.toHaveBeenCalled();
      expect(holdSupport.cacheOptimisticPlacedHold).not.toHaveBeenCalled();
      expect(TestBed.inject(ToastService).presentToast).not.toHaveBeenCalled();
      expect(TestBed.inject(ToastService).presentHoldPlacedToast).not.toHaveBeenCalled();
      expect(page.actionRecordId).toBe('synthetic-second-work');
    });
  }

  it('still applies a confirmed hold to the account that initiated it', () => {
    const pending = new Subject<AspenMutationResult>();
    holds.placeHold.and.returnValue(pending);
    const page = TestBed.runInInjectionContext(() => new MyListDetailPage());
    page['placeHoldNowForTitle']({ id: 'synthetic-work', title: 'Example title' }, '901001', 'EXAMPLE', 'Book');
    pending.next({ success: true });
    pending.complete();
    expect(adjustProfile).toHaveBeenCalledOnceWith({ holds: 1, holdsRequested: 1 });
    expect(holdSupport.cacheOptimisticPlacedHold).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({ groupedKey: 'synthetic-work', title: 'Example title' }), '901001', 'Book'
    );
    expect(TestBed.inject(ToastService).presentHoldPlacedToast).toHaveBeenCalled();
    expect(page.actionRecordId).toBe('');
  });
});
