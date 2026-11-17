import { TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { ActionSheetController, AlertController, ModalController } from '@ionic/angular/lazy';
import { BehaviorSubject, Subject, of } from 'rxjs';

import { Globals } from '../globals';
import { MyListDetailPage } from '../pages/my-list-detail/my-list-detail.page';
import { MyListsPage } from '../pages/my-lists/my-lists.page';
import { AuthService, type AuthState } from './auth.service';
import { FormatFamilyService } from './format-family.service';
import { HoldsService } from './holds.service';
import { HoldSupportService } from './hold-support.service';
import { ListLookupService } from './list-lookup.service';
import { ListsService, type AspenListMutationResult } from './lists.service';
import { ToastService } from './toast.service';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}

describe('Reading-list mutation context', () => {
  let active: AuthState;
  let authChanges: BehaviorSubject<AuthState> | undefined;
  let lists: jasmine.SpyObj<ListsService>;
  let lookup: jasmine.SpyObj<ListLookupService>;
  let alerts: jasmine.SpyObj<AlertController>;
  let sheets: jasmine.SpyObj<ActionSheetController>;
  let router: jasmine.SpyObj<Router>;
  let toast: jasmine.Spy;
  const title = { id: 'synthetic-work', title: 'Example title' };
  const list = { id: '301', title: 'Example list' };

  function switchAccount(id: string) {
    active = {
      isLoggedIn: true, activeAccountId: id,
      activeAccountMeta: { id, username: `synthetic-${id}`, label: 'Example patron' }, profile: null,
    };
    authChanges?.next(active);
  }

  function detailPage() {
    const page = TestBed.runInInjectionContext(() => new MyListDetailPage());
    page.listId = '301';
    page.listTitle = 'Example list';
    page.canEditList = true;
    page.titles = [title];
    return page;
  }

  beforeEach(() => {
    authChanges = undefined;
    switchAccount('account-a');
    authChanges = new BehaviorSubject(active);
    lists = jasmine.createSpyObj<ListsService>('ListsService', [
      'fetchUserLists', 'fetchListTitles', 'createList', 'editList', 'deleteList', 'removeTitlesFromList',
    ]);
    lists.fetchUserLists.and.returnValue(of([]));
    lists.fetchListTitles.and.returnValue(of({ success: true, titles: [] }));
    lookup = jasmine.createSpyObj<ListLookupService>('ListLookupService', [
      'replaceLists', 'observeListPage', 'renameList', 'removeList', 'removeMembership',
    ]);
    alerts = jasmine.createSpyObj<AlertController>('AlertController', ['create']);
    sheets = jasmine.createSpyObj<ActionSheetController>('ActionSheetController', ['create']);
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    toast = jasmine.createSpy('presentToast');
    TestBed.configureTestingModule({ providers: [
      { provide: AuthService, useValue: { snapshot: () => active, authState: () => authChanges!.asObservable() } },
      { provide: ListsService, useValue: lists },
      { provide: ListLookupService, useValue: lookup },
      { provide: Globals, useValue: {} },
      { provide: ToastService, useValue: { presentToast: toast } },
      { provide: ActivatedRoute, useValue: { snapshot: {
        paramMap: { get: () => '301' }, queryParamMap: { get: () => '' },
      } } },
      { provide: Router, useValue: router },
      { provide: ActionSheetController, useValue: sheets },
      { provide: AlertController, useValue: alerts },
      { provide: ModalController, useValue: {} },
      { provide: HoldsService, useValue: {} },
      { provide: FormatFamilyService, useValue: {} },
      { provide: HoldSupportService, useValue: {} },
    ] });
  });

  for (const mutation of ['remove', 'edit', 'delete']) {
    for (const outcome of ['success', 'rejection', 'error']) {
      it(`ignores a late ${mutation} ${outcome} after changing account`, () => {
        const pending = new Subject<AspenListMutationResult>();
        lists.removeTitlesFromList.and.returnValue(pending);
        lists.editList.and.returnValue(pending);
        lists.deleteList.and.returnValue(pending);
        const page = detailPage();
        if (mutation === 'remove') page['removeFromListNow'](title);
        if (mutation === 'edit') page['saveListMeta']('Changed title', 'Changed description');
        if (mutation === 'delete') page['deleteListNow']();
        switchAccount('account-b');
        page.listTitle = 'Other account list';
        page.titles = [{ id: 'other-work', title: 'Other title' }];
        page.mutatingList = true;
        page.removingRecordId = 'other-work';
        if (outcome === 'error') pending.error(new Error('Synthetic old request error'));
        else { pending.next({ success: outcome === 'success' }); pending.complete(); }
        expect(page.listTitle).toBe('Other account list');
        expect(page.titles.map(entry => entry.id)).toEqual(['other-work']);
        expect(page.mutatingList).toBeTrue();
        expect(page.removingRecordId).toBe('other-work');
        expect(lookup.removeMembership).not.toHaveBeenCalled();
        expect(lookup.renameList).not.toHaveBeenCalled();
        expect(lookup.removeList).not.toHaveBeenCalled();
        expect(router.navigate).not.toHaveBeenCalled();
        expect(toast).not.toHaveBeenCalled();
      });
    }
  }

  it('ignores a mutation after leaving and returning to the same list', () => {
    const pending = new Subject<AspenListMutationResult>();
    lists.editList.and.returnValue(pending);
    const page = detailPage();
    page['saveListMeta']('Old edit', '');
    page.ionViewDidLeave();
    page.listTitle = 'Current view';
    pending.next({ success: true });
    pending.complete();
    expect(page.listTitle).toBe('Current view');
    expect(lookup.renameList).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('keeps a removal scoped to the list that sent it', () => {
    const pending = new Subject<AspenListMutationResult>();
    lists.removeTitlesFromList.and.returnValue(pending);
    const page = detailPage();
    page['removeFromListNow'](title);
    expect(lists.removeTitlesFromList).toHaveBeenCalledOnceWith('301', ['synthetic-work']);
    page.listId = '302';
    pending.next({ success: true });
    pending.complete();
    expect(page.titles).toEqual([title]);
    expect(lookup.removeMembership).not.toHaveBeenCalled();
  });

  it('still updates the originating list after a confirmed successful removal', () => {
    lists.removeTitlesFromList.and.returnValue(of({ success: true }));
    const page = detailPage();
    page['removeFromListNow'](title);
    expect(page.titles).toEqual([]);
    expect(lookup.removeMembership).toHaveBeenCalledOnceWith('synthetic-work', '301');
    expect(page.removingRecordId).toBe('');
    expect(toast).toHaveBeenCalled();
  });

  it('does not submit an old edit alert after account switching', fakeAsync(() => {
    const overlay = { present: jasmine.createSpy().and.resolveTo(), remove: jasmine.createSpy() };
    alerts.create.and.resolveTo(overlay as unknown as HTMLIonAlertElement);
    const page = detailPage();
    void page.editListMeta();
    flushMicrotasks();
    const options = alerts.create.calls.mostRecent().args[0]!;
    const save = options.buttons?.find(button => typeof button !== 'string' && button.role === 'confirm');
    switchAccount('account-b');
    if (save && typeof save !== 'string') save.handler?.({ title: 'Old edit', description: '' });
    expect(lists.editList).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  }));

  it('discards an alert whose creation finishes after the view is left', fakeAsync(() => {
    const created = deferred<HTMLIonAlertElement>();
    const overlay = { present: jasmine.createSpy().and.resolveTo(), remove: jasmine.createSpy() };
    alerts.create.and.returnValue(created.promise);
    const page = detailPage();
    void page.confirmDeleteList();
    page.ionViewDidLeave();
    created.resolve(overlay as unknown as HTMLIonAlertElement);
    flushMicrotasks();
    expect(overlay.present).not.toHaveBeenCalled();
    expect(overlay.remove).toHaveBeenCalled();
    expect(lists.deleteList).not.toHaveBeenCalled();
  }));

  it('does not finish an old create dialog using the newly selected account', fakeAsync(() => {
    const basics = deferred<{ title: string; description: string } | null>();
    const page = TestBed.runInInjectionContext(() => new MyListsPage());
    spyOn(page as any, 'promptListBasics').and.returnValue(basics.promise);
    const visibility = spyOn(page as any, 'promptVisibility');
    void page.createList();
    switchAccount('account-b');
    basics.resolve({ title: 'Old account list', description: '' });
    flushMicrotasks();
    expect(visibility).not.toHaveBeenCalled();
    expect(lists.createList).not.toHaveBeenCalled();
  }));

  it('does not submit an old visibility dialog after leaving My Lists', fakeAsync(() => {
    const visibility = deferred<boolean | null>();
    const page = TestBed.runInInjectionContext(() => new MyListsPage());
    spyOn(page as any, 'promptListBasics').and.resolveTo({ title: 'Old edit', description: '' });
    spyOn(page as any, 'promptVisibility').and.returnValue(visibility.promise);
    void page.editList(list);
    flushMicrotasks();
    page.ionViewDidLeave();
    visibility.resolve(true);
    flushMicrotasks();
    expect(lists.editList).not.toHaveBeenCalled();
  }));

  it('ignores a late My Lists deletion without altering the active account cache', () => {
    const pending = new Subject<AspenListMutationResult>();
    lists.deleteList.and.returnValue(pending);
    const page = TestBed.runInInjectionContext(() => new MyListsPage());
    page['deleteList'](list);
    switchAccount('account-b');
    page.lists = [{ id: '302', title: 'Other list' }];
    pending.next({ success: true });
    pending.complete();
    expect(page.lists.map(value => value.id)).toEqual(['302']);
    expect(lookup.removeList).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('ignores old list mutations even after switching away and back to the same account', () => {
    const pending = new Subject<AspenListMutationResult>();
    lists.editList.and.returnValue(pending);
    const page = detailPage();
    page.ngOnInit();
    page['saveListMeta']('Old edit', '');
    switchAccount('account-b');
    switchAccount('account-a');
    page.listTitle = 'Latest account view';
    pending.next({ success: true });
    pending.complete();
    expect(page.listTitle).toBe('Latest account view');
    expect(lookup.renameList).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    page.ngOnDestroy();
  });

  it('invalidates a My Lists dialog when the active account changes away and back', fakeAsync(() => {
    const visibility = deferred<boolean | null>();
    const page = TestBed.runInInjectionContext(() => new MyListsPage());
    page.ngOnInit();
    spyOn(page as any, 'promptListBasics').and.resolveTo({ title: 'Old edit', description: '' });
    spyOn(page as any, 'promptVisibility').and.returnValue(visibility.promise);
    void page.editList(list);
    flushMicrotasks();
    switchAccount('account-b');
    switchAccount('account-a');
    visibility.resolve(true);
    flushMicrotasks();
    expect(lists.editList).not.toHaveBeenCalled();
    page.ngOnDestroy();
  }));

});
