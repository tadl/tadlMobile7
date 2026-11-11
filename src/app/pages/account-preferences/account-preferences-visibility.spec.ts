import { TestBed } from '@angular/core/testing';
import { APP_TEST_PROVIDERS } from '../../../testing/app-test-providers';
import { AccountPreferencesService } from '../../services/account-preferences.service';
import { AccountStoreService } from '../../services/account-store.service';
import { AuthService } from '../../services/auth.service';
import { HistorySettingsService } from '../../services/history-settings.service';
import { AccountPreferencesPage } from './account-preferences.page';

describe('Account preferences search location', () => {
  it('keeps the helper search preference out of the UI and preserves it when changing pickup', async () => {
    await TestBed.configureTestingModule({
      imports: [AccountPreferencesPage],
      providers: [
        ...APP_TEST_PROVIDERS,
        { provide: AccountPreferencesService, useValue: {} },
        { provide: AccountStoreService, useValue: {} },
        { provide: AuthService, useValue: {} },
        { provide: HistorySettingsService, useValue: {} },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AccountPreferencesPage);
    const page = fixture.componentInstance;
    page.preferences = {
      username: 'synthetic-patron', hold_shelf_alias: '',
      day_phone: '', evening_phone: '', other_phone: '', email: '', melcat_id: '',
      pickup_library: page.pickupOptions[0].code, default_search: 'synthetic-search-location',
      keep_circ_history: false, keep_hold_history: false,
      email_notify: false, phone_notify: false, text_notify: false,
      phone_notify_number: '', text_notify_number: '',
    };
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).not.toMatch(/search (?:location|library)/i);
    expect(host.textContent).not.toContain('synthetic-search-location');
    expect(host.querySelector('[name="default_search"]')).toBeNull();

    const submit = spyOn(page as unknown as { submitUpdate: (...args: unknown[]) => void }, 'submitUpdate');
    page.onPickupLibraryChanged(new CustomEvent('ionChange', { detail: { value: page.pickupOptions[0].code } }));
    expect(submit).toHaveBeenCalledWith(jasmine.objectContaining({
      pickup_library: page.pickupOptions[0].code,
      default_search: 'synthetic-search-location',
    }), undefined, false);
    fixture.destroy();
  });
});
