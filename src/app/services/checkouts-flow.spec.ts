import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { ActionSheetController, AlertController, ModalController } from '@ionic/angular/lazy';
import { ItemDetailComponent } from '../components/item-detail/item-detail.component';
import { CheckoutsPage } from '../pages/checkouts/checkouts.page';
import { Globals } from '../globals';
import { AuthService, type AuthState } from './auth.service';
import { AccountStoreService } from './account-store.service';
import { AccountPreferencesService } from './account-preferences.service';
import { AppCacheService } from './app-cache.service';
import { CheckoutsService, type AspenCheckout } from './checkouts.service';
import { FormatFamilyService } from './format-family.service';
import { HoldsService } from './holds.service';
import { ItemService } from './item.service';
import { ListsService } from './lists.service';
import { ListLookupService } from './list-lookup.service';
import { ToastService } from './toast.service';

describe('Checkout renewal refresh', () => {
  let http: HttpTestingController;
  let cache: jasmine.SpyObj<AppCacheService>;
  let toast: jasmine.Spy;
  let modalController: jasmine.SpyObj<ModalController>;
  let original: AspenCheckout;
  let renewed: AspenCheckout;

  beforeEach(() => {
    original = {
      id: 101, itemId: 201, recordId: 301, barcode: 'SYNTHETIC-COPY-201',
      type: 'ils', source: 'ils', title: 'Example checkout',
      dueDate: 1790812800, canRenew: true, maxRenewals: 2, renewCount: 0,
    };
    renewed = { ...original, id: 102, dueDate: 1792022400, canRenew: false, maxRenewals: 0 };
    const snapshot: AuthState = {
      isLoggedIn: true, activeAccountId: 'synthetic-account',
      activeAccountMeta: { id: 'synthetic-account', username: 'synthetic-user', label: 'Example patron' },
      profile: { id: 401, numCheckedOut: 1 },
    };
    cache = jasmine.createSpyObj('AppCacheService', ['read', 'write']);
    cache.read.and.resolveTo([original]);
    cache.write.and.resolveTo();
    toast = jasmine.createSpy('presentToast');
    modalController = jasmine.createSpyObj('ModalController', ['create', 'dismiss']);
    modalController.dismiss.and.resolveTo(true);
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(), provideHttpClientTesting(),
      { provide: Globals, useValue: { aspen_api_base: 'https://example.org/API' } },
      { provide: AuthService, useValue: { snapshot: () => snapshot, adjustActiveProfileCounts: jasmine.createSpy() } },
      { provide: AccountStoreService, useValue: { getPassword: () => Promise.resolve('synthetic-password') } },
      { provide: AccountPreferencesService, useValue: { getCachedToken: () => Promise.resolve(null) } },
      { provide: AppCacheService, useValue: cache },
      { provide: ToastService, useValue: { presentToast: toast } },
      { provide: ModalController, useValue: modalController },
      { provide: ActionSheetController, useValue: {} },
      { provide: AlertController, useValue: {} },
      { provide: Router, useValue: {} },
      { provide: FormatFamilyService, useValue: {} },
      { provide: HoldsService, useValue: {} },
      { provide: ItemService, useValue: {} },
      { provide: ListsService, useValue: {} },
      { provide: ListLookupService, useValue: {} },
    ] });
    spyOn(TestBed.inject(CheckoutsService) as unknown as { getOrCreateSessionId(): Promise<string> }, 'getOrCreateSessionId')
      .and.resolveTo('synthetic-session');
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function page(): CheckoutsPage {
    const instance = TestBed.runInInjectionContext(() => new CheckoutsPage());
    instance.ilsCheckouts = [original];
    return instance;
  }

  function details(): ItemDetailComponent {
    const instance = TestBed.runInInjectionContext(() => new ItemDetailComponent());
    instance.checkout = original;
    instance.hit = { key: '', title: original.title!, raw: original, itemList: [] };
    return instance;
  }

  function renewalRequest() {
    tick();
    return http.expectOne(request => request.params.get('method') === 'renewItem');
  }

  function checkoutRefresh() {
    tick();
    const request = http.expectOne(request => request.params.get('method') === 'getPatronCheckedOutItems');
    expect(request.request.params.get('refreshCheckouts')).toBe('true');
    expect(request.request.method).toBe('POST');
    expect(request.request.urlWithParams).not.toContain('synthetic-password');
    return request;
  }

  it('updates the checkout list and cache from the ILS after a message-only renewal response', fakeAsync(() => {
    const instance = page();
    (instance as unknown as { renewSingle(checkout: AspenCheckout): void }).renewSingle(original);
    renewalRequest().flush({ result: { success: true, message: 'Your title was renewed successfully.' } });
    checkoutRefresh().flush({ result: { success: true, checkedOutItems: [renewed] } });
    tick();
    expect(instance.ilsCheckouts[0].dueDate).toBe(renewed.dueDate);
    expect(instance.ilsCheckouts[0].canRenew).toBeFalse();
    expect(cache.write).toHaveBeenCalledWith('checkouts:synthetic-account', instance.ilsCheckouts);
    expect(toast).toHaveBeenCalledWith('Renewed: Example checkout');
  }));

  it('refreshes successful bulk renewals even if another renewal is rate-limited', fakeAsync(() => {
    const instance = page();
    const other = { ...original, id: 103, itemId: 203 };
    instance.ilsCheckouts.push(other);
    (instance as unknown as { renewAll(): void }).renewAll();
    renewalRequest().flush({ result: { success: true } });
    tick(450);
    http.expectOne(request => request.params.get('method') === 'renewItem')
      .flush({}, { status: 429, statusText: 'Too Many Requests' });
    checkoutRefresh().flush({ result: { success: true, checkedOutItems: [renewed, other] } });
    tick();
    expect(instance.ilsCheckouts.find(checkout => checkout.itemId === original.itemId)?.dueDate).toBe(renewed.dueDate);
    expect(instance.renewAllBusy).toBeFalse();
    expect(toast).toHaveBeenCalledWith(jasmine.stringMatching('rate-limited'));
  }));

  it('preserves the list and cache when the post-renewal refresh reports an API failure', fakeAsync(() => {
    const instance = page();
    (instance as unknown as { renewSingle(checkout: AspenCheckout): void }).renewSingle(original);
    renewalRequest().flush({ result: { success: true } });
    checkoutRefresh().flush({ result: { success: false, message: 'Circulation system is offline' } });
    tick();
    expect(instance.ilsCheckouts).toEqual([original]);
    expect(cache.write).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(jasmine.stringMatching('Renewed: Example checkout.*Could not refresh due dates'));
  }));

  it('keeps an unsuccessful renewal unchanged and displays its reason', fakeAsync(() => {
    const instance = page();
    (instance as unknown as { renewSingle(checkout: AspenCheckout): void }).renewSingle(original);
    renewalRequest().flush({ result: { success: false, message: 'Item has been requested.' } });
    tick();
    expect(instance.ilsCheckouts).toEqual([original]);
    expect(instance.isRenewing(original)).toBeFalse();
    expect(cache.write).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('Item has been requested.');
    http.expectNone(request => request.params.get('method') === 'getPatronCheckedOutItems');
  }));

  it('refreshes item details and identifies the physical copy even when two copies share a record', fakeAsync(() => {
    const instance = details();
    instance.renewCheckout();
    renewalRequest().flush({ result: { success: true, message: 'Renewed successfully.' } });
    const refresh = checkoutRefresh();
    expect(instance.checkoutActionBusy).toBeTrue();
    const otherCopy = { ...original, itemId: 202, barcode: 'SYNTHETIC-COPY-202' };
    refresh.flush({ result: { success: true, checkedOutItems: [otherCopy, renewed] } });
    tick();
    expect(instance.checkout?.dueDate).toBe(renewed.dueDate);
    expect(instance.checkout?.maxRenewals).toBe(0);
    expect(instance.checkout?.renewCount).toBe(0);
    expect(instance.checkout?.canRenew).toBeFalse();
    expect(instance.checkoutActionBusy).toBeFalse();
    instance.close();
    tick();
    expect(modalController.dismiss).toHaveBeenCalledWith({ refreshCheckouts: true, checkout: instance.checkout });
  }));

  it('reports a detail refresh failure separately from a successful renewal without guessing dates or counts', fakeAsync(() => {
    const instance = details();
    instance.renewCheckout();
    renewalRequest().flush({ result: { success: true } });
    checkoutRefresh().flush({}, { status: 503, statusText: 'Service Unavailable' });
    tick();
    expect(instance.checkout).toBe(original);
    expect(instance.checkout?.renewCount).toBe(0);
    expect(instance.checkoutActionBusy).toBeFalse();
    expect(toast).toHaveBeenCalledWith(jasmine.stringMatching('Renewed, but could not refresh the due date'));
  }));

  it('refreshes the parent list on dismissal even if the modal still has the old date', fakeAsync(() => {
    const instance = page();
    let dismiss!: (result: { data: { refreshCheckouts: boolean; checkout: AspenCheckout } }) => void;
    const dismissed = new Promise<{ data: { refreshCheckouts: boolean; checkout: AspenCheckout } }>(resolve => dismiss = resolve);
    modalController.create.and.resolveTo({
      present: () => Promise.resolve(),
      onDidDismiss: () => dismissed,
    } as unknown as HTMLIonModalElement);
    instance.openCheckout(original);
    tick();
    dismiss({ data: { refreshCheckouts: true, checkout: original } });
    checkoutRefresh().flush({ result: { success: true, checkedOutItems: [renewed] } });
    tick();
    expect(instance.ilsCheckouts[0].dueDate).toBe(renewed.dueDate);
    expect(toast).not.toHaveBeenCalled();
  }));

  it('retains ordinary cached loading without forcing an ILS refresh on every visit', fakeAsync(() => {
    const emissions: AspenCheckout[][] = [];
    TestBed.inject(CheckoutsService).fetchActiveCheckouts().subscribe(list => emissions.push(list));
    tick();
    const request = http.expectOne(request => request.params.get('method') === 'getPatronCheckedOutItems');
    expect(request.request.params.has('refreshCheckouts')).toBeFalse();
    expect(emissions[0]).toEqual([original]);
    request.flush({ result: { success: true, checkedOutItems: [original] } });
    tick();
    expect(emissions.length).toBe(2);
  }));

  it('replaces the same physical copy when renewal changes its circulation ID', fakeAsync(() => {
    const instance = page();
    let dismiss!: (result: { data: { refreshCheckouts: boolean; checkout: AspenCheckout } }) => void;
    const dismissed = new Promise<{ data: { refreshCheckouts: boolean; checkout: AspenCheckout } }>(resolve => dismiss = resolve);
    modalController.create.and.resolveTo({
      present: () => Promise.resolve(),
      onDidDismiss: () => dismissed,
    } as unknown as HTMLIonModalElement);
    instance.openCheckout(original);
    tick();
    dismiss({ data: { refreshCheckouts: true, checkout: renewed } });
    const refresh = checkoutRefresh();
    expect(instance.ilsCheckouts.length).toBe(1);
    expect(instance.ilsCheckouts[0].dueDate).toBe(renewed.dueDate);
    refresh.flush({ result: { success: true, checkedOutItems: [renewed] } });
    tick();
    expect(instance.ilsCheckouts.length).toBe(1);
  }));
});
