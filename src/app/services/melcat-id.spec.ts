import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ActionSheetController, ModalController } from '@ionic/angular/lazy';
import { firstValueFrom, of } from 'rxjs';

import { MelcatManageModalComponent } from '../components/melcat-manage-modal/melcat-manage-modal.component';
import { ShowCardModalComponent } from '../components/show-card-modal/show-card-modal.component';
import { Globals } from '../globals';
import { AccountPage } from '../pages/account/account.page';
import { HomePage } from '../pages/home/home.page';
import { AccountStoreService } from './account-store.service';
import { AuthService } from './auth.service';
import { ListLookupService } from './list-lookup.service';
import { LocationsService } from './locations.service';
import { melcatIdFromProfile } from './melcat-id';
import { PatronService } from './patron.service';
import { ServiceAlertService } from './service-alert.service';
import { ToastService } from './toast.service';

describe('MeLCat ILS record ID', () => {
  it('normalizes numeric and string ILS record IDs', () => {
    expect(melcatIdFromProfile({ unique_ils_id: 123456 })).toBe('123456');
    expect(melcatIdFromProfile({ unique_ils_id: ' 123456 ' })).toBe('123456');
  });

  it('uses the ILS ID even when other identity fields disagree', () => {
    expect(melcatIdFromProfile({
      unique_ils_id: '123456',
      username: 'example_patron',
      ils_username: 'example_patron',
      melcat_id: 'stale-value',
      id: 987654,
    })).toBe('123456');
  });

  it('never substitutes a login, barcode, helper value, or Aspen user ID', () => {
    for (const unique_ils_id of [undefined, null, '', '   ']) {
      expect(melcatIdFromProfile({
        unique_ils_id,
        username: '654321',
        ils_username: 'example_patron',
        ils_barcode: 'EXAMPLE-CARD-001',
        melcat_id: '654321',
        id: 987654,
      })).toBe('');
    }
  });

  it('does not display malformed or unavailable ILS IDs', () => {
    for (const unique_ils_id of [
      'example_patron', '1.5', '0', 0, -1, 1.5, NaN, Infinity,
      Number.MAX_SAFE_INTEGER + 1, true, {}, [],
    ]) {
      expect(melcatIdFromProfile({ unique_ils_id })).toBe('');
    }
    for (const profile of [undefined, null, 'example_patron', 123456, []]) {
      expect(melcatIdFromProfile(profile)).toBe('');
    }
  });
});

describe('MeLCat identity across account preference sync', () => {
  let auth: AuthService;
  let modal: jasmine.SpyObj<ModalController>;
  let toast: jasmine.SpyObj<ToastService>;

  beforeEach(async () => {
    const accounts = jasmine.createSpyObj<AccountStoreService>('AccountStoreService', [
      'upsertAccountMeta', 'setPassword', 'setActiveAccountId', 'cacheProfile',
    ]);
    accounts.upsertAccountMeta.and.callFake(async meta => ({
      ...meta, id: meta.id ?? 'synthetic-account',
    }));
    accounts.setPassword.and.resolveTo();
    accounts.setActiveAccountId.and.resolveTo();
    accounts.cacheProfile.and.resolveTo();

    const patron = jasmine.createSpyObj<PatronService>('PatronService', [
      'getPatronProfile', 'displayNameFromProfile',
    ]);
    patron.getPatronProfile.and.returnValue(of({
      success: true,
      profile: {
        username: '123456', unique_ils_id: '123456',
        ils_barcode: 'EXAMPLE-CARD-001', melcat_id: 'stale-value', id: 987654,
      },
    }));
    patron.displayNameFromProfile.and.returnValue('Synthetic patron');

    modal = jasmine.createSpyObj<ModalController>('ModalController', ['create']);
    const cardModal = jasmine.createSpyObj<HTMLIonModalElement>('CardModal', ['present']);
    cardModal.present.and.resolveTo();
    modal.create.and.resolveTo(cardModal);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['presentToast']);

    TestBed.configureTestingModule({ providers: [
      AuthService,
      { provide: AccountStoreService, useValue: accounts },
      { provide: PatronService, useValue: patron },
      { provide: Globals, useValue: { modal_open: false } },
      { provide: ModalController, useValue: modal },
      { provide: ToastService, useValue: toast },
      { provide: Router, useValue: {} },
      { provide: ActionSheetController, useValue: {} },
      { provide: LocationsService, useValue: {} },
      { provide: ServiceAlertService, useValue: {} },
      { provide: ListLookupService, useValue: {} },
    ] });
    auth = TestBed.inject(AuthService);
    await firstValueFrom(auth.login('EXAMPLE-CARD-001', 'synthetic-password'));
  });

  for (const Page of [HomePage, AccountPage]) {
    it(`keeps the ILS ID on ${Page.name}'s card after username sync`, async () => {
      const page = TestBed.runInInjectionContext(() => new Page());
      await page.showCard();
      await auth.updateActiveAccountUsername('example_patron');
      expect(auth.snapshot().profile.username).toBe('example_patron');
      await page.showCard();

      expect(modal.create).toHaveBeenCalledTimes(2);
      for (const [options] of modal.create.calls.allArgs()) {
        expect(options.component).toBe(ShowCardModalComponent);
        expect(options.componentProps).toEqual({
          barcode: 'EXAMPLE-CARD-001', melcatId: '123456',
        });
      }
    });

    it(`omits an unavailable MeLCat ID on ${Page.name}'s card`, async () => {
      auth.applyActiveProfile({
        username: 'example_patron', ils_barcode: 'EXAMPLE-CARD-001',
        melcat_id: '654321', id: 987654,
      });
      const page = TestBed.runInInjectionContext(() => new Page());
      await page.showCard();
      expect(modal.create.calls.mostRecent().args[0].componentProps).toEqual({
        barcode: 'EXAMPLE-CARD-001', melcatId: '',
      });
    });
  }

  it('displays and copies the ILS ID in the MeLCat interstitial after username sync', async () => {
    await auth.updateActiveAccountUsername('example_patron');
    const component = TestBed.runInInjectionContext(() => new MelcatManageModalComponent());
    const copy = spyOn(component as unknown as {
      copyText(value: string): Promise<boolean>;
    }, 'copyText').and.resolveTo(true);
    component.ngOnInit();
    expect(component.melcatId).toBe('123456');
    await component.copyMelcatId();
    expect(copy).toHaveBeenCalledOnceWith('123456');
  });

  it('does not copy another identity when the ILS ID is unavailable', async () => {
    auth.applyActiveProfile({ username: 'example_patron', melcat_id: '654321', id: 987654 });
    const component = TestBed.runInInjectionContext(() => new MelcatManageModalComponent());
    const copy = spyOn(component as unknown as {
      copyText(value: string): Promise<boolean>;
    }, 'copyText').and.resolveTo(true);
    component.ngOnInit();
    expect(component.melcatId).toBe('');
    await component.copyMelcatId();
    expect(copy).not.toHaveBeenCalled();
    expect(toast.presentToast).toHaveBeenCalledWith('No MeLCat ID available to copy.');
  });
});
