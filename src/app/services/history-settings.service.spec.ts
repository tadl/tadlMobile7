import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HistorySettingsService } from './history-settings.service';
import { AppCacheService } from './app-cache.service';
import { Globals } from '../globals';

describe('HistorySettingsService', () => {
  let http: HttpTestingController;
  let service: HistorySettingsService;
  let remove: jasmine.Spy;

  beforeEach(() => {
    remove = jasmine.createSpy('removeByPrefixes').and.resolveTo();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(),
        { provide: Globals, useValue: { aspen_api_base: 'https://example.org/API' } },
        { provide: AppCacheService, useValue: { removeByPrefixes: remove } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(HistorySettingsService);
  });

  afterEach(() => http.verify());

  it('clears the account history cache and posts an explicit opt-out without credentials in the URL', async () => {
    let completed: boolean | undefined;
    service.update('synthetic-account', 'synthetic-user', 'synthetic-password', false)
      .subscribe(result => completed = result.complete);
    await new Promise(resolve => setTimeout(resolve, 0));
    const request = http.expectOne('https://example.org/API/ReadingHistory');
    expect(request.request.method).toBe('POST');
    const body = new URLSearchParams(request.request.body);
    expect(body.get('enabled')).toBe('false');
    expect(body.get('password')).toBe('synthetic-password');
    expect(remove).toHaveBeenCalledWith(['history:synthetic-account:']);
    request.flush({ result: { success: true, complete: false, historyStatus: 'pending' } });
    expect(completed).toBeFalse();
  });

  it('checks pending operation status without issuing a second preference change', async () => {
    service.status('synthetic-account', 'synthetic-user', 'synthetic-password').subscribe();
    await new Promise(resolve => setTimeout(resolve, 0));
    const request = http.expectOne('https://example.org/API/ReadingHistory');
    const body = new URLSearchParams(request.request.body);
    expect(body.get('operation')).toBe('status');
    expect(body.has('enabled')).toBeFalse();
    request.flush({ result: { success: true, complete: true, historyStatus: 'disabled' } });
  });
});
