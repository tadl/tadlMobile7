import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ActionSheetController, AlertController, ModalController } from '@ionic/angular/lazy';
import { Subject } from 'rxjs';

import { Globals } from '../globals';
import { ItemDetailComponent } from '../components/item-detail/item-detail.component';
import { HoldsPage } from '../pages/holds/holds.page';
import { CheckoutsPage } from '../pages/checkouts/checkouts.page';
import { AccountPreferencesService } from './account-preferences.service';
import { AuthService, type AuthState } from './auth.service';
import { CheckoutsService, type AspenCheckout, type AspenMutationResult } from './checkouts.service';
import { HoldsService, type AspenHold } from './holds.service';
import { HoldSupportService } from './hold-support.service';
import { ItemService } from './item.service';
import { ListsService } from './lists.service';
import { ListLookupService } from './list-lookup.service';
import { FormatFamilyService } from './format-family.service';
import { ToastService } from './toast.service';

describe('Circulation view account isolation', () => {
  let active: AuthState;
  let holds: jasmine.SpyObj<HoldsService>;
  let checkouts: jasmine.SpyObj<CheckoutsService>;
  let adjustCounts: jasmine.Spy;
  let toast: jasmine.Spy;
  const hold: AspenHold = { id: 501, recordId: 901001, type: 'ils', source: 'ils', title: 'Example hold A' };
  const checkout: AspenCheckout = {
    id: 601, itemId: 701, recordId: 901001, type: 'ils', source: 'ils',
    title: 'Example checkout A', canRenew: true,
  };

  function switchAccount(id: string) {
    active = {
      isLoggedIn: true, activeAccountId: id,
      activeAccountMeta: { id, username: `synthetic-${id}`, label: 'Example patron' },
      profile: { numHolds: 0, numCheckedOut: 0 },
    };
  }

  beforeEach(() => {
    switchAccount('account-a');
    adjustCounts = jasmine.createSpy('adjustActiveProfileCounts');
    toast = jasmine.createSpy('presentToast');
    holds = jasmine.createSpyObj<HoldsService>('HoldsService', ['fetchActiveHolds', 'setCachedHolds', 'placeHold', 'upsertCachedHold']);
    holds.setCachedHolds.and.resolveTo();
    checkouts = jasmine.createSpyObj<CheckoutsService>('CheckoutsService', ['renewCheckout', 'fetchFreshActiveCheckouts']);
    TestBed.configureTestingModule({ providers: [
      { provide: AuthService, useValue: { snapshot: () => active, adjustActiveProfileCounts: adjustCounts } },
      { provide: HoldsService, useValue: holds },
      { provide: CheckoutsService, useValue: checkouts },
      { provide: Globals, useValue: {} },
      { provide: ToastService, useValue: { presentToast: toast, presentHoldPlacedToast: toast } },
      { provide: FormatFamilyService, useValue: {} },
      { provide: ItemService, useValue: {} },
      { provide: ListsService, useValue: {} },
      { provide: ListLookupService, useValue: {} },
      { provide: HoldSupportService, useValue: {} },
      { provide: AccountPreferencesService, useValue: {} },
      { provide: Router, useValue: {} },
      { provide: ActionSheetController, useValue: {} },
      { provide: AlertController, useValue: {} },
      { provide: ModalController, useValue: {} },
    ] });
  });

  it('cancels the old hold read and never applies its rows or badges to the new account', () => {
    const first = new Subject<AspenHold[]>();
    const second = new Subject<AspenHold[]>();
    holds.fetchActiveHolds.and.returnValues(first, second);
    const page = TestBed.runInInjectionContext(() => new HoldsPage());
    page.refresh();
    first.next([hold]);
    adjustCounts.calls.reset();
    switchAccount('account-b');
    page.refresh();
    expect(page.ilsNotReady).toEqual([]);
    first.next([{ ...hold, title: 'Stale hold A' }]);
    const other = { ...hold, id: 502, title: 'Example hold B' };
    second.next([other]);
    second.complete();
    expect(page.ilsNotReady).toEqual([other]);
    expect(adjustCounts).toHaveBeenCalledTimes(1);
    expect(holds.setCachedHolds).toHaveBeenCalledWith('account-b', [other]);
    expect(holds.setCachedHolds).not.toHaveBeenCalledWith('account-b', [hold]);
    expect(page.loading).toBeFalse();
  });

  it('ignores a late checkout renewal instead of refreshing the new account or displaying its success', () => {
    const pending = new Subject<AspenMutationResult>();
    checkouts.renewCheckout.and.returnValue(pending);
    const page = TestBed.runInInjectionContext(() => new CheckoutsPage());
    page.ilsCheckouts = [checkout];
    (page as unknown as { renewSingle(value: AspenCheckout): void }).renewSingle(checkout);
    switchAccount('account-b');
    const other = { ...checkout, id: 602, title: 'Example checkout B' };
    page.ilsCheckouts = [other];
    pending.next({ success: true, message: 'Renewed example A.' });
    pending.complete();
    expect(page.ilsCheckouts).toEqual([other]);
    expect(checkouts.fetchFreshActiveCheckouts).not.toHaveBeenCalled();
    expect(adjustCounts).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('does not create optimistic holds or change badges after item-detail account switching', () => {
    const pending = new Subject<AspenMutationResult>();
    holds.placeHold.and.returnValue(pending);
    const detail = TestBed.runInInjectionContext(() => new ItemDetailComponent());
    (detail as unknown as { placeHoldNow(record: string, pickup: string): void }).placeHoldNow('901001', 'EXAMPLE-MAIN');
    switchAccount('account-b');
    pending.next({ success: true, message: 'Placed example A.' });
    pending.complete();
    expect(adjustCounts).not.toHaveBeenCalled();
    expect(holds.upsertCachedHold).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });
});
