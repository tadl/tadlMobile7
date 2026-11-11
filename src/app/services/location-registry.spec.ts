import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActionSheetController, AlertController, MenuController, ModalController, Platform } from '@ionic/angular/lazy';
import { Globals } from '../globals';
import { AccountPreferencesPage } from '../pages/account-preferences/account-preferences.page';
import { AppConfigService } from './app-config.service';
import { AppConfig } from './app-config.types';
import { AppCacheService } from './app-cache.service';
import { AccountPreferences, AccountPreferencesService } from './account-preferences.service';
import { AccountStoreService } from './account-store.service';
import { AuthService } from './auth.service';
import { FormatFamilyService } from './format-family.service';
import { HistorySettingsService } from './history-settings.service';
import { HoldSupportService } from './hold-support.service';
import { HoldsService } from './holds.service';
import { ItemService } from './item.service';
import { ToastService } from './toast.service';

describe('Runtime location registry integration', () => {
  let globals: Globals;
  let http: HttpTestingController;
  let savedPickup: string;

  function config(): AppConfig {
    return {
      schemaVersion: 1, backend: globals.aspen_api_param_api, revision: 'synthetic',
      locations: [
        { evergreenId: 901, aspenId: 801, pickupCode: 'TEST-OLD', shortname: 'old', name: 'Former Test Branch', pickupEnabled: false },
        { evergreenId: 902, aspenId: 802, pickupCode: 'TEST-NEW', shortname: 'new', name: 'New Test Branch', pickupEnabled: true },
        { evergreenId: 903, aspenId: 803, pickupCode: 'TEST-MAIN', shortname: 'main', name: 'Test Main Branch', pickupEnabled: true },
      ],
      searchScopes: [{ id: 'all', name: 'All locations', filters: [] }],
    };
  }

  beforeEach(() => {
    savedPickup = '902';
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(), provideHttpClientTesting(),
      { provide: MenuController, useValue: {} },
      { provide: ModalController, useValue: {} },
      { provide: AlertController, useValue: {} },
      { provide: ActionSheetController, useValue: {} },
      { provide: Platform, useValue: {} },
      { provide: AuthService, useValue: { snapshot: () => ({
        isLoggedIn: true, activeAccountId: 'synthetic-account',
        activeAccountMeta: { username: 'synthetic-user' },
      }) } },
      { provide: AccountStoreService, useValue: { getPassword: () => Promise.resolve('synthetic-password') } },
      { provide: AccountPreferencesService, useValue: {
        getCachedToken: () => Promise.resolve(null),
        getCachedPreferences: () => Promise.resolve({ pickup_library: savedPickup }),
      } },
      { provide: AppCacheService, useValue: {
        read: () => Promise.resolve(null), write: () => Promise.resolve(),
      } },
      { provide: FormatFamilyService, useValue: {} },
      { provide: ItemService, useValue: {} },
      { provide: HistorySettingsService, useValue: {} },
      { provide: ToastService, useValue: {} },
    ] });
    globals = TestBed.inject(Globals);
    globals.aspen_api_base = 'https://example.org/API';
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('updates an already-created preference page and maps a new branch into hold requests', async () => {
    const page = TestBed.runInInjectionContext(() => new AccountPreferencesPage());
    expect(page.pickupOptions.some(option => option.code === '902')).toBeFalse();
    await TestBed.inject(AppConfigService).initialize();
    const request = http.expectOne(request => request.url === 'https://example.org/API/AppConfig');
    expect(request.request.params.get('api')).toBe(globals.aspen_api_param_api);
    request.flush(config());
    await Promise.resolve();
    expect(page.pickupOptions.map(option => option.code)).toEqual(['902', '903']);
    expect(await TestBed.inject(HoldSupportService).defaultPickupBranchCode()).toBe('TEST-NEW');
    const location = globals.pickupLocationFromLegacyPreferencesCode('902')!;
    TestBed.inject(HoldsService).changeHoldPickUpLocation(456, globals.pickupAspenNewLocation(location), null).subscribe();
    await new Promise(resolve => setTimeout(resolve, 0));
    const holdRequest = http.expectOne(request => request.params.get('method') === 'changeHoldPickUpLocation');
    expect(holdRequest.request.params.get('newLocation')).toBe('802_TEST-NEW');
    expect(holdRequest.request.params.get('pickupBranch')).toBe('TEST-NEW');
    expect(holdRequest.request.params.get('userApiBackend')).toBe('helper');
    holdRequest.flush({ result: { success: true } });
  });

  it('keeps disabled branch names for existing records but excludes them from new pickups', async () => {
    globals.applyAppConfig(config());
    expect(globals.pickupNameForCode('TEST-OLD')).toBe('Former Test Branch');
    expect(globals.pickupLocationByAspenId(801)?.name).toBe('Former Test Branch');
    expect(globals.pickupLocations.map(location => location.code)).toEqual(['TEST-NEW', 'TEST-MAIN']);
    expect(globals.pickupLocationFromLegacyPreferencesCode('901')).toBeNull();
    savedPickup = '901';
    expect(await TestBed.inject(HoldSupportService).defaultPickupBranchCode()).toBeNull();
    const page = TestBed.runInInjectionContext(() => new AccountPreferencesPage());
    page.preferences = { pickup_library: '901' } as AccountPreferences;
    expect(page.pickupOptions[0]).toEqual({ code: '901', name: 'Former Test Branch', disabled: true });
  });

  it('does not publish configuration belonging to a different library backend', () => {
    const before = globals.pickupLocations;
    globals.applyAppConfig({ ...config(), backend: 'other-prod' });
    expect(globals.pickupLocations).toBe(before);
  });
});
