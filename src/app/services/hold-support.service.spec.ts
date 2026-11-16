import { TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ActionSheetController, AlertController, MenuController, ModalController, Platform } from '@ionic/angular/lazy';
import { Subject, of, throwError } from 'rxjs';

import { Globals } from '../globals';
import { ItemDetailComponent } from '../components/item-detail/item-detail.component';
import { AccountPreferencesService, type AccountPreferences, type PreferencesPayload } from './account-preferences.service';
import { AccountStoreService } from './account-store.service';
import { AuthService, type AuthState } from './auth.service';
import { CheckoutsService } from './checkouts.service';
import { FormatFamilyService } from './format-family.service';
import { HoldSupportService } from './hold-support.service';
import { HoldsService } from './holds.service';
import { ItemService } from './item.service';
import { ListLookupService } from './list-lookup.service';
import { ListsService } from './lists.service';
import { ToastService } from './toast.service';

describe('Default hold pickup', () => {
  let service: HoldSupportService;
  let globals: Globals;
  let prefs: jasmine.SpyObj<AccountPreferencesService>;
  let accounts: jasmine.SpyObj<AccountStoreService>;
  let actionSheet: jasmine.SpyObj<ActionSheetController>;
  let snapshot: AuthState;

  function preferences(pickupLibrary = '901'): AccountPreferences {
    return {
      username: 'synthetic-user', pickup_library: pickupLibrary, hold_shelf_alias: '',
      day_phone: '', evening_phone: '', other_phone: '', email: '', melcat_id: '', default_search: '',
      keep_circ_history: false, keep_hold_history: false, email_notify: false, phone_notify: false,
      text_notify: false, phone_notify_number: '', text_notify_number: '',
    };
  }

  function payload(pickupLibrary = '901'): PreferencesPayload {
    return { token: 'synthetic-token', preferences: preferences(pickupLibrary), raw: {} };
  }

  function switchAccount(): void {
    snapshot = {
      ...snapshot, activeAccountId: 'synthetic-other-account',
      activeAccountMeta: { id: 'synthetic-other-account', username: 'synthetic-other-user', label: 'Example Other' },
    };
  }

  beforeEach(() => {
    snapshot = {
      isLoggedIn: true, activeAccountId: 'synthetic-account',
      activeAccountMeta: { id: 'synthetic-account', username: 'synthetic-user', label: 'Example patron' },
      profile: null,
    };
    prefs = jasmine.createSpyObj<AccountPreferencesService>('AccountPreferencesService', ['getCachedPreferences', 'fetchForAccount']);
    prefs.getCachedPreferences.and.resolveTo(null);
    prefs.fetchForAccount.and.returnValue(of(payload()));
    accounts = jasmine.createSpyObj<AccountStoreService>('AccountStoreService', ['getPassword']);
    accounts.getPassword.and.resolveTo('synthetic-password');
    actionSheet = jasmine.createSpyObj<ActionSheetController>('ActionSheetController', ['create']);
    actionSheet.create.and.resolveTo({ present: () => Promise.resolve() } as unknown as HTMLIonActionSheetElement);
    TestBed.configureTestingModule({ providers: [
      { provide: AuthService, useValue: { snapshot: () => snapshot } },
      { provide: AccountPreferencesService, useValue: prefs },
      { provide: AccountStoreService, useValue: accounts },
      { provide: HoldsService, useValue: {} },
      { provide: ItemService, useValue: { extractIlsIdFromOnclick: () => '901001' } },
      { provide: CheckoutsService, useValue: {} },
      { provide: ListsService, useValue: {} },
      { provide: ListLookupService, useValue: {} },
      { provide: FormatFamilyService, useValue: {} },
      { provide: ToastService, useValue: {} },
      { provide: Router, useValue: {} },
      { provide: MenuController, useValue: {} },
      { provide: ModalController, useValue: {} },
      { provide: AlertController, useValue: {} },
      { provide: ActionSheetController, useValue: actionSheet },
      { provide: Platform, useValue: {} },
    ] });
    globals = TestBed.inject(Globals);
    globals.applyAppConfig({
      schemaVersion: 1, backend: globals.aspen_api_param_api, revision: 'synthetic',
      locations: [
        { evergreenId: 901, aspenId: 801, pickupCode: 'EXAMPLE-MAIN', shortname: 'main', name: 'Example Main', pickupEnabled: true },
        { evergreenId: 902, aspenId: 802, pickupCode: 'EXAMPLE-EAST', shortname: 'east', name: 'Example East', pickupEnabled: true },
        { evergreenId: 903, aspenId: 803, pickupCode: 'EXAMPLE-OLD', shortname: 'old', name: 'Example Former Branch', pickupEnabled: false },
      ],
    });
    service = TestBed.inject(HoldSupportService);
  });

  it('uses a valid cached default without fetching preferences or credentials', async () => {
    prefs.getCachedPreferences.and.resolveTo(preferences('902'));
    expect(await service.defaultPickupBranchCode()).toBe('EXAMPLE-EAST');
    expect(prefs.fetchForAccount).not.toHaveBeenCalled();
    expect(accounts.getPassword).not.toHaveBeenCalled();
  });

  it('loads the saved default on first login before background preference caching finishes', async () => {
    expect(await service.defaultPickupBranchCode()).toBe('EXAMPLE-MAIN');
    expect(prefs.fetchForAccount).toHaveBeenCalledOnceWith('synthetic-account', 'synthetic-user', 'synthetic-password');
    expect(prefs.getCachedPreferences).toHaveBeenCalledTimes(1);
  });

  for (const pickup of ['', '999']) {
    it(`refreshes a cached ${pickup ? 'unmapped' : 'empty'} default before showing the picker`, async () => {
      prefs.getCachedPreferences.and.resolveTo(preferences(pickup));
      expect(await service.defaultPickupBranchCode()).toBe('EXAMPLE-MAIN');
      expect(prefs.fetchForAccount).toHaveBeenCalledTimes(1);
    });
  }

  it('allows a fresh preference lookup when the cache is unavailable', async () => {
    prefs.getCachedPreferences.and.rejectWith(new Error('Synthetic storage unavailable'));
    expect(await service.defaultPickupBranchCode()).toBe('EXAMPLE-MAIN');
  });

  it('leaves pickup selection to the user when credentials are unavailable', async () => {
    accounts.getPassword.and.resolveTo(null);
    expect(await service.defaultPickupBranchCode()).toBeNull();
    expect(prefs.fetchForAccount).not.toHaveBeenCalled();
  });

  it('leaves pickup selection to the user when the preferences request fails', async () => {
    prefs.fetchForAccount.and.returnValue(throwError(() => new Error('Synthetic upstream unavailable')));
    expect(await service.defaultPickupBranchCode()).toBeNull();
  });

  for (const pickup of ['903', '999']) {
    it(`never chooses a ${pickup === '903' ? 'disabled' : 'unknown'} saved location`, async () => {
      prefs.getCachedPreferences.and.resolveTo(preferences(pickup));
      prefs.fetchForAccount.and.returnValue(of(payload(pickup)));
      expect(await service.defaultPickupBranchCode()).toBeNull();
    });
  }

  it('does not use the previous account default when the account changes during cache lookup', async () => {
    let finishCache!: (value: AccountPreferences | null) => void;
    prefs.getCachedPreferences.and.returnValue(new Promise(resolve => { finishCache = resolve; }));
    const result = service.defaultPickupBranchCode();
    switchAccount();
    finishCache(preferences());
    expect(await result).toBeNull();
    expect(accounts.getPassword).not.toHaveBeenCalled();
  });

  it('does not fetch the previous account preferences after switching during credential loading', fakeAsync(() => {
    let finishPassword!: (value: string | null) => void;
    accounts.getPassword.and.returnValue(new Promise(resolve => { finishPassword = resolve; }));
    let result: string | null | undefined;
    void service.defaultPickupBranchCode().then(value => { result = value; });
    flushMicrotasks();
    switchAccount();
    finishPassword('synthetic-password');
    flushMicrotasks();
    expect(result).toBeNull();
    expect(prefs.fetchForAccount).not.toHaveBeenCalled();
  }));

  it('does not return the previous account default after switching during the request', fakeAsync(() => {
    const response = new Subject<PreferencesPayload>();
    prefs.fetchForAccount.and.returnValue(response);
    let result: string | null | undefined;
    void service.defaultPickupBranchCode().then(value => { result = value; });
    flushMicrotasks();
    switchAccount();
    response.next(payload());
    response.complete();
    flushMicrotasks();
    expect(result).toBeNull();
  }));

  it('resolves a fetched default against the current registry after a configuration refresh', fakeAsync(() => {
    const response = new Subject<PreferencesPayload>();
    prefs.fetchForAccount.and.returnValue(response);
    let result: string | null | undefined;
    void service.defaultPickupBranchCode().then(value => { result = value; });
    flushMicrotasks();
    globals.applyAppConfig({
      schemaVersion: 1, backend: globals.aspen_api_param_api, revision: 'synthetic-updated',
      locations: [{ evergreenId: 901, aspenId: 804, pickupCode: 'EXAMPLE-UPDATED', shortname: 'main', name: 'Example Main', pickupEnabled: true }],
    });
    response.next(payload());
    response.complete();
    flushMicrotasks();
    expect(result).toBe('EXAMPLE-UPDATED');
  }));

  it('places an item-detail hold with the fetched default instead of showing the pickup picker', fakeAsync(() => {
    const detail = TestBed.runInInjectionContext(() => new ItemDetailComponent());
    const placeHold = spyOn(detail as unknown as { placeHoldNow(recordId: string, pickup: string): void }, 'placeHoldNow');
    void detail.handleFormatAction({ type: 'ils_hold', onclick: 'synthetic hold action' }, 'Book');
    flushMicrotasks();
    expect(placeHold).toHaveBeenCalledOnceWith('901001', 'EXAMPLE-MAIN');
    expect(actionSheet.create).not.toHaveBeenCalled();
  }));
});
