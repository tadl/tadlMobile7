import { TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';

import { Globals } from '../globals';
import {
  AccountPreferencesService,
  type PreferencesPayload,
} from './account-preferences.service';
import { AppCacheService } from './app-cache.service';

describe('Account preference hydration', () => {
  let service: AccountPreferencesService;
  let cache: jasmine.SpyObj<AppCacheService>;
  let http: HttpTestingController;
  const fixture = () => ({
    user: { token: 'synthetic-token' },
    preferences: {
      username: 'synthetic-user',
      pickup_library: '901',
    },
  });

  beforeEach(() => {
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
          useValue: { aspen_api_base: 'https://example.org/API' },
        },
        { provide: AppCacheService, useValue: cache },
      ],
    });
    service = TestBed.inject(AccountPreferencesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('accepts raw and wrapped preferences and explicit unset defaults', () => {
    expect(service.parsePayload(fixture())?.preferences.pickup_library).toBe(
      '901'
    );
    expect(
      service.parsePayload({ result: fixture() })?.preferences.pickup_library
    ).toBe('901');
    for (const pickup of ['', null, 901]) {
      expect(
        service.parsePayload({ preferences: { pickup_library: pickup } })
          ?.preferences.pickup_library
      ).toBe(pickup === null ? '' : String(pickup));
    }
  });

  it('rejects failed or incomplete responses instead of treating them as empty defaults', () => {
    for (const raw of [
      null,
      [],
      {},
      { preferences: {} },
      { preferences: [] },
      { preferences: { pickup_library: {} } },
      { success: false, ...fixture() },
      { messages: [{ error: 'Synthetic failure' }], ...fixture() },
    ]) {
      expect(service.parsePayload(raw)).toBeNull();
    }
  });

  it('does not complete a preference fetch before the token and default are cached', fakeAsync(() => {
    let finishToken: () => void = () => {
      throw new Error('Token write did not start');
    };
    let finishPreferences: () => void = () => {
      throw new Error('Preference write did not start');
    };
    cache.write.and.callFake(
      (key: string) =>
        new Promise<void>((resolve) => {
          if (key.includes(':token:')) finishToken = resolve;
          else finishPreferences = resolve;
        })
    );
    let received: PreferencesPayload | undefined;
    service
      .fetchForAccount(
        'synthetic-account',
        'synthetic-user',
        'synthetic-password'
      )
      .subscribe((payload) => {
        received = payload;
      });
    http.expectOne((req) => req.url.endsWith('/Preferences')).flush(fixture());
    flushMicrotasks();
    expect(cache.write).toHaveBeenCalledTimes(2);
    expect(received).toBeUndefined();
    finishToken();
    flushMicrotasks();
    expect(received).toBeUndefined();
    finishPreferences();
    flushMicrotasks();
    expect(received?.preferences.pickup_library).toBe('901');
  }));

  it('returns fresh defaults when optional storage fails', fakeAsync(() => {
    cache.write.and.rejectWith(new Error('Synthetic storage failure'));
    let received: PreferencesPayload | undefined;
    service
      .fetchForAccount(
        'synthetic-account',
        'synthetic-user',
        'synthetic-password'
      )
      .subscribe((payload) => {
        received = payload;
      });
    http.expectOne((req) => req.url.endsWith('/Preferences')).flush(fixture());
    flushMicrotasks();
    expect(received?.preferences.pickup_library).toBe('901');
    expect(cache.write).toHaveBeenCalledTimes(2);
  }));
});
