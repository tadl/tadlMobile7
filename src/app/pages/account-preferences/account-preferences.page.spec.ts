import { ComponentFixture, TestBed } from '@angular/core/testing';
import { APP_TEST_PROVIDERS } from '../../../testing/app-test-providers';
import { AccountPreferencesService } from '../../services/account-preferences.service';
import { AccountStoreService } from '../../services/account-store.service';
import { AuthService } from '../../services/auth.service';
import { HistorySettingsService } from '../../services/history-settings.service';
import { AccountPreferencesPage } from './account-preferences.page';

describe('Account preferences pickup selector', () => {
  let fixture: ComponentFixture<AccountPreferencesPage>;
  let select: HTMLIonSelectElement;
  let popover: HTMLIonPopoverElement | undefined;

  beforeEach(async () => {
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
    fixture = TestBed.createComponent(AccountPreferencesPage);
    const page = fixture.componentInstance;
    page.preferences = {
      username: 'synthetic-patron', hold_shelf_alias: '',
      day_phone: '', evening_phone: '', other_phone: '', email: '', melcat_id: '',
      pickup_library: page.pickupOptions[0].code, default_search: '',
      keep_circ_history: false, keep_hold_history: false,
      email_notify: false, phone_notify: false, text_notify: false,
      phone_notify_number: '', text_notify_number: '',
    };
    const host = fixture.nativeElement as HTMLElement;
    host.style.cssText = 'display:block;width:320px;height:700px';
    fixture.detectChanges();
    select = host.querySelector<HTMLIonSelectElement>('ion-select.pickup-library-select')!;
    await customElements.whenDefined('ion-select');
    if (select.componentOnReady) await select.componentOnReady();
    await fixture.whenStable();
  });

  afterEach(async () => {
    if (popover) {
      await popover.dismiss();
      popover.remove();
      popover = undefined;
    }
    fixture.destroy();
  });

  it('uses a full-row stacked label and a content-sized popover', () => {
    expect(select.label).toBe('Pickup Library');
    expect(select.labelPlacement).toBe('stacked');
    expect(select.slot).not.toBe('end');
    expect(getComputedStyle(select).maxWidth).toBe('100%');
    expect(select.interfaceOptions).toEqual({
      cssClass: 'pickup-library-popover', size: 'auto', alignment: 'center',
    });
  });

  it('keeps the actual popup on screen and allows long option labels to wrap', async () => {
    const event = new MouseEvent('pointerdown', { bubbles: true });
    select.dispatchEvent(event);
    popover = await select.open(event) as HTMLIonPopoverElement;
    const content = popover.shadowRoot!.querySelector<HTMLElement>('[part="content"]')!;
    const bounds = content.getBoundingClientRect();
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(window.innerWidth);
    expect(popover.size).toBe('auto');
    expect(popover.classList.contains('pickup-library-popover')).toBeTrue();
    const label = popover.querySelector<HTMLElement>('.select-option-label')!;
    expect(getComputedStyle(label).whiteSpace).toBe('normal');
    expect(getComputedStyle(label).overflowWrap).toBe('anywhere');
  });

  it('retains the selected library and disables changes while saving', () => {
    expect(select.value).toBe(fixture.componentInstance.pickupOptions[0].code);
    fixture.componentInstance.saving = true;
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    expect(select.disabled).toBeTrue();
  });
});
