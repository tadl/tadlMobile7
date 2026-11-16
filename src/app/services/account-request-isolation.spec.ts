import { TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { Observable } from 'rxjs';

import { Globals } from '../globals';
import { AccountStoreService } from './account-store.service';
import { AppCacheService } from './app-cache.service';
import { AuthService, type AuthState } from './auth.service';
import { FinesService } from './fines.service';
import { ListsService } from './lists.service';

for (const kind of ['lists', 'fines'] as const) {
  describe(`${kind} account request isolation`, () => {
    let http: HttpTestingController;
    let active: AuthState;
    let fetch: () => Observable<unknown>;
    let cache: jasmine.SpyObj<AppCacheService>;
    const method = kind === 'lists' ? 'getUserLists' : 'getPatronFines';

    function account(id: string): AuthState {
      return {
        isLoggedIn: true, activeAccountId: id,
        activeAccountMeta: { id, username: `synthetic-${id}`, label: 'Example patron' }, profile: null,
      };
    }

    function payload(label: string) {
      return { result: {
        success: true, lists: [{ id: 301, title: label }],
        fines: [{ reason: label, amountOutstandingVal: 3 }], totalOwed: 3,
      } };
    }

    function expected(label: string) {
      return kind === 'lists'
        ? jasmine.arrayContaining([jasmine.objectContaining({ title: label })])
        : jasmine.objectContaining({ fines: [jasmine.objectContaining({ reason: label })] });
    }

    beforeEach(() => {
      active = account('account-a');
      cache = jasmine.createSpyObj<AppCacheService>('AppCacheService', ['read', 'write']);
      cache.read.and.resolveTo(null);
      cache.write.and.resolveTo();
      TestBed.configureTestingModule({ providers: [
        provideHttpClient(), provideHttpClientTesting(),
        { provide: Globals, useValue: {
          aspen_api_base: 'https://api.example.org/API', aspen_api_host: 'https://api.example.org',
          aspen_discovery_base: 'https://catalog.example.org',
        } },
        { provide: AuthService, useValue: { snapshot: () => active } },
        { provide: AccountStoreService, useValue: { getPassword: (id: string) => Promise.resolve(`synthetic-password-${id}`) } },
        { provide: AppCacheService, useValue: cache },
      ] });
      http = TestBed.inject(HttpTestingController);
      const lists = TestBed.inject(ListsService);
      const fines = TestBed.inject(FinesService);
      fetch = () => kind === 'lists' ? lists.fetchUserLists() : fines.fetchPatronFines();
    });

    afterEach(() => http.verify());

    it('keeps simultaneous account requests separate and still deduplicates the same account', fakeAsync(() => {
      const first: unknown[] = [];
      const second: unknown[] = [];
      fetch().subscribe(value => first.push(value));
      flushMicrotasks();
      const requestA = http.expectOne(req => req.params.get('method') === method);
      expect(new URLSearchParams(requestA.request.body).get('username')).toBe('synthetic-account-a');

      active = account('account-b');
      fetch().subscribe(value => second.push(value));
      fetch().subscribe(value => second.push(value));
      flushMicrotasks();
      const requestB = http.expectOne(req => req.params.get('method') === method);
      expect(new URLSearchParams(requestB.request.body).get('username')).toBe('synthetic-account-b');
      expect(new URLSearchParams(requestB.request.body).get('password')).toBe('synthetic-password-account-b');

      requestA.flush(payload('Example account A'));
      flushMicrotasks();
      expect(first).toEqual([expected('Example account A')]);
      expect(second).toEqual([]);

      // Completion of A must not remove B's in-flight request.
      fetch().subscribe(value => second.push(value));
      flushMicrotasks();
      http.expectNone(req => req.params.get('method') === method);
      requestB.flush(payload('Example account B'));
      flushMicrotasks();
      expect(second).toEqual([
        expected('Example account B'), expected('Example account B'), expected('Example account B'),
      ]);
      if (kind === 'lists') {
        expect(cache.write).toHaveBeenCalledWith('lists:user:account-a', expected('Example account A'));
        expect(cache.write).toHaveBeenCalledWith('lists:user:account-b', expected('Example account B'));
      }

      fetch().subscribe();
      flushMicrotasks();
      http.expectOne(req => req.params.get('method') === method).flush(payload('Example refreshed account B'));
      flushMicrotasks();
    }));

    it('cancels only the departing account request when its last subscriber leaves', fakeAsync(() => {
      const first = fetch().subscribe();
      flushMicrotasks();
      const requestA = http.expectOne(req => req.params.get('method') === method);
      active = account('account-b');
      const second: unknown[] = [];
      fetch().subscribe(value => second.push(value));
      flushMicrotasks();
      const requestB = http.expectOne(req => req.params.get('method') === method);
      first.unsubscribe();
      flushMicrotasks();
      expect(requestA.cancelled).toBeTrue();
      fetch().subscribe(value => second.push(value));
      flushMicrotasks();
      http.expectNone(req => req.params.get('method') === method);
      requestB.flush(payload('Example account B'));
      flushMicrotasks();
      expect(second).toEqual([expected('Example account B'), expected('Example account B')]);
    }));
  });
}
