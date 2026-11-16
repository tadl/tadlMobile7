import { TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { Globals } from '../globals';
import { AccountPreferencesService } from './account-preferences.service';
import { AccountStoreService } from './account-store.service';
import { AppCacheService } from './app-cache.service';
import { AuthService, type AuthState } from './auth.service';
import { CheckoutsService, type AspenCheckout, type AspenMutationResult } from './checkouts.service';

describe('CheckoutsService response and account safety', () => {
  let http: HttpTestingController;
  let service: CheckoutsService;
  let cache: jasmine.SpyObj<AppCacheService>;
  let snapshot: AuthState;
  const checkout: AspenCheckout = {
    id: 501, itemId: 601, recordId: 901001, barcode: 'SYNTHETIC-COPY-601',
    type: 'ils', source: 'ils', title: 'Synthetic checkout',
  };

  beforeEach(() => {
    snapshot = {
      isLoggedIn: true, activeAccountId: 'synthetic-account',
      activeAccountMeta: { id: 'synthetic-account', username: 'synthetic-user', label: 'Example patron' },
      profile: { id: 401 },
    };
    cache = jasmine.createSpyObj<AppCacheService>('AppCacheService', ['read', 'write']);
    cache.read.and.resolveTo(null);
    cache.write.and.resolveTo();
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(), provideHttpClientTesting(),
      { provide: Globals, useValue: { aspen_api_base: 'https://api.example.org/API' } },
      { provide: AuthService, useValue: { snapshot: () => snapshot } },
      { provide: AccountStoreService, useValue: { getPassword: () => Promise.resolve('synthetic-password') } },
      { provide: AccountPreferencesService, useValue: { getCachedToken: () => Promise.resolve(null) } },
      { provide: AppCacheService, useValue: cache },
    ] });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(CheckoutsService);
    spyOn(service as unknown as { getOrCreateSessionId(): Promise<string> }, 'getOrCreateSessionId').and.resolveTo('synthetic-session');
  });

  afterEach(() => http.verify());

  for (const response of [{ error: 'invalid_method' }, { result: {} }, { result: { success: 'false' } }]) {
    it(`does not report renewal success for ${'error' in response ? 'an HTTP 200 invalid-method error' : 'success' in response.result ? 'a false string' : 'an empty envelope'}`, fakeAsync(() => {
      let result: AspenMutationResult | undefined;
      service.renewCheckout(checkout).subscribe(value => { result = value; });
      flushMicrotasks();
      http.expectOne(req => req.params.get('method') === 'renewItem').flush(response);
      flushMicrotasks();
      expect(result?.success).toBeFalse();
    }));
  }

  it('retains the explicit boolean success and message from a valid renewal', fakeAsync(() => {
    let result: AspenMutationResult | undefined;
    service.renewCheckout(checkout).subscribe(value => { result = value; });
    flushMicrotasks();
    http.expectOne(req => req.params.get('method') === 'renewItem')
      .flush({ result: { success: true, message: 'Synthetic checkout renewed.' } });
    flushMicrotasks();
    expect(result?.success).toBeTrue();
    expect(result?.message).toBe('Synthetic checkout renewed.');
  }));

  for (const response of [
    { success: false, message: 'Synthetic circulation offline' },
    { success: true },
  ]) {
    it(`preserves checkout cache for ${response.success ? 'a missing collection' : 'an API failure'}`, fakeAsync(() => {
      cache.read.and.resolveTo([checkout]);
      const received: AspenCheckout[][] = [];
      let failure: Error | undefined;
      service.fetchActiveCheckouts().subscribe({ next: value => received.push(value), error: error => { failure = error; } });
      flushMicrotasks();
      http.expectOne(req => req.params.get('method') === 'getPatronCheckedOutItems').flush({ result: response });
      flushMicrotasks();
      expect(failure).toEqual(jasmine.any(Error));
      expect(received).toEqual([[checkout]]);
      expect(cache.write).not.toHaveBeenCalled();
    }));
  }

  it('keeps in-flight checkout requests separate when the active account changes', fakeAsync(() => {
    const first: AspenCheckout[][] = [];
    const second: AspenCheckout[][] = [];
    service.fetchActiveCheckouts().subscribe(value => first.push(value));
    flushMicrotasks();
    const firstRequest = http.expectOne(req => req.params.get('method') === 'getPatronCheckedOutItems');
    snapshot = {
      ...snapshot, activeAccountId: 'synthetic-other-account',
      activeAccountMeta: { id: 'synthetic-other-account', username: 'synthetic-other-user', label: 'Example Other' },
    };
    service.fetchActiveCheckouts().subscribe(value => second.push(value));
    flushMicrotasks();
    const secondRequest = http.expectOne(req => req.params.get('method') === 'getPatronCheckedOutItems');
    expect(new URLSearchParams(secondRequest.request.body).get('username')).toBe('synthetic-other-user');
    secondRequest.flush({ result: { success: true, checkedOutItems: [{ ...checkout, id: 502, title: 'Other synthetic checkout' }] } });
    firstRequest.flush({ result: { success: true, checkedOutItems: [checkout] } });
    flushMicrotasks();
    expect(first[0][0].title).toBe('Synthetic checkout');
    expect(second[0][0].title).toBe('Other synthetic checkout');
    expect(cache.write).toHaveBeenCalledWith('checkouts:synthetic-other-account', second[0]);
    expect(cache.write).toHaveBeenCalledWith('checkouts:synthetic-account', first[0]);
  }));

  it('still shares one in-flight request between readers of the same account', fakeAsync(() => {
    const first: AspenCheckout[][] = [];
    const second: AspenCheckout[][] = [];
    service.fetchActiveCheckouts().subscribe(value => first.push(value));
    service.fetchActiveCheckouts().subscribe(value => second.push(value));
    flushMicrotasks();
    http.expectOne(req => req.params.get('method') === 'getPatronCheckedOutItems')
      .flush({ result: { success: true, checkedOutItems: [checkout] } });
    flushMicrotasks();
    expect(first[0][0].title).toBe(checkout.title);
    expect(second).toEqual(first);
  }));
});
