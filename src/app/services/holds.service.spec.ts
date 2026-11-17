import { TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';

import { Globals } from '../globals';
import { AccountPreferencesService } from './account-preferences.service';
import { AccountStoreService } from './account-store.service';
import { AppCacheService } from './app-cache.service';
import { AuthService, type AuthState } from './auth.service';
import {
  HoldsService,
  type AspenHold,
  type AspenMutationResult,
} from './holds.service';

describe('HoldsService response and account safety', () => {
  let http: HttpTestingController;
  let service: HoldsService;
  let cache: jasmine.SpyObj<AppCacheService>;
  let snapshot: AuthState;
  const hold: AspenHold = {
    id: 501,
    cancelId: 501,
    recordId: 901001,
    type: 'ils',
    source: 'ils',
    title: 'Synthetic hold',
  };
  const actions = [
    {
      method: 'placeHold',
      invoke: (s: HoldsService) => s.placeHold('901001', 'EXAMPLE-MAIN', null),
    },
    { method: 'cancelHold', invoke: (s: HoldsService) => s.cancelHold(hold) },
    {
      method: 'freezeHold',
      invoke: (s: HoldsService) => s.freezeHoldIndefinitely(hold),
    },
    { method: 'activateHold', invoke: (s: HoldsService) => s.thawHold(hold) },
    {
      method: 'changeHoldPickUpLocation',
      invoke: (s: HoldsService) =>
        s.changeHoldPickUpLocation(501, '801_EXAMPLE-MAIN', null),
    },
  ];

  beforeEach(() => {
    snapshot = {
      isLoggedIn: true,
      activeAccountId: 'synthetic-account',
      activeAccountMeta: {
        id: 'synthetic-account',
        username: 'synthetic-user',
        label: 'Example patron',
      },
      profile: null,
    };
    cache = jasmine.createSpyObj<AppCacheService>('AppCacheService', [
      'read',
      'write',
    ]);
    cache.read.and.resolveTo(null);
    cache.write.and.resolveTo();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        {
          provide: Globals,
          useValue: { aspen_api_base: 'https://api.example.org/API' },
        },
        { provide: AuthService, useValue: { snapshot: () => snapshot } },
        {
          provide: AccountStoreService,
          useValue: {
            getPassword: () => Promise.resolve('synthetic-password'),
          },
        },
        {
          provide: AccountPreferencesService,
          useValue: { getCachedToken: () => Promise.resolve(null) },
        },
        { provide: AppCacheService, useValue: cache },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(HoldsService);
  });

  afterEach(() => http.verify());

  for (const action of actions) {
    it(`does not report ${action.method} success for an HTTP 200 invalid-method error`, fakeAsync(() => {
      let result: AspenMutationResult | undefined;
      action.invoke(service).subscribe((value) => {
        result = value;
      });
      flushMicrotasks();
      http
        .expectOne((req) => req.params.get('method') === action.method)
        .flush({ error: 'invalid_method' });
      flushMicrotasks();
      expect(result?.success).toBeFalse();
    }));
  }

  for (const action of actions.slice(2)) {
    it(`accepts the proxy's explicit boolean success for helper-backed ${action.method}`, fakeAsync(() => {
      let result: AspenMutationResult | undefined;
      action.invoke(service).subscribe((value) => {
        result = value;
      });
      flushMicrotasks();
      const request = http.expectOne(
        (req) => req.params.get('method') === action.method
      );
      expect(request.request.params.get('userApiBackend')).toBe('helper');
      request.flush({
        result: { success: true, message: 'Synthetic action completed.' },
      });
      flushMicrotasks();
      expect(result?.success).toBeTrue();
    }));
  }

  it('does not interpret a false string as a successful hold', fakeAsync(() => {
    let result: AspenMutationResult | undefined;
    service.placeHold('901001', 'EXAMPLE-MAIN', null).subscribe((value) => {
      result = value;
    });
    flushMicrotasks();
    http
      .expectOne((req) => req.params.get('method') === 'placeHold')
      .flush({ result: { success: 'false' } });
    flushMicrotasks();
    expect(result?.success).toBeFalse();
  }));

  for (const response of [
    { success: false, message: 'Synthetic circulation offline' },
    { error: 'invalid_method' },
    { success: true },
  ]) {
    it(`preserves populated hold cache for ${
      'error' in response
        ? 'an invalid method'
        : response.success
        ? 'missing hold collections'
        : 'an API failure'
    }`, fakeAsync(() => {
      cache.read.and.resolveTo([hold]);
      const received: AspenHold[][] = [];
      let failure: Error | undefined;
      service.fetchActiveHolds().subscribe({
        next: (value) => received.push(value),
        error: (error) => {
          failure = error;
        },
      });
      flushMicrotasks();
      expect(received).toEqual([[hold]]);
      http
        .expectOne((req) => req.params.get('method') === 'getPatronHolds')
        .flush({ result: response });
      flushMicrotasks();
      expect(failure).toEqual(jasmine.any(Error));
      expect(received).toEqual([[hold]]);
      expect(cache.write).not.toHaveBeenCalled();
    }));
  }

  it('accepts a successful empty collection and clears stale holds', fakeAsync(() => {
    cache.read.and.resolveTo([hold]);
    const received: AspenHold[][] = [];
    service.fetchActiveHolds().subscribe((value) => received.push(value));
    flushMicrotasks();
    http
      .expectOne((req) => req.params.get('method') === 'getPatronHolds')
      .flush({
        result: { success: true, holds: { available: [], unavailable: [] } },
      });
    flushMicrotasks();
    expect(received).toEqual([[hold], []]);
    expect(cache.write).toHaveBeenCalledOnceWith(
      'accounts:holds:synthetic-account',
      []
    );
  }));

  it('keeps in-flight hold requests separate when the active account changes', fakeAsync(() => {
    const first: AspenHold[][] = [];
    const second: AspenHold[][] = [];
    service.fetchActiveHolds().subscribe((value) => first.push(value));
    flushMicrotasks();
    const firstRequest = http.expectOne(
      (req) => req.params.get('method') === 'getPatronHolds'
    );
    snapshot = {
      ...snapshot,
      activeAccountId: 'synthetic-other-account',
      activeAccountMeta: {
        id: 'synthetic-other-account',
        username: 'synthetic-other-user',
        label: 'Example Other',
      },
    };
    service.fetchActiveHolds().subscribe((value) => second.push(value));
    flushMicrotasks();
    const secondRequest = http.expectOne(
      (req) => req.params.get('method') === 'getPatronHolds'
    );
    expect(
      new URLSearchParams(secondRequest.request.body).get('username')
    ).toBe('synthetic-other-user');
    secondRequest.flush({
      result: {
        success: true,
        holds: {
          available: [],
          unavailable: [{ ...hold, id: 502, title: 'Other synthetic hold' }],
        },
      },
    });
    firstRequest.flush({
      result: {
        success: true,
        holds: { available: [], unavailable: { synthetic: hold } },
      },
    });
    flushMicrotasks();
    expect(first[0][0].title).toBe('Synthetic hold');
    expect(second[0][0].title).toBe('Other synthetic hold');
    expect(cache.write).toHaveBeenCalledWith(
      'accounts:holds:synthetic-other-account',
      second[0]
    );
    expect(cache.write).toHaveBeenCalledWith(
      'accounts:holds:synthetic-account',
      first[0]
    );
  }));

  it('still shares one in-flight request between readers of the same account', fakeAsync(() => {
    const first: AspenHold[][] = [];
    const second: AspenHold[][] = [];
    service.fetchActiveHolds().subscribe((value) => first.push(value));
    service.fetchActiveHolds().subscribe((value) => second.push(value));
    flushMicrotasks();
    http
      .expectOne((req) => req.params.get('method') === 'getPatronHolds')
      .flush({
        result: {
          success: true,
          holds: { available: [], unavailable: [hold] },
        },
      });
    flushMicrotasks();
    expect(first[0][0].title).toBe(hold.title);
    expect(second).toEqual(first);
  }));
});
