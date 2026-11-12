import { TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { Globals } from '../globals';
import { AppCacheService } from './app-cache.service';
import {
  ItemService,
  type AspenFormatVariationsResult,
  type AspenGroupedWork,
  type AspenItemAvailabilityResult,
} from './item.service';

describe('ItemService Aspen API contracts', () => {
  let http: HttpTestingController;
  let service: ItemService;

  const workId = 'synthetic-grouped-work-eng';
  const legacyHold = "return AspenDiscovery.Record.showPlaceHold('Record', 'ils', '901001', '', '701', this);";
  const currentHold = "return AspenDiscovery.Record.showPlaceHold('Record', 'ils', '901001', '', '701', this, true, 'Book');";

  beforeEach(() => {
    const cache = jasmine.createSpyObj<AppCacheService>('AppCacheService', ['read', 'write']);
    cache.read.and.resolveTo(null);
    cache.write.and.resolveTo();
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(), provideHttpClientTesting(),
      { provide: Globals, useValue: {
        aspen_api_base: 'https://api.example.org/API',
        aspen_api_host: 'https://api.example.org',
        aspen_discovery_base: 'https://catalog.example.org',
      } },
      { provide: AppCacheService, useValue: cache },
    ] });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(ItemService);
  });

  afterEach(() => http.verify());

  // Aspen 26.08 wraps these responses in result; older versions return the object directly.
  for (const wrapped of [false, true]) {
    const envelope = wrapped ? '26.08 wrapped' : 'legacy unwrapped';

    it(`retains grouped work formats and hold actions from a ${envelope} response`, fakeAsync(() => {
      const action = { title: 'Place Hold', type: 'ils_hold', onclick: wrapped ? currentHold : legacyHold };
      const fixture = {
        success: true, id: workId, title: 'Synthetic title',
        cover: 'https://api.example.org/bookcover.php?id=synthetic&amp;size=large',
        formats: { Book: { label: 'Book', category: 'Books', actions: [action], isAvailable: true } },
      };
      const received: AspenGroupedWork[] = [];
      service.getGroupedWork(workId).subscribe(work => received.push(work));
      flushMicrotasks();
      const request = http.expectOne(req => req.url.endsWith('/WorkAPI'));
      expect(request.request.method).toBe('GET');
      expect(request.request.params.get('method')).toBe('getGroupedWork');
      expect(request.request.params.get('id')).toBe(workId);
      request.flush(wrapped ? { result: fixture } : fixture);
      flushMicrotasks();

      expect(received.length).toBe(1);
      expect(received[0].title).toBe('Synthetic title');
      expect(received[0].cover).toBe('https://catalog.example.org/bookcover.php?id=synthetic&size=large');
      expect(received[0].formats?.['Book'].actions).toEqual([action]);
      expect(service.extractIlsIdsFromGroupedWork(received[0])).toEqual(['901001']);
    }));

    it(`retains physical holdings from a ${envelope} response and requests the bare ILS ID`, fakeAsync(() => {
      const fixture: AspenItemAvailabilityResult = {
        id: '901001',
        holdings: { Example_Main: [{
          id: 'ils:901001', location: 'Example Main', callnumber: 'SYNTHETIC FICTION',
          status: 'On Shelf', availability: true, holdable: 1,
        }] },
      };
      const received: AspenItemAvailabilityResult[] = [];
      service.getIlsItemAvailability('ils:901001').subscribe(result => received.push(result));
      flushMicrotasks();
      const request = http.expectOne(req => req.url.endsWith('/ItemAPI'));
      expect(request.request.params.get('method')).toBe('getItemAvailability');
      expect(request.request.params.get('id')).toBe('901001');
      request.flush(wrapped ? { result: fixture } : fixture);
      flushMicrotasks();

      expect(received).toEqual([fixture]);
    }));

    it(`retains format variation actions and availability from a ${envelope} response`, fakeAsync(() => {
      const action = { title: 'Place Hold', type: 'ils_hold', onclick: wrapped ? currentHold : legacyHold };
      const fixture = {
        success: true, id: workId, format: 'Book',
        variations: { 'Synthetic edition': {
          id: 'ils:901001', source: 'ils', actions: [action],
          statusIndicator: { isAvailable: true, isEContent: false, groupedStatus: 'On Shelf', numHolds: 2 },
        } },
      };
      const received: AspenFormatVariationsResult[] = [];
      service.getFormatVariations(workId, 'Book').subscribe(result => received.push(result));
      flushMicrotasks();
      const request = http.expectOne(req => req.url.endsWith('/ItemAPI'));
      expect(request.request.params.get('method')).toBe('getVariations');
      expect(request.request.params.get('id')).toBe(workId);
      expect(request.request.params.get('format')).toBe('Book');
      request.flush(wrapped ? { result: fixture } : fixture);
      flushMicrotasks();

      expect(received.length).toBe(1);
      expect(received[0].success).toBeTrue();
      const variation = received[0].variations['Synthetic edition'];
      expect(variation.id).toBe('ils:901001');
      expect(variation.actions).toEqual([action]);
      expect(variation.statusIndicator).toEqual(jasmine.objectContaining({
        isAvailable: true, isEContent: false, groupedStatus: 'On Shelf', numHolds: 2,
      }));
    }));
  }

  it('extracts the same ILS ID from old, 26.08 and edition hold actions', () => {
    for (const onclick of [legacyHold, currentHold, legacyHold.replace('showPlaceHold(', 'showPlaceHoldEditions(')]) {
      expect(service.extractIlsIdFromOnclick(onclick)).toBe('901001');
    }
    expect(service.extractIlsIdFromOnclick(currentHold.replace("'ils'", "'overdrive'"))).toBeNull();
    expect(service.extractIlsIdFromOnclick(undefined)).toBeNull();
  });
});
