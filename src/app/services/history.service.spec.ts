import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ModalController } from '@ionic/angular/lazy';

import { Globals } from '../globals';
import { CheckoutHistoryPage } from '../pages/checkout-history/checkout-history.page';
import { AccountStoreService } from './account-store.service';
import { AppCacheService } from './app-cache.service';
import { AuthService } from './auth.service';
import { FormatFamilyService } from './format-family.service';
import { ToastService } from './toast.service';

describe('First-login checkout history import', () => {
  let http: HttpTestingController;
  let cache: jasmine.SpyObj<AppCacheService>;

  beforeEach(() => {
    cache = jasmine.createSpyObj<AppCacheService>('AppCacheService', ['removeByPrefixes', 'write', 'read']);
    cache.removeByPrefixes.and.resolveTo();
    cache.read.and.resolveTo(null);
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
      { provide: FormatFamilyService, useValue: {} },
      { provide: ModalController, useValue: {} },
    ] });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('shows import progress with an empty local cache, then displays history when the server is ready', fakeAsync(() => {
    const page = TestBed.runInInjectionContext(() => new CheckoutHistoryPage());
    page.ionViewWillEnter();
    flushMicrotasks();
    const first = http.expectOne(req => req.url.endsWith('/ReadingHistory'));
    expect(first.request.params.get('operation')).toBe('read');
    expect(first.request.urlWithParams).not.toContain('synthetic-password');
    expect(new URLSearchParams(first.request.body).get('username')).toBe('synthetic-user');
    first.flush({ result: {
      success: true, readingHistory: [], totalResults: 0,
      historyStatus: 'importing', message: 'Importing your checkout history.',
    } });
    flushMicrotasks();
    expect(page.items).toEqual([]);
    expect(page.historyMessage).toBe('Importing your checkout history.');
    expect(page.loading).toBeTrue();

    tick(5000);
    http.expectOne(req => req.url.endsWith('/ReadingHistory')).flush({ result: {
      success: true, historyStatus: 'ready', totalResults: 1, page_current: 1, page_total: 1,
      readingHistory: [{
        id: 'synthetic-history-row', groupedWorkId: 'synthetic-grouped-work-eng',
        title: 'Synthetic title', checkoutTime: 1700000000, checkedOut: false,
      }],
    } });
    flushMicrotasks();
    expect(page.items.length).toBe(1);
    expect(page.items[0].title).toBe('Synthetic title');
    expect(page.historyMessage).toBe('');
    expect(page.loading).toBeFalse();
    expect(cache.read).not.toHaveBeenCalled();
    expect(cache.write).not.toHaveBeenCalled();
    tick(6000);
    http.expectNone(req => req.url.endsWith('/ReadingHistory'));
    page.ionViewDidLeave();
  }));
});
