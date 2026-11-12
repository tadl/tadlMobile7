import { TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { ActionSheetController, AlertController } from '@ionic/angular/lazy';

import { Globals } from '../globals';
import { MyListsPage } from '../pages/my-lists/my-lists.page';
import { AccountStoreService } from './account-store.service';
import { AppCacheService } from './app-cache.service';
import { AuthService } from './auth.service';
import { ListsService, type AspenUserList, type AspenListTitlesResult } from './lists.service';
import { ListLookupService } from './list-lookup.service';
import { ToastService } from './toast.service';

describe('ListsService first login and refresh', () => {
  let http: HttpTestingController;
  let service: ListsService;
  let cache: jasmine.SpyObj<AppCacheService>;

  const savedList: AspenUserList = { id: 301, title: 'Synthetic reading list', numTitles: 2 };

  beforeEach(() => {
    cache = jasmine.createSpyObj<AppCacheService>('AppCacheService', ['read', 'write']);
    cache.read.and.resolveTo(null);
    cache.write.and.resolveTo();
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(), provideHttpClientTesting(),
      { provide: Globals, useValue: {
        aspen_api_base: 'https://api.example.org/API',
        aspen_api_host: 'https://api.example.org',
        aspen_discovery_base: 'https://catalog.example.org',
      } },
      { provide: AuthService, useValue: { snapshot: () => ({
        isLoggedIn: true, activeAccountId: 'synthetic-account',
        activeAccountMeta: { username: 'synthetic-user' },
      }) } },
      { provide: AccountStoreService, useValue: { getPassword: () => Promise.resolve('synthetic-password') } },
      { provide: AppCacheService, useValue: cache },
      { provide: ToastService, useValue: { presentToast: jasmine.createSpy() } },
      { provide: ListLookupService, useValue: { replaceLists: jasmine.createSpy() } },
      { provide: Router, useValue: {} },
      { provide: ActionSheetController, useValue: {} },
      { provide: AlertController, useValue: {} },
    ] });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(ListsService);
  });

  afterEach(() => http.verify());

  for (const wrapped of [false, true]) {
    const envelope = wrapped ? 'wrapped' : 'unwrapped';

    it(`loads reading lists without a first-login cache from an ${envelope} response`, fakeAsync(() => {
      const received: AspenUserList[][] = [];
      service.fetchUserLists().subscribe(value => received.push(value));
      flushMicrotasks();
      const request = http.expectOne(req => req.params.get('method') === 'getUserLists');
      expect(request.request.method).toBe('POST');
      expect(request.request.urlWithParams).not.toContain('synthetic-password');
      expect(new URLSearchParams(request.request.body).get('username')).toBe('synthetic-user');
      const fixture = { success: true, lists: [savedList] };
      request.flush(wrapped ? { result: fixture } : fixture);
      flushMicrotasks();
      expect(received.length).toBe(1);
      expect(received[0][0]).toEqual(jasmine.objectContaining(savedList));
      expect(cache.write).toHaveBeenCalledOnceWith('lists:user:synthetic-account', received[0]);
    }));

    it(`loads paginated titles from an ${envelope} list response without a local cache`, fakeAsync(() => {
      const received: AspenListTitlesResult[] = [];
      service.fetchListTitles(301, 2, 20).subscribe(value => received.push(value));
      flushMicrotasks();
      const request = http.expectOne(req => req.params.get('method') === 'getListTitles');
      expect(request.request.params.get('id')).toBe('301');
      expect(request.request.params.get('page')).toBe('2');
      const fixture = {
        success: true, listTitle: savedList.title, totalResults: 21, page_current: 2, page_total: 2,
        titles: [{ id: 'synthetic-grouped-work-eng', title: 'Synthetic title', image: '/bookcover.php?id=synthetic' }],
      };
      request.flush(wrapped ? { result: fixture } : fixture);
      flushMicrotasks();
      expect(received.length).toBe(1);
      expect(received[0].listTitle).toBe(savedList.title);
      expect(received[0].page_current).toBe(2);
      expect(received[0].page_total).toBe(2);
      expect(received[0].titles[0].image).toBe('https://catalog.example.org/bookcover.php?id=synthetic');
    }));
  }

  for (const response of [
    { success: false, message: 'Synthetic upstream unavailable' },
    { success: true },
  ]) {
    it(`keeps cached lists and reports an error for ${response.success ? 'missing lists' : 'an upstream failure'}`, fakeAsync(() => {
      cache.read.and.resolveTo([savedList]);
      const received: AspenUserList[][] = [];
      let failure: Error | undefined;
      service.fetchUserLists().subscribe({ next: value => received.push(value), error: error => { failure = error; } });
      flushMicrotasks();
      expect(received).toEqual([[savedList]]);
      http.expectOne(req => req.params.get('method') === 'getUserLists').flush({ result: response });
      flushMicrotasks();
      expect(failure).toEqual(jasmine.any(Error));
      expect(received).toEqual([[savedList]]);
      expect(cache.write).not.toHaveBeenCalled();
    }));
  }

  it('replaces populated cache after a successful empty list response', fakeAsync(() => {
    cache.read.and.resolveTo([savedList]);
    const received: AspenUserList[][] = [];
    service.fetchUserLists().subscribe(value => received.push(value));
    flushMicrotasks();
    http.expectOne(req => req.params.get('method') === 'getUserLists').flush({ result: { success: true, lists: [] } });
    flushMicrotasks();
    expect(received).toEqual([[savedList], []]);
    expect(cache.write).toHaveBeenCalledOnceWith('lists:user:synthetic-account', []);
  }));

  it('does not replace cached titles when a successful response omits the titles collection', fakeAsync(() => {
    const cached: AspenListTitlesResult = { success: true, titles: [{ id: 'synthetic-grouped-work-eng', title: 'Synthetic title' }] };
    cache.read.and.resolveTo(cached);
    const received: AspenListTitlesResult[] = [];
    let failure: Error | undefined;
    service.fetchListTitles(301).subscribe({ next: value => received.push(value), error: error => { failure = error; } });
    flushMicrotasks();
    http.expectOne(req => req.params.get('method') === 'getListTitles').flush({ result: { success: true } });
    flushMicrotasks();
    expect(received).toEqual([cached]);
    expect(failure).toEqual(jasmine.any(Error));
    expect(cache.write).not.toHaveBeenCalled();
  }));

  it('keeps cached reading lists visible when the page refresh fails', fakeAsync(() => {
    cache.read.and.resolveTo([savedList]);
    const page = TestBed.runInInjectionContext(() => new MyListsPage());
    page.refresh();
    flushMicrotasks();
    expect(page.lists).toEqual([savedList]);
    http.expectOne(req => req.params.get('method') === 'getUserLists')
      .flush({ result: { success: false, message: 'Synthetic upstream unavailable' } });
    flushMicrotasks();
    expect(page.lists).toEqual([savedList]);
    expect(page.loading).toBeFalse();
    expect(TestBed.inject(ToastService).presentToast).toHaveBeenCalledWith('Could not load your lists.');
  }));

  it('clears stale reading lists from the page after a successful empty refresh', fakeAsync(() => {
    cache.read.and.resolveTo([savedList]);
    const page = TestBed.runInInjectionContext(() => new MyListsPage());
    page.refresh();
    flushMicrotasks();
    expect(page.lists).toEqual([savedList]);
    http.expectOne(req => req.params.get('method') === 'getUserLists')
      .flush({ result: { success: true, lists: [] } });
    flushMicrotasks();
    expect(page.lists).toEqual([]);
    expect(page.loading).toBeFalse();
    expect(TestBed.inject(ToastService).presentToast).not.toHaveBeenCalled();
  }));
});
