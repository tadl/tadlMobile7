import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { ActionSheetController, AlertController, ModalController } from '@ionic/angular/lazy';
import { BehaviorSubject, Subject, of } from 'rxjs';

import { Globals } from '../../globals';
import { AuthService } from '../../services/auth.service';
import { FormatFamilyService } from '../../services/format-family.service';
import { HoldsService } from '../../services/holds.service';
import { HoldSupportService } from '../../services/hold-support.service';
import { ListLookupService } from '../../services/list-lookup.service';
import { ListsService } from '../../services/lists.service';
import { AspenSearchResult, SearchService } from '../../services/search.service';
import { ToastService } from '../../services/toast.service';
import { SearchPage } from './search.page';

const result: AspenSearchResult = {
  success: true, lookfor: 'synthetic query', totalResults: 30,
  page: 1, pageSize: 20, totalPages: 2, hits: [], raw: {},
};

describe('Search location configuration', () => {
  let page: SearchPage;
  let globals: { api_loading: boolean; server_error_msg: string; searchScopes: { id: string; name: string; filters: string[] }[] };
  let search: jasmine.Spy;
  let navigate: jasmine.Spy;
  let toast: jasmine.Spy;
  let routeParams: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  beforeEach(() => {
    globals = {
      api_loading: false, server_error_msg: 'Request failed.',
      searchScopes: [
        { id: 'all', name: 'All locations', filters: [] },
        { id: 'branch', name: 'Synthetic branch', filters: ['building:synthetic'] },
      ],
    };
    search = jasmine.createSpy('getAppSearchResults').and.returnValue(of(result));
    navigate = jasmine.createSpy('navigate').and.resolveTo(true);
    toast = jasmine.createSpy('presentToast');
    routeParams = new BehaviorSubject(convertToParamMap({}));
    TestBed.configureTestingModule({ providers: [
      { provide: Globals, useValue: globals },
      { provide: SearchService, useValue: { getAppSearchResults: search } },
      { provide: ToastService, useValue: { presentToast: toast } },
      { provide: ActivatedRoute, useValue: { queryParamMap: routeParams } },
      { provide: Router, useValue: { navigate } },
      { provide: ModalController, useValue: {} },
      { provide: ActionSheetController, useValue: {} },
      { provide: AlertController, useValue: {} },
      { provide: FormatFamilyService, useValue: {} },
      { provide: ListsService, useValue: {} },
      { provide: ListLookupService, useValue: {} },
      { provide: HoldsService, useValue: {} },
      { provide: AuthService, useValue: {} },
      { provide: HoldSupportService, useValue: {} },
    ] });
    page = TestBed.runInInjectionContext(() => new SearchPage());
  });

  afterEach(() => page.ngOnDestroy());

  it('preserves the default search and deduplicates configured location filters with other facets', () => {
    page.lookfor = 'synthetic query';
    page.filters = ['format:Book'];
    page.runSearch(true);
    expect(search.calls.mostRecent().args[0].filters).toEqual(['format:Book']);

    page.filters = ['format:Book', 'building:synthetic'];
    page.changeSearchLocation('branch');
    expect(search.calls.mostRecent().args[0].filters).toEqual(['building:synthetic', 'format:Book']);
    expect(page.filters).toEqual(['format:Book', 'building:synthetic']);
    expect(navigate.calls.mostRecent().args[1].queryParams.locationScope).toBe('branch');
  });

  it('restores location selection from the route without discarding arbitrary filters', () => {
    routeParams.next(convertToParamMap({
      lookfor: 'synthetic query', locationScope: 'branch', filter: ['format:Book'],
    }));
    page.ngOnInit();
    expect(page.locationScopeId).toBe('branch');
    expect(page.showAdvanced).toBeTrue();
    expect(search.calls.mostRecent().args[0].filters).toEqual(['building:synthetic', 'format:Book']);
    expect(page.filters).toEqual(['format:Book']);
  });

  it('uses the same location filters for later pages when configuration changes', () => {
    page.lookfor = 'synthetic query';
    page.changeSearchLocation('branch');
    globals.searchScopes[1] = { id: 'branch', name: 'Updated branch', filters: ['building:changed'] };
    const complete = jasmine.createSpy('complete');
    page.loadMore({ target: { complete } });
    expect(search.calls.mostRecent().args[0].page).toBe(2);
    expect(search.calls.mostRecent().args[0].filters).toEqual(['building:synthetic']);
    expect(complete).toHaveBeenCalled();

    page.runSearch(true);
    expect(search.calls.mostRecent().args[0].filters).toEqual(['building:changed']);
  });

  it('does not broaden an unknown routed location while startup configuration is pending', () => {
    page.lastExecutedQuery = 'synthetic query';
    routeParams.next(convertToParamMap({ lookfor: 'synthetic query', locationScope: 'remote-branch' }));
    page.ngOnInit();
    expect(page.searchLocationUnavailable).toBeTrue();
    expect(page.lastExecutedQuery).toBe('');
    expect(search).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalled();

    globals.searchScopes.push({ id: 'remote-branch', name: 'Remote branch', filters: ['building:remote'] });
    expect(page.searchLocationUnavailable).toBeFalse();
    expect(search).not.toHaveBeenCalled();
    page.runSearch(true);
    expect(search.calls.mostRecent().args[0].filters).toEqual(['building:remote']);
  });

  it('queues a new location search until the previous request completes', () => {
    const pending = new Subject<AspenSearchResult>();
    search.and.returnValue(pending);
    page.lookfor = 'synthetic query';
    page.runSearch(true);
    page.changeSearchLocation('branch');
    expect(search).toHaveBeenCalledTimes(1);

    search.and.returnValue(of(result));
    pending.next(result);
    pending.complete();
    expect(search).toHaveBeenCalledTimes(2);
    expect(search.calls.mostRecent().args[0].filters).toEqual(['building:synthetic']);
    expect(globals.api_loading).toBeFalse();
  });

  it('allows a configured location-only search without a keyword', () => {
    page.changeSearchLocation('branch');
    expect(search.calls.mostRecent().args[0].lookfor).toBe('');
    expect(search.calls.mostRecent().args[0].filters).toEqual(['building:synthetic']);
  });
});
