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
  let preferences: AccountPreferencesService;
  let persistToken: jasmine.Spy<AccountPreferencesService['persistTokenForAccount']>;
  let persistPreferences: jasmine.Spy<AccountPreferencesService['persistPreferencesForAccount']>;
  let cache: jasmine.SpyObj<AppCacheService>;
  let locations: jasmine.SpyObj<LocationsService>;
  let activeSnapshot: AuthState;

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
    activeSnapshot = snapshot;
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['snapshot', 'applyActiveProfile', 'refreshActiveProfile']);
    auth.snapshot.and.callFake(() => activeSnapshot);
    auth.refreshActiveProfile.and.returnValue(of(snapshot));
    accounts = jasmine.createSpyObj<AccountStoreService>('AccountStoreService', ['getPassword', 'cacheProfile']);
    accounts.getPassword.and.resolveTo('synthetic-password');
    accounts.cacheProfile.and.resolveTo();
    lists = jasmine.createSpyObj<ListsService>('ListsService', ['fetchUserLists']);
    lists.fetchUserLists.and.returnValue(of(userLists));
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
      { provide: AppCacheService, useValue: cache },
      { provide: LocationsService, useValue: locations },
    ] });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(CacheWarmService);
    preferences = TestBed.inject(AccountPreferencesService);
    persistToken = spyOn(preferences, 'persistTokenForAccount').and.resolveTo();
    persistPreferences = spyOn(preferences, 'persistPreferencesForAccount').and.resolveTo();
    spyOn(preferences, 'fetchForAccount').and.returnValue(of({ token: 'synthetic-token', preferences: prefs, raw: {} }));
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
    expect(preferences.fetchForAccount).not.toHaveBeenCalled();
  }));

  for (const { label, section } of [
    { label: 'missing section', section: undefined },
    { label: 'failed section', section: { success: false, user: { token: 'synthetic-invalid-token' }, preferences: prefs } },
    { label: 'upstream error', section: { error: 'Synthetic upstream failure', preferences: prefs } },
    { label: 'empty preferences', section: { preferences: {} } },
    { label: 'array preferences', section: { preferences: [] } },
    { label: 'malformed pickup', section: { preferences: { ...prefs, pickup_library: {} } } },
    { label: 'wrapped failure', section: { result: { success: false, preferences: prefs } } },
  ]) {
    it(`retries incomplete bundled preferences for the captured account: ${label}`, fakeAsync(() => {
      warmRequest().flush({
        ok: true,
        userapi: { result: { success: true, profile } },
        listapi: { result: { success: true, lists: userLists } },
        preferences: section,
      });
      flushMicrotasks();
      expect(preferences.persistPreferencesForAccount).not.toHaveBeenCalled();
      expect(preferences.persistTokenForAccount).not.toHaveBeenCalled();
      expect(preferences.fetchForAccount).toHaveBeenCalledOnceWith('synthetic-account', 'synthetic-user', 'synthetic-password');
      expect(auth.applyActiveProfile).toHaveBeenCalledOnceWith(profile);
      expect(cache.write).toHaveBeenCalledOnceWith('lists:user:synthetic-account', userLists);
      expect(lists.fetchUserLists).not.toHaveBeenCalled();
      expect(auth.refreshActiveProfile).not.toHaveBeenCalled();
    }));
  }

  for (const wrapped of [false, true]) {
    for (const pickup of ['501', 501, '', null]) {
      it(`normalizes a valid ${wrapped ? 'wrapped' : 'raw'} preference bundle with pickup ${JSON.stringify(pickup)}`, fakeAsync(() => {
        const section = { user: { token: 'synthetic-token' }, preferences: { ...prefs, pickup_library: pickup } };
        warmRequest().flush({ ok: true, preferences: wrapped ? { result: section } : section });
        flushMicrotasks();
        expect(preferences.persistPreferencesForAccount).toHaveBeenCalledOnceWith(
          'synthetic-account', { ...prefs, pickup_library: pickup === null ? '' : String(pickup) }
        );
        expect(preferences.fetchForAccount).not.toHaveBeenCalled();
      }));
    }
  }

  it('waits for bundled token and preference persistence before completing hydration', fakeAsync(() => {
    let finishToken: () => void = () => { throw new Error('Token persistence not started'); };
    let finishPreferences: () => void = () => { throw new Error('Preference persistence not started'); };
    persistToken.and.returnValue(new Promise<void>(resolve => { finishToken = resolve; }));
    persistPreferences.and.returnValue(new Promise<void>(resolve => { finishPreferences = resolve; }));
    warmRequest().flush({ ok: true, preferences: { user: { token: 'synthetic-token' }, preferences: prefs }, locations: [] });
    flushMicrotasks();
    expect(preferences.persistTokenForAccount).toHaveBeenCalledTimes(1);
    expect(preferences.persistPreferencesForAccount).toHaveBeenCalledTimes(1);
    expect(locations.hydrateLocations).not.toHaveBeenCalled();
    finishToken();
    flushMicrotasks();
    expect(locations.hydrateLocations).not.toHaveBeenCalled();
    finishPreferences();
    flushMicrotasks();
    expect(locations.hydrateLocations).toHaveBeenCalledOnceWith([]);
    expect(preferences.fetchForAccount).not.toHaveBeenCalled();
  }));

  function switchAccount() {
    activeSnapshot = {
      ...snapshot, activeAccountId: 'synthetic-second-account',
      activeAccountMeta: { id: 'synthetic-second-account', username: 'synthetic-second-user', label: 'Another example patron' },
    };
  }

  it('keeps a delayed bundle and preference fallback tied to the original account after switching', fakeAsync(() => {
    const request = warmRequest();
    switchAccount();
    request.flush({ ok: true, userapi: { result: { success: true, profile } } });
    flushMicrotasks();
    expect(accounts.cacheProfile).toHaveBeenCalledOnceWith('synthetic-account', profile);
    expect(auth.applyActiveProfile).not.toHaveBeenCalled();
    expect(preferences.fetchForAccount).toHaveBeenCalledOnceWith('synthetic-account', 'synthetic-user', 'synthetic-password');
  }));

  it('checks the active account again after profile cache persistence finishes', fakeAsync(() => {
    let finishProfile: () => void = () => { throw new Error('Profile persistence not started'); };
    accounts.cacheProfile.and.returnValue(new Promise<void>(resolve => { finishProfile = resolve; }));
    warmRequest().flush({ ok: true, userapi: { result: { success: true, profile } }, preferences: { preferences: prefs } });
    flushMicrotasks();
    switchAccount();
    finishProfile();
    flushMicrotasks();
    expect(auth.applyActiveProfile).not.toHaveBeenCalled();
    expect(preferences.persistPreferencesForAccount).toHaveBeenCalledOnceWith('synthetic-account', prefs);
  }));

  it('keeps a failed bundle fallback on the original account without refreshing the new active account', fakeAsync(() => {
    const request = warmRequest();
    switchAccount();
    request.flush('Unavailable', { status: 503, statusText: 'Unavailable' });
    flushMicrotasks();
    expect(preferences.fetchForAccount).toHaveBeenCalledOnceWith('synthetic-account', 'synthetic-user', 'synthetic-password');
    expect(auth.refreshActiveProfile).not.toHaveBeenCalled();
    expect(lists.fetchUserLists).not.toHaveBeenCalled();
  }));

  it('captures credentials before an account switch while their secure-storage read is pending', fakeAsync(() => {
    let finishPassword: (password: string) => void = () => { throw new Error('Password read not started'); };
    accounts.getPassword.and.returnValue(new Promise<string>(resolve => { finishPassword = resolve; }));
    service.warmForActiveAccount();
    switchAccount();
    finishPassword('synthetic-password');
    flushMicrotasks();
    const request = http.expectOne('https://example.org/API/CacheWarm');
    expect(new URLSearchParams(request.request.body).get('username')).toBe('synthetic-user');
    expect(accounts.getPassword).toHaveBeenCalledOnceWith('synthetic-account');
    request.flush({ ok: true, preferences: { preferences: prefs } });
    flushMicrotasks();
    expect(preferences.persistPreferencesForAccount).toHaveBeenCalledOnceWith('synthetic-account', prefs);
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
