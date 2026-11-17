import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ActivatedRoute, ParamMap, Router, convertToParamMap } from '@angular/router';
import { Subject } from 'rxjs';

import { APP_TEST_PROVIDERS } from '../../../testing/app-test-providers';
import { Globals } from '../../globals';
import { AuthService } from '../../services/auth.service';
import { HoldSupportService } from '../../services/hold-support.service';
import { HoldsService } from '../../services/holds.service';
import { ListLookupService } from '../../services/list-lookup.service';
import { ListsService } from '../../services/lists.service';
import { SearchService, type AspenSearchOptions, type AspenSearchResult } from '../../services/search.service';
import { ToastService } from '../../services/toast.service';
import { SearchPage } from './search.page';

interface SearchRequest {
  options: AspenSearchOptions;
  response: Subject<AspenSearchResult>;
}

describe('SearchPage request ownership and recovery', () => {
  let fixture: ComponentFixture<SearchPage>;
  let page: SearchPage;
  let requests: SearchRequest[];
  let routeUpdates: Subject<ParamMap>;
  let navigate: jasmine.Spy;
  let globals: { api_loading: boolean; suggest_item_url: string };

  beforeEach(async () => {
    requests = [];
    routeUpdates = new Subject();
    globals = { api_loading: false, suggest_item_url: '' };
    await TestBed.configureTestingModule({
      imports: [SearchPage],
      providers: [
        ...APP_TEST_PROVIDERS,
        { provide: Globals, useValue: globals },
        { provide: SearchService, useValue: {
          getAppSearchResults: (options: AspenSearchOptions) => {
            const response = new Subject<AspenSearchResult>();
            requests.push({ options, response });
            return response;
          },
        } },
        { provide: ActivatedRoute, useValue: { queryParamMap: routeUpdates } },
        { provide: ToastService, useValue: {} },
        { provide: AuthService, useValue: { snapshot: () => ({ isLoggedIn: false }) } },
        { provide: ListsService, useValue: {} },
        { provide: ListLookupService, useValue: {} },
        { provide: HoldsService, useValue: {} },
        { provide: HoldSupportService, useValue: {} },
      ],
    }).compileComponents();
    navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    fixture = TestBed.createComponent(SearchPage);
    page = fixture.componentInstance;
    render();
  });

  it('cancels older queries and never replaces the newest results with a late response', () => {
    search('synthetic alpha');
    search('synthetic beta');
    expect(requests[0].response.observed).toBeFalse();
    expect(page.searchLoading).toBeTrue();
    succeed(1, ['Beta']);
    succeed(0, ['Alpha']);
    expect(page.hits.map(hit => hit.title)).toEqual(['Beta']);
    expect(page.lastExecutedQuery).toBe('synthetic beta');
    expect(page.searchLoading).toBeFalse();
  });

  it('keeps the latest filters and sort while an older search is pending', () => {
    search('synthetic title');
    page.filters = ['format:Book'];
    page.runSearch(true);
    page.sort = 'year desc,title asc';
    page.onSearchOptionsChanged();
    expect(requests[0].response.observed).toBeFalse();
    expect(requests[1].response.observed).toBeFalse();
    expect(requests[2].options.filters).toEqual(['format:Book']);
    expect(requests[2].options.sort).toBe('year desc,title asc');
    succeed(2, ['Filtered newest']);
    succeed(1, ['Older sort']);
    expect(page.hits[0].title).toBe('Filtered newest');
    expect(page.sort).toBe('year desc,title asc');
  });

  it('does not block or clear loading owned by another page', () => {
    globals.api_loading = true;
    search('synthetic title');
    expect(requests.length).toBe(1);
    succeed(0, ['Result']);
    expect(page.hits.length).toBe(1);
    expect(globals.api_loading).toBeTrue();
  });

  it('cancels cleared and destroyed searches before their responses can repopulate results', () => {
    search('synthetic title');
    page.clearSearch();
    expect(requests[0].response.observed).toBeFalse();
    succeed(0, ['Obsolete result']);
    expect(page.hits).toEqual([]);
    expect(page.lookfor).toBe('');
    expect(page.showNoResults).toBeFalse();

    search('synthetic next');
    fixture.destroy();
    expect(requests[1].response.observed).toBeFalse();
    expect(routeUpdates.observed).toBeFalse();
    succeed(1, ['Destroyed result']);
    page.runSearch(true);
    expect(requests.length).toBe(2);
    expect(page.hits).toEqual([]);
  });

  for (const transportFailure of [true, false]) {
    it(`shows a persistent retry state rather than no results after ${transportFailure ? 'a network' : 'an API'} failure`, () => {
      search('synthetic title');
      if (transportFailure) requests[0].response.error(new Error('Synthetic network failure'));
      else {
        requests[0].response.next(result([], { success: false }));
        requests[0].response.complete();
      }
      render();
      expect(fixture.nativeElement.querySelector('.search-error')?.textContent).toContain('Retry');
      expect(fixture.nativeElement.querySelector('.search-empty')).toBeNull();
      page.retrySearch();
      expect(requests.length).toBe(2);
      expect(requests[1].options.lookfor).toBe('synthetic title');
      succeed(1, []);
      render();
      expect(fixture.nativeElement.querySelector('.search-error')).toBeNull();
      expect(fixture.nativeElement.querySelector('.search-empty')?.textContent).toContain('No results.');
    });
  }

  it('retains previously loaded results when refreshing the same criteria fails', () => {
    search('synthetic title');
    succeed(0, ['Existing result']);
    page.runSearch(true);
    expect(page.hits[0].title).toBe('Existing result');
    requests[1].response.error(new Error('Synthetic offline failure'));
    render();
    expect(page.hits[0].title).toBe('Existing result');
    expect(page.searchError).toContain('previous results');
    expect(page.showNoResults).toBeFalse();
    page.retrySearch();
    succeed(2, ['Refreshed result']);
    expect(page.hits.map(hit => hit.title)).toEqual(['Refreshed result']);
  });

  it('times out an unresponsive search and allows a new request', fakeAsync(() => {
    search('synthetic title');
    tick(45_000);
    render();
    expect(requests[0].response.observed).toBeFalse();
    expect(page.searchLoading).toBeFalse();
    expect(page.searchError).toBeTruthy();
    expect(page.showNoResults).toBeFalse();
    page.retrySearch();
    succeed(1, ['Recovered result']);
    expect(page.hits[0].title).toBe('Recovered result');
    expect(page.searchError).toBeNull();
  }));

  it('keeps cached emissions when a later network refresh fails', () => {
    search('synthetic title');
    requests[0].response.next(result(['Cached result']));
    requests[0].response.error(new Error('Synthetic refresh failure'));
    expect(page.hits[0].title).toBe('Cached result');
    expect(page.searchError).toContain('previous results');
    expect(page.searchLoading).toBeFalse();
  });

  it('retries a failed next page without losing results, skipping pages, or duplicating the first page', () => {
    search('synthetic title');
    succeed(0, ['First page'], { totalPages: 3 });
    const gesture = scrollGesture();
    page.loadMore(gesture.event);
    expect(page.page).toBe(1);
    expect(requests[1].options.page).toBe(2);
    requests[1].response.error(new Error('Synthetic next-page failure'));
    expect(gesture.complete).toHaveBeenCalledTimes(1);
    expect(page.hits.map(hit => hit.title)).toEqual(['First page']);
    expect(page.page).toBe(1);
    expect(page.infiniteDisabled).toBeTrue();
    page.retrySearch();
    expect(requests[2].options.page).toBe(2);
    succeed(2, ['Second page'], { totalPages: 3 });
    expect(page.page).toBe(2);
    expect(page.hits.map(hit => hit.title)).toEqual(['First page', 'Second page']);
    expect(page.infiniteDisabled).toBeFalse();
  });

  it('cancels pending pagination when the query changes and completes its gesture', () => {
    search('synthetic alpha');
    succeed(0, ['First alpha page'], { totalPages: 3 });
    const gesture = scrollGesture();
    page.loadMore(gesture.event);
    search('synthetic beta');
    expect(requests[1].response.observed).toBeFalse();
    expect(gesture.complete).toHaveBeenCalledTimes(1);
    succeed(2, ['Beta']);
    succeed(1, ['Late alpha page']);
    expect(page.hits.map(hit => hit.title)).toEqual(['Beta']);
    expect(page.page).toBe(1);
  });

  it('uses the displayed search criteria for pagination when the input has an unsubmitted edit', () => {
    search('synthetic alpha');
    succeed(0, ['First page'], { totalPages: 2 });
    page.lookfor = 'synthetic unsubmitted';
    page.loadMore(scrollGesture().event);
    expect(requests[1].options.lookfor).toBe('synthetic alpha');
  });

  it('finishes pull-to-refresh only after its request completes', () => {
    page.lookfor = 'synthetic title';
    const gesture = scrollGesture();
    page.refreshSearch(gesture.event);
    expect(gesture.complete).not.toHaveBeenCalled();
    succeed(0, []);
    expect(gesture.complete).toHaveBeenCalledTimes(1);
  });

  it('preserves route and external-filter mapping without a duplicate or stuck request', () => {
    routeUpdates.next(convertToParamMap({
      lookfor: 'synthetic title', dl: 'synthetic-link',
      extFilter: ['format:"Book"'], sort: 'newest_to_oldest',
    }));
    expect(requests[0].options.filters).toEqual(['format:Book']);
    expect(requests[0].options.sort).toBe('year desc,title asc');
    requests[0].response.next(result(['Before mapping'], { facets: {
      format: { label: 'Format', list: { Book: {
        value: '"Book"', display: 'Book', count: 2, isApplied: true,
      } } },
    } }));
    expect(requests[0].response.observed).toBeFalse();
    expect(requests.length).toBe(2);
    expect(requests[1].options.filters).toEqual(['format:"Book"']);
    expect(page.searchLoading).toBeTrue();
    succeed(1, ['Mapped result']);
    expect(page.hits[0].title).toBe('Mapped result');
    expect(page.searchLoading).toBeFalse();
    routeUpdates.next(convertToParamMap({
      lookfor: 'synthetic title', filter: ['format:"Book"'], sort: 'year desc,title asc',
    }));
    expect(requests.length).toBe(2);
    expect(navigate).toHaveBeenCalled();
  });

  it('discards pending external filters when a different route replaces the search', () => {
    routeUpdates.next(convertToParamMap({
      lookfor: 'synthetic alpha', dl: 'synthetic-link', extFilter: ['format:Book'],
    }));
    routeUpdates.next(convertToParamMap({ lookfor: 'synthetic beta' }));
    expect(requests[0].response.observed).toBeFalse();
    expect(requests[1].options.filters).toEqual([]);
    succeed(1, ['Beta'], { facets: {
      format: { label: 'Format', list: { Book: {
        value: 'Book', display: 'Book', count: 1, isApplied: false,
      } } },
    } });
    expect(requests.length).toBe(2);
    expect(page.filters).toEqual([]);
    expect(page.hits[0].title).toBe('Beta');
  });

  function search(query: string) {
    page.lookfor = query;
    page.runSearch(true);
  }

  function result(titles: string[], overrides: Partial<AspenSearchResult> = {}): AspenSearchResult {
    return {
      success: true, lookfor: 'synthetic title', totalResults: titles.length,
      page: 1, pageSize: 20, totalPages: 1,
      hits: titles.map(title => ({ key: `synthetic-${title}`, title, itemList: [], raw: {} })),
      raw: {}, ...overrides,
    };
  }

  function succeed(index: number, titles: string[], overrides: Partial<AspenSearchResult> = {}) {
    requests[index].response.next(result(titles, overrides));
    requests[index].response.complete();
  }

  function scrollGesture() {
    const complete = jasmine.createSpy('complete').and.resolveTo();
    return { complete, event: { target: { complete } } as unknown as Event };
  }

  function render() {
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
  }
});
