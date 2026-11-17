import { TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { Globals } from '../globals';
import { AppCacheService } from './app-cache.service';
import {
  ItemService,
  type AspenFormatVariationsResult,
  type AspenFormatRecordsResult,
  type AspenGroupedWork,
  type AspenItemAvailabilityResult,
} from './item.service';

describe('ItemService Aspen API contracts', () => {
  let http: HttpTestingController;
  let service: ItemService;
  let cache: jasmine.SpyObj<AppCacheService>;

  const workId = 'synthetic-grouped-work-eng';
  const legacyHold = "return AspenDiscovery.Record.showPlaceHold('Record', 'ils', '901001', '', '701', this);";
  const currentHold = "return AspenDiscovery.Record.showPlaceHold('Record', 'ils', '901001', '', '701', this, true, 'Book');";

  beforeEach(() => {
    cache = jasmine.createSpyObj<AppCacheService>('AppCacheService', ['read', 'write']);
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

    it(`keeps bibliographic editions separate in a ${envelope} response`, fakeAsync(() => {
      const fixture = {
        success: true, id: workId, format: 'Book',
        records: {
          'ils:901001': {
            id: 'ils:901001', source: 'ils', format: 'Book',
            edition: 'First edition.', publisher: 'Example Press',
            publicationDate: '2020', placeOfPublication: 'Example City',
            physical: '388 pages ; 23 cm.',
          },
          'ils:901002': {
            id: 'ils:901002', source: 'ils', format: 'Book',
            edition: 'Revised edition.', publisher: 'Example Press',
            publicationDate: '2025', placeOfPublication: 'Example City',
            physical: '412 pages : illustrations ; 25 cm.',
          },
        },
      };
      const received: AspenFormatRecordsResult[] = [];
      service.getFormatRecords(workId, 'Book', 'ils').subscribe(result => received.push(result));
      flushMicrotasks();
      const request = http.expectOne(req => req.url.endsWith('/ItemAPI'));
      expect(request.request.method).toBe('GET');
      expect(request.request.params.get('method')).toBe('getRecords');
      expect(request.request.params.get('id')).toBe(workId);
      expect(request.request.params.get('format')).toBe('Book');
      expect(request.request.params.get('source')).toBe('ils');
      request.flush(wrapped ? { result: fixture } : fixture);
      flushMicrotasks();

      expect(received[0].records.map(record => [record.id, record.edition, record.physical])).toEqual([
        ['ils:901001', 'First edition.', '388 pages ; 23 cm.'],
        ['ils:901002', 'Revised edition.', '412 pages : illustrations ; 25 cm.'],
      ]);
      expect(cache.write).toHaveBeenCalledWith(`item:records:${workId}:Book:ils`, received[0]);
    }));
  }

  it('emits saved holdings before a failed refresh without overwriting the cache', fakeAsync(() => {
    const saved: AspenItemAvailabilityResult = {
      id: '901001',
      holdings: { Example_Main: [{ location: 'Example Main', status: 'On Shelf' }] },
    };
    cache.read.and.resolveTo(saved);
    const received: AspenItemAvailabilityResult[] = [];
    let failure: unknown;
    service.getIlsItemAvailability('901001').subscribe({
      next: (value) => received.push(value),
      error: (error: unknown) => failure = error,
    });
    flushMicrotasks();
    expect(received).toEqual([saved]);

    http.expectOne(req => req.params.get('method') === 'getItemAvailability')
      .error(new ProgressEvent('error'));
    flushMicrotasks();
    expect(received).toEqual([saved]);
    expect(failure).toBeDefined();
    expect(cache.write).not.toHaveBeenCalled();
  }));

  it('ignores malformed or mismatched holdings caches and still requests current data', fakeAsync(() => {
    const invalidCaches: unknown[] = [
      { id: 'other-record', holdings: {} },
      { id: '901001' },
      { id: '901001', holdings: 'invalid' },
      { id: '901001', holdings: [{}] },
      { id: '901001', holdings: { Example_Main: {} } },
      { id: '901001', holdings: { Example_Main: [null] } },
      { id: '901001', holdings: { Example_Main: [{ location: { unexpected: true } }] } },
      { id: '901001', holdings: { Example_Main: [{ location: 'Example Main', availability: {} }] } },
    ];
    for (const invalidCache of invalidCaches) {
      cache.read.and.resolveTo(invalidCache);
      const received: AspenItemAvailabilityResult[] = [];
      service.getIlsItemAvailability('901001').subscribe(value => received.push(value));
      flushMicrotasks();
      expect(received).toEqual([]);

      http.expectOne(req => req.params.get('method') === 'getItemAvailability')
        .flush({ result: { id: '901001', holdings: [] } });
      flushMicrotasks();
      expect(received).toEqual([{ id: '901001', holdings: {} }]);
    }
  }));

  it('treats invalid live holdings as a refresh failure and retains the saved result', fakeAsync(() => {
    const saved: AspenItemAvailabilityResult = {
      id: '901001', holdings: { Example_Main: [{ location: 'Example Main' }] },
    };
    cache.read.and.resolveTo(saved);
    for (const invalid of [
      { id: '901001', success: false, holdings: {} },
      { id: '901002', holdings: {} },
      { id: '901001', holdings: { Example_Main: [null] } },
    ]) {
      const received: AspenItemAvailabilityResult[] = [];
      let failure: Error | undefined;
      service.getIlsItemAvailability('901001').subscribe({
        next: (value) => received.push(value),
        error: (error: Error) => failure = error,
      });
      flushMicrotasks();
      http.expectOne(req => req.params.get('method') === 'getItemAvailability').flush(invalid);
      flushMicrotasks();
      expect(received).toEqual([saved]);
      expect(failure?.message).toBe('invalid_item_availability');
    }
    expect(cache.write).not.toHaveBeenCalled();
  }));

  it('normalizes valid scalar holdings fields and caches a successful zero-copy refresh', fakeAsync(() => {
    const received: AspenItemAvailabilityResult[] = [];
    service.getIlsItemAvailability('901001').subscribe(value => received.push(value));
    flushMicrotasks();
    http.expectOne(req => req.params.get('method') === 'getItemAvailability').flush({
      id: 901001, holdings: { Example_Main: [{
        location: ' Example Main ', availability: 1, sectionId: '7', number: 0,
        dueDate: null, status: 'On Shelf',
      }] },
    });
    flushMicrotasks();
    expect(received).toEqual([{
      id: '901001', holdings: { Example_Main: [{
        location: 'Example Main', availability: true, sectionId: 7, number: 0,
        status: 'On Shelf',
      }] },
    }]);

    service.getIlsItemAvailability('901001').subscribe(value => received.push(value));
    flushMicrotasks();
    http.expectOne(req => req.params.get('method') === 'getItemAvailability')
      .flush({ id: '901001', holdings: {} });
    flushMicrotasks();
    expect(received[1]).toEqual({ id: '901001', holdings: {} });
    expect(cache.write).toHaveBeenCalledWith('item:availability:901001', received[1]);
  }));

  it('normalizes numeric publication years, array metadata and missing physical details', fakeAsync(() => {
    let result: AspenFormatRecordsResult | undefined;
    service.getFormatRecords(workId, 'eAudiobook', 'hoopla').subscribe(value => result = value);
    flushMicrotasks();
    http.expectOne(req => req.params.get('method') === 'getRecords').flush({
      success: true, id: workId, format: 'eAudiobook',
      records: { 'hoopla:901003': {
        source: 'hoopla', format: 'eAudiobook', edition: null,
        publisher: ['Example Audio', 'Example Distributor'], publicationDate: 2025,
        physical: null,
      } },
    });
    flushMicrotasks();
    expect(result?.records[0]).toEqual(jasmine.objectContaining({
      id: 'hoopla:901003', recordId: '901003', source: 'hoopla',
      publicationDate: '2025', publisher: 'Example Audio; Example Distributor',
      edition: '', physical: '',
    }));
  }));

  it('accepts empty record arrays and isolates caches by format and source', fakeAsync(() => {
    for (const [format, source] of [['Book', 'ils'], ['Large Print', 'ils'], ['eBook', 'overdrive']]) {
      let result: AspenFormatRecordsResult | undefined;
      service.getFormatRecords(workId, format, source).subscribe(value => result = value);
      flushMicrotasks();
      const request = http.expectOne(req => req.params.get('format') === format);
      expect(request.request.params.get('source')).toBe(source);
      request.flush({ result: { success: true, id: workId, format, records: [] } });
      flushMicrotasks();
      expect(result?.records).toEqual([]);
      expect(cache.read).toHaveBeenCalledWith(`item:records:${workId}:${format}:${source}`);
      expect(cache.write).toHaveBeenCalledWith(`item:records:${workId}:${format}:${source}`, result);
    }
  }));

  it('rejects responses for another work or format without caching them', fakeAsync(() => {
    for (const identity of [{ id: 'other-work', format: 'Book' }, { id: workId, format: 'Large Print' }, { id: workId, format: 'Book', success: false }]) {
      let result: AspenFormatRecordsResult | undefined;
      service.getFormatRecords(workId, 'Book', 'ils').subscribe(value => result = value);
      flushMicrotasks();
      http.expectOne(req => req.params.get('method') === 'getRecords').flush({
        success: true, ...identity, records: {},
      });
      flushMicrotasks();
      expect(result?.success).toBeFalse();
      expect(result?.records).toEqual([]);
    }
    expect(cache.write).not.toHaveBeenCalled();
  }));

  it('ignores records from another source or format', fakeAsync(() => {
    let result: AspenFormatRecordsResult | undefined;
    service.getFormatRecords(workId, 'Book', 'ils').subscribe(value => result = value);
    flushMicrotasks();
    http.expectOne(req => req.params.get('method') === 'getRecords').flush({
      success: true, id: workId, format: 'Book', records: {
        'ils:901001': { source: 'ils', format: 'Large Print', physical: '600 pages' },
        'hoopla:901002': { source: 'hoopla', format: 'Book', physical: '300 pages' },
        'ils:901003': { id: 'overdrive:901003', source: 'ils', format: 'Book', physical: '300 pages' },
      },
    });
    flushMicrotasks();
    expect(result?.records).toEqual([]);
  }));

  it('extracts the same ILS ID from old, 26.08 and edition hold actions', () => {
    for (const onclick of [legacyHold, currentHold, legacyHold.replace('showPlaceHold(', 'showPlaceHoldEditions(')]) {
      expect(service.extractIlsIdFromOnclick(onclick)).toBe('901001');
    }
    expect(service.extractIlsIdFromOnclick(currentHold.replace("'ils'", "'overdrive'"))).toBeNull();
    expect(service.extractIlsIdFromOnclick(undefined)).toBeNull();
  });
});
