import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { Globals } from '../globals';
import { AccountStoreService } from './account-store.service';
import { AuthService } from './auth.service';
import { SearchService, type AspenSearchResult } from './search.service';

describe('SearchService Aspen API contracts', () => {
  let http: HttpTestingController;
  let service: SearchService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(), provideHttpClientTesting(),
      { provide: Globals, useValue: {
        aspen_api_base: 'https://api.example.org/API',
        aspen_api_host: 'https://api.example.org',
        aspen_discovery_base: 'https://catalog.example.org',
      } },
      { provide: AuthService, useValue: { snapshot: () => ({ isLoggedIn: false }) } },
      { provide: AccountStoreService, useValue: {} },
    ] });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(SearchService);
  });

  afterEach(() => http.verify());

  for (const keyed of [false, true]) {
    it(`reads plain 26.08 format labels with ${keyed ? 'keyed' : 'array'} item references and list memberships`, () => {
      const item = { id: 'ils:901001', name: 'Book', source: 'ils' };
      const list = { id: 301, title: 'Synthetic reading list' };
      const facets = { format: { label: 'Format', list: {
        Book: { value: 'Book', display: 'Book', count: 21, isApplied: true },
      } } };
      let received: AspenSearchResult | undefined;
      service.getAppSearchResults({
        lookfor: 'synthetic title', page: 2, pageSize: 20,
        filters: ['format:"Book"', 'language:"English"'], sort: 'year desc,title asc',
      }).subscribe(result => { received = result; });
      const request = http.expectOne(req => req.url.endsWith('/SearchAPI'));
      expect(request.request.method).toBe('POST');
      expect(request.request.params.get('method')).toBe('searchLite');
      expect(request.request.params.getAll('filter[]')).toEqual(['format:"Book"', 'language:"English"']);
      expect(request.request.params.get('sort')).toBe('year desc,title asc');
      request.flush({ result: {
        success: true, lookfor: 'synthetic title', totalResults: 41,
        paging: { currentPage: 2, itemsPerPage: 20, totalItems: 41, totalPages: 3 },
        options: facets,
        items: [{
          key: 'synthetic-grouped-work-eng', title: 'Synthetic &amp; Example', format: ['Book'],
          image: '/bookcover.php?id=synthetic',
          itemList: keyed ? { physical: item } : [item],
          appearsOnLists: keyed ? { synthetic: list } : [list],
        }],
      } });

      expect(received?.success).toBeTrue();
      expect(received?.totalResults).toBe(41);
      expect(received?.page).toBe(2);
      expect(received?.totalPages).toBe(3);
      expect(received?.facets).toEqual(facets);
      expect(received?.hits.length).toBe(1);
      expect(received?.hits[0]).toEqual(jasmine.objectContaining({
        key: 'synthetic-grouped-work-eng', title: 'Synthetic & Example', format: ['Book'],
        coverUrl: 'https://catalog.example.org/bookcover.php?id=synthetic',
        itemList: [item], appearsOnLists: [{ id: '301', title: 'Synthetic reading list' }],
      }));
    });
  }

  it('preserves a search failure instead of reporting successful empty results', () => {
    let received: AspenSearchResult | undefined;
    service.getAppSearchResults({ lookfor: 'synthetic title' }).subscribe(result => { received = result; });
    http.expectOne(req => req.url.endsWith('/SearchAPI')).flush({ result: {
      success: false, items: [], totalResults: 0, message: 'Synthetic search unavailable',
    } });
    expect(received?.success).toBeFalse();
    expect(received?.hits).toEqual([]);
    expect(received?.raw.message).toBe('Synthetic search unavailable');
  });
});
