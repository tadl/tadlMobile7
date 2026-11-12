import { TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { CacheWarmService } from './cache-warm.service';
import { AuthService, type AuthState } from './auth.service';
import { AccountStoreService } from './account-store.service';
import { ListsService } from './lists.service';
import { AccountPreferencesService, type AccountPreferences } from './account-preferences.service';
import { AppCacheService } from './app-cache.service';
import { Globals } from '../globals';
import { LocationsService } from './locations.service';

describe('CacheWarm first account hydration', () => {
  let http: HttpTestingController;
  let service: CacheWarmService;
  let auth: jasmine.SpyObj<AuthService>;
  let accounts: jasmine.SpyObj<AccountStoreService>;
  let lists: jasmine.SpyObj<ListsService>;
  let preferences: jasmine.SpyObj<AccountPreferencesService>;
  let cache: jasmine.SpyObj<AppCacheService>;
  let locations: jasmine.SpyObj<LocationsService>;

  const snapshot: AuthState = {
    isLoggedIn: true, activeAccountId: 'synthetic-account',
    activeAccountMeta: { id: 'synthetic-account', username: 'synthetic-user', label: 'Example patron' },
    profile: { id: 401 },
  };
  const profile = { id: 401, numReadingHistory: 21, readingHistoryEnabled: 1 };
  const userLists = [{ id: 301, title: 'Synthetic reading list', numTitles: 2 }];
  const prefs: AccountPreferences = {
    username: 'synthetic-user', hold_shelf_alias: '', day_phone: '', evening_phone: '', other_phone: '',
    email: 'alice@example.org', melcat_id: '', pickup_library: '501', default_search: '',
    keep_circ_history: true, keep_hold_history: false, email_notify: true, phone_notify: false,
    text_notify: false, phone_notify_number: '', text_notify_number: '',
  };

  beforeEach(() => {
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['snapshot', 'applyActiveProfile', 'refreshActiveProfile']);
    auth.snapshot.and.returnValue(snapshot);
    auth.refreshActiveProfile.and.returnValue(of(snapshot));
    accounts = jasmine.createSpyObj<AccountStoreService>('AccountStoreService', ['prewarmActivePassword', 'getPassword', 'cacheProfile']);
    accounts.prewarmActivePassword.and.resolveTo();
    accounts.getPassword.and.resolveTo('synthetic-password');
    accounts.cacheProfile.and.resolveTo();
    lists = jasmine.createSpyObj<ListsService>('ListsService', ['fetchUserLists']);
    lists.fetchUserLists.and.returnValue(of(userLists));
    preferences = jasmine.createSpyObj<AccountPreferencesService>('AccountPreferencesService', [
      'persistTokenForAccount', 'persistPreferencesForAccount', 'fetchForAccount',
    ]);
    preferences.persistTokenForAccount.and.resolveTo();
    preferences.persistPreferencesForAccount.and.resolveTo();
    preferences.fetchForAccount.and.returnValue(of({ token: 'synthetic-token', preferences: prefs, raw: {} }));
    cache = jasmine.createSpyObj<AppCacheService>('AppCacheService', ['write']);
    cache.write.and.resolveTo();
    locations = jasmine.createSpyObj<LocationsService>('LocationsService', ['hydrateLocations', 'getLocations']);
    locations.hydrateLocations.and.resolveTo();
    locations.getLocations.and.returnValue(of([]));
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(), provideHttpClientTesting(),
      { provide: Globals, useValue: { aspen_api_base: 'https://example.org/API' } },
      { provide: AuthService, useValue: auth },
      { provide: AccountStoreService, useValue: accounts },
      { provide: ListsService, useValue: lists },
      { provide: AccountPreferencesService, useValue: preferences },
      { provide: AppCacheService, useValue: cache },
      { provide: LocationsService, useValue: locations },
    ] });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(CacheWarmService);
  });

  afterEach(() => http.verify());

  function warmRequest() {
    service.warmForActiveAccount();
    flushMicrotasks();
    return http.expectOne('https://example.org/API/CacheWarm');
  }

  it('hydrates profile, reading lists and preferences on first login while opting into coordinated history', fakeAsync(() => {
    const request = warmRequest();
    expect(request.request.method).toBe('POST');
    const body = new URLSearchParams(request.request.body);
    expect(body.get('historyCoordinator')).toBe('1');
    expect(body.get('username')).toBe('synthetic-user');
    expect(body.get('password')).toBe('synthetic-password');
    expect(request.request.urlWithParams).not.toContain('synthetic-password');
    request.flush({
      ok: true,
      userapi: { result: { success: true, profile } },
      listapi: { result: { success: true, lists: userLists } },
      preferences: { user: { token: 'synthetic-token' }, preferences: prefs },
      locations: [],
    });
    flushMicrotasks();

    expect(accounts.cacheProfile).toHaveBeenCalledOnceWith('synthetic-account', profile);
    expect(auth.applyActiveProfile).toHaveBeenCalledOnceWith(profile);
    expect(cache.write).toHaveBeenCalledOnceWith('lists:user:synthetic-account', userLists);
    expect(preferences.persistTokenForAccount).toHaveBeenCalledOnceWith('synthetic-account', 'synthetic-token');
    expect(preferences.persistPreferencesForAccount).toHaveBeenCalledOnceWith('synthetic-account', prefs);
    expect(lists.fetchUserLists).not.toHaveBeenCalled();
    expect(auth.refreshActiveProfile).not.toHaveBeenCalled();
  }));

  for (const listapi of [
    undefined,
    { result: { success: false, lists: [] } },
    { result: { success: true } },
  ]) {
    it(`preserves populated list cache when bundled lists are ${listapi === undefined ? 'absent' : listapi.result.success ? 'malformed' : 'unsuccessful'}`, fakeAsync(() => {
      warmRequest().flush({ ok: true, userapi: { result: { success: true, profile } }, listapi });
      flushMicrotasks();
      expect(cache.write).not.toHaveBeenCalled();
      expect(auth.applyActiveProfile).toHaveBeenCalledOnceWith(profile);
    }));
  }

  it('replaces stale lists when the bundle confirms a successful empty collection', fakeAsync(() => {
    warmRequest().flush({ ok: true, listapi: { result: { success: true, lists: [] } } });
    flushMicrotasks();
    expect(cache.write).toHaveBeenCalledOnceWith('lists:user:synthetic-account', []);
  }));

  it('fetches account data individually when the bundled request fails', fakeAsync(() => {
    warmRequest().flush('Unavailable', { status: 503, statusText: 'Unavailable' });
    flushMicrotasks();
    expect(auth.refreshActiveProfile).toHaveBeenCalledTimes(1);
    expect(lists.fetchUserLists).toHaveBeenCalledTimes(1);
    expect(preferences.fetchForAccount).toHaveBeenCalledOnceWith('synthetic-account', 'synthetic-user', 'synthetic-password');
    expect(locations.getLocations).toHaveBeenCalledTimes(1);
  }));
});
