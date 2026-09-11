import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { CacheWarmService } from './cache-warm.service';
import { AuthService } from './auth.service';
import { AccountStoreService } from './account-store.service';
import { ListsService } from './lists.service';
import { AccountPreferencesService } from './account-preferences.service';
import { AppCacheService } from './app-cache.service';
import { Globals } from '../globals';
import { LocationsService } from './locations.service';

describe('CacheWarm history capability', () => {
  it('explicitly opts updated clients into background history initialization', async () => {
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(), provideHttpClientTesting(),
      { provide: Globals, useValue: { aspen_api_base: 'https://example.org/API' } },
      { provide: AuthService, useValue: { snapshot: () => ({
        activeAccountId: 'synthetic-account', activeAccountMeta: { username: 'synthetic-user' },
      }) } },
      { provide: AccountStoreService, useValue: {
        prewarmActivePassword: () => Promise.resolve(),
        getPassword: () => Promise.resolve('synthetic-password'),
      } },
      { provide: ListsService, useValue: {} },
      { provide: AccountPreferencesService, useValue: {} },
      { provide: AppCacheService, useValue: {} },
      { provide: LocationsService, useValue: {} },
    ] });
    const http = TestBed.inject(HttpTestingController);
    TestBed.inject(CacheWarmService).warmForActiveAccount();
    await new Promise(resolve => setTimeout(resolve, 0));
    const request = http.expectOne('https://example.org/API/CacheWarm');
    expect(request.request.method).toBe('POST');
    const body = new URLSearchParams(request.request.body);
    expect(body.get('historyCoordinator')).toBe('1');
    expect(body.get('username')).toBe('synthetic-user');
    expect(body.get('password')).toBe('synthetic-password');
    request.flush({ ok: true });
    http.verify();
  });
});
