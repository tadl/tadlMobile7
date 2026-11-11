import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { Globals } from '../globals';
import { AppCacheService } from './app-cache.service';
import { AppConfigService } from './app-config.service';
import { AppConfig, parseAppConfig } from './app-config.types';

const backend = 'synthetic-prod';
const endpoint = 'https://example.org/API/AppConfig';

function configFixture(): AppConfig {
  return {
    schemaVersion: 1,
    backend,
    revision: 'synthetic-revision-1',
    locations: [{
      evergreenId: 501,
      aspenId: 31,
      pickupCode: 'EXAMPLE-MAIN',
      shortname: 'example-main',
      name: 'Example Main Library',
      pickupEnabled: true,
    }, {
      evergreenId: 502,
      aspenId: null,
      pickupCode: null,
      shortname: 'example-retired',
      name: 'Example Former Branch',
      pickupEnabled: false,
    }],
    searchScopes: [{ id: 'all', name: 'All Libraries', filters: [] }],
  };
}

describe('App config validation', () => {
  it('preserves display order, new locations, search filters, and disabled historical labels', () => {
    const config = configFixture();
    config.locations.unshift({
      evergreenId: 503, aspenId: 32, pickupCode: 'EXAMPLE-NEW',
      shortname: 'example-new', name: 'Example New Branch', pickupEnabled: true,
    });
    config.searchScopes.push({ id: 'main', name: 'Main Library', filters: ['building:Main Library'] });
    expect(parseAppConfig(config, backend)).toEqual(config);
  });

  it('rejects unknown schemas, mismatched backends, and missing revisions', () => {
    expect(parseAppConfig({ ...configFixture(), schemaVersion: 2 }, backend)).toBeNull();
    expect(parseAppConfig(configFixture(), 'another-prod')).toBeNull();
    expect(parseAppConfig({ ...configFixture(), revision: '' }, backend)).toBeNull();
  });

  it('rejects string IDs and incomplete or duplicate pickup mappings', () => {
    const config = configFixture();
    expect(parseAppConfig({ ...config, locations: [{ ...config.locations[0], evergreenId: '501' }] }, backend)).toBeNull();
    expect(parseAppConfig({ ...config, locations: [{ ...config.locations[0], aspenId: null }] }, backend)).toBeNull();
    expect(parseAppConfig({ ...config, locations: [{ ...config.locations[0], pickupCode: null }] }, backend)).toBeNull();
    for (const duplicate of ['evergreenId', 'aspenId', 'pickupCode', 'shortname'] as const) {
      const second = {
        evergreenId: 503, aspenId: 32, pickupCode: 'EXAMPLE-NEW',
        shortname: 'example-new', name: 'Example New Branch', pickupEnabled: true,
        [duplicate]: config.locations[0][duplicate],
      };
      expect(parseAppConfig({ ...config, locations: [config.locations[0], second] }, backend)).toBeNull();
    }
  });

  it('rejects empty usable mappings, duplicate search scopes, and unsafe or excessive values', () => {
    const config = configFixture();
    expect(parseAppConfig({ ...config, locations: [] }, backend)).toBeNull();
    expect(parseAppConfig({ ...config, locations: [config.locations[1]] }, backend)).toBeNull();
    expect(parseAppConfig({ ...config, searchScopes: [config.searchScopes[0], config.searchScopes[0]] }, backend)).toBeNull();
    expect(parseAppConfig({ ...config, searchScopes: [{ id: 'x', name: 'X', filters: ['bad\nfilter'] }] }, backend)).toBeNull();
    expect(parseAppConfig({ ...config, locations: [{ ...config.locations[0], name: 'x'.repeat(161) }] }, backend)).toBeNull();
  });

  it('requires the reserved default search scope to mean an unfiltered search', () => {
    const config = configFixture();
    expect(parseAppConfig({ ...config, searchScopes: [{ id: 'main', name: 'Main', filters: [] }] }, backend)).toBeNull();
    expect(parseAppConfig({ ...config, searchScopes: [{ id: 'all', name: 'All', filters: ['building:Main'] }] }, backend)).toBeNull();
    expect(parseAppConfig(config, backend)).toEqual(config);
  });
});

describe('AppConfigService', () => {
  let http: HttpTestingController;
  let service: AppConfigService;
  let cache: jasmine.SpyObj<AppCacheService>;
  let globals: {
    aspen_api_base: string;
    aspen_api_param_api: string;
    applyAppConfig: jasmine.Spy;
  };

  beforeEach(() => {
    globals = {
      aspen_api_base: 'https://example.org/API',
      aspen_api_param_api: backend,
      applyAppConfig: jasmine.createSpy('applyAppConfig'),
    };
    cache = jasmine.createSpyObj<AppCacheService>('AppCacheService', ['read', 'write']);
    cache.read.and.resolveTo(null);
    cache.write.and.resolveTo();
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(), provideHttpClientTesting(),
      { provide: Globals, useValue: globals },
      { provide: AppCacheService, useValue: cache },
    ] });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(AppConfigService);
  });

  afterEach(() => http.verify());

  it('loads valid cached config before startup finishes and refreshes without authentication', fakeAsync(() => {
    const cached = configFixture();
    cache.read.and.resolveTo(cached);
    let initialized = false;
    void service.initialize().then(() => { initialized = true; });
    flushMicrotasks();
    expect(initialized).toBeTrue();
    expect(globals.applyAppConfig).toHaveBeenCalledOnceWith(cached);
    const request = http.expectOne(req => req.url === endpoint);
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('api')).toBe(backend);
    expect(request.request.headers.get('x-skip-global-loading')).toBe('1');
    expect(request.request.headers.has('Authorization')).toBeFalse();
    request.flush({ ...cached, revision: 'synthetic-revision-2' });
    flushMicrotasks();
    expect(globals.applyAppConfig.calls.mostRecent().args[0].revision).toBe('synthetic-revision-2');
    expect(cache.write).toHaveBeenCalledOnceWith(
      `app-config:v1:${encodeURIComponent('https://example.org/API')}:${backend}`,
      { ...cached, revision: 'synthetic-revision-2' }
    );
  }));

  it('retains valid cached config during a network failure', fakeAsync(() => {
    const cached = configFixture();
    cache.read.and.resolveTo(cached);
    void service.initialize();
    flushMicrotasks();
    http.expectOne(req => req.url === endpoint).flush('Unavailable', { status: 503, statusText: 'Unavailable' });
    flushMicrotasks();
    expect(globals.applyAppConfig).toHaveBeenCalledOnceWith(cached);
    expect(cache.write).not.toHaveBeenCalled();
  }));

  it('rejects cached and network config for another backend without replacing the fallback', fakeAsync(() => {
    cache.read.and.resolveTo({ ...configFixture(), backend: 'another-prod' });
    void service.initialize();
    flushMicrotasks();
    http.expectOne(req => req.url === endpoint).flush({ ...configFixture(), schemaVersion: 2 });
    flushMicrotasks();
    expect(globals.applyAppConfig).not.toHaveBeenCalled();
    expect(cache.write).not.toHaveBeenCalled();
  }));

  it('deduplicates initialization and refreshes, then permits a refresh after five minutes', fakeAsync(() => {
    expect(service.initialize()).toBe(service.initialize());
    flushMicrotasks();
    const firstRefresh = service.refresh();
    expect(service.refresh()).toBe(firstRefresh);
    http.expectOne(req => req.url === endpoint).flush(configFixture());
    flushMicrotasks();
    void service.refresh();
    http.expectNone(req => req.url === endpoint);
    tick(5 * 60 * 1000);
    void service.refresh();
    http.expectOne(req => req.url === endpoint).flush(configFixture());
    flushMicrotasks();
    expect(cache.read).toHaveBeenCalledTimes(1);
    expect(globals.applyAppConfig).toHaveBeenCalledTimes(2);
  }));

  it('bounds network time and retains fallback when storage is unavailable', fakeAsync(() => {
    cache.read.and.rejectWith(new Error('synthetic-storage-failure'));
    void service.initialize();
    flushMicrotasks();
    const request = http.expectOne(req => req.url === endpoint);
    tick(5000);
    flushMicrotasks();
    expect(request.cancelled).toBeTrue();
    expect(globals.applyAppConfig).not.toHaveBeenCalled();
    expect(cache.write).not.toHaveBeenCalled();
    tick(25000);
    void service.refresh();
    http.expectOne(req => req.url === endpoint).flush(configFixture());
    flushMicrotasks();
    expect(globals.applyAppConfig).toHaveBeenCalledOnceWith(configFixture());
  }));

  it('does not apply a late cache read over a newer network config', fakeAsync(() => {
    let finishRead: (value: AppConfig) => void = () => { throw new Error('read not started'); };
    cache.read.and.returnValue(new Promise<AppConfig>(resolve => { finishRead = resolve; }));
    void service.initialize();
    void service.refresh();
    const fresh = { ...configFixture(), revision: 'synthetic-revision-2' };
    http.expectOne(req => req.url === endpoint).flush(fresh);
    flushMicrotasks();
    finishRead(configFixture());
    flushMicrotasks();
    expect(globals.applyAppConfig).toHaveBeenCalledOnceWith(fresh);
  }));
});
