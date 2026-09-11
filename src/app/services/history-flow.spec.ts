import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of } from 'rxjs';
import { ModalController, ActionSheetController, AlertController } from '@ionic/angular/lazy';
import { CheckoutHistoryPage } from '../pages/checkout-history/checkout-history.page';
import { AccountPreferencesPage } from '../pages/account-preferences/account-preferences.page';
import { Globals } from '../globals';
import { AuthService } from './auth.service';
import { AccountStoreService } from './account-store.service';
import { AccountPreferencesService } from './account-preferences.service';
import { HistoryService } from './history.service';
import { HistorySettingsService } from './history-settings.service';
import { ToastService } from './toast.service';
import { FormatFamilyService } from './format-family.service';

describe('Coordinated history UI', () => {
  let history: jasmine.SpyObj<HistoryService>;
  let settings: jasmine.SpyObj<HistorySettingsService>;
  let prefs: jasmine.SpyObj<AccountPreferencesService>;
  let snapshot: any;

  beforeEach(() => {
    snapshot = { isLoggedIn: true, activeAccountId: 'synthetic-account' };
    history = jasmine.createSpyObj('HistoryService', ['fetchReadingHistoryPage']);
    settings = jasmine.createSpyObj('HistorySettingsService', ['update', 'status']);
    prefs = jasmine.createSpyObj('AccountPreferencesService', ['persistPreferencesForAccount']);
    prefs.persistPreferencesForAccount.and.resolveTo();
    TestBed.configureTestingModule({ providers: [
      { provide: Globals, useValue: { legacyPickupLibraryToAspenLocationId: {} } },
      { provide: AuthService, useValue: { snapshot: () => snapshot } },
      { provide: AccountStoreService, useValue: {} },
      { provide: AccountPreferencesService, useValue: prefs },
      { provide: HistoryService, useValue: history },
      { provide: HistorySettingsService, useValue: settings },
      { provide: ToastService, useValue: { presentToast: jasmine.createSpy() } },
      { provide: FormatFamilyService, useValue: {} },
      { provide: ModalController, useValue: {} },
      { provide: ActionSheetController, useValue: {} },
      { provide: AlertController, useValue: {} },
    ] });
  });

  it('shows import status and stops polling when the history view is left', fakeAsync(() => {
    history.fetchReadingHistoryPage.and.returnValue(of({
      success: true, items: [], totalResults: 0, pageCurrent: 1, pageTotal: 1,
      sort: 'checkedOut', historyStatus: 'importing', message: 'Importing history.',
    }));
    const page = TestBed.runInInjectionContext(() => new CheckoutHistoryPage());
    page.ionViewWillEnter();
    expect(page.historyMessage).toBe('Importing history.');
    tick(3000);
    expect(history.fetchReadingHistoryPage).toHaveBeenCalledTimes(2);
    page.ionViewDidLeave();
    tick(6000);
    expect(history.fetchReadingHistoryPage).toHaveBeenCalledTimes(2);
    expect(page.items).toEqual([]);
    expect(page.loading).toBeFalse();
  }));

  it('only persists a preference after both systems confirm it', fakeAsync(() => {
    settings.update.and.returnValue(of({
      success: true, complete: false, historyStatus: 'pending', message: 'Pending.',
    }));
    settings.status.and.returnValues(
      of({ success: true, complete: false, historyStatus: 'pending', message: 'Pending.' }),
      of({ success: true, complete: true, historyStatus: 'disabled', message: 'History is off.' }),
    );
    const page = TestBed.runInInjectionContext(() => new AccountPreferencesPage());
    Object.assign(page as any, {
      activeAccountId: 'synthetic-account', activeUsername: 'synthetic-user',
      activePassword: 'synthetic-password', preferences: { keep_circ_history: true },
    });
    spyOn<any>(page, 'refreshPreferencesFromServer').and.resolveTo();
    page.updateCircHistory(false);
    tick(0);
    expect(prefs.persistPreferencesForAccount).not.toHaveBeenCalled();
    expect(page.saving).toBeTrue();
    tick(2000);
    expect(page.preferences?.keep_circ_history).toBeFalse();
    expect(prefs.persistPreferencesForAccount).toHaveBeenCalledTimes(1);
    expect(page.historyRetryEnabled).toBeNull();
    expect(page.saving).toBeFalse();
  }));

  it('offers retry without persisting a successful opt-out on partial failure', () => {
    settings.update.and.returnValue(of({
      success: false, complete: false, historyStatus: 'error', message: 'Not confirmed.',
    }));
    const page = TestBed.runInInjectionContext(() => new AccountPreferencesPage());
    Object.assign(page as any, {
      activeAccountId: 'synthetic-account', activeUsername: 'synthetic-user',
      activePassword: 'synthetic-password', preferences: { keep_circ_history: true },
    });
    spyOn<any>(page, 'refreshPreferencesFromServer').and.resolveTo();
    page.updateCircHistory(false);
    expect(prefs.persistPreferencesForAccount).not.toHaveBeenCalled();
    expect(page.historyRetryEnabled).toBeFalse();
    expect(page.historyUpdateMessage).toBe('Not confirmed.');
    expect(page.saving).toBeFalse();
  });
});
