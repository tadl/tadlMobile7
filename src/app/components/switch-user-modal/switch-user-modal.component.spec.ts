import { ElementRef } from '@angular/core';
import { TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { ModalController } from '@ionic/angular/lazy';
import { Subject } from 'rxjs';

import { Globals } from '../../globals';
import { AccountStoreService, type StoredAccountMeta } from '../../services/account-store.service';
import { AuthService, type AuthState } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { SwitchUserModalComponent } from './switch-user-modal.component';

describe('SwitchUserModalComponent request lifetime', () => {
  let component: SwitchUserModalComponent;
  let auth: jasmine.SpyObj<AuthService>;
  let accounts: jasmine.SpyObj<AccountStoreService>;
  let modals: jasmine.SpyObj<ModalController>;
  let ownModal: jasmine.SpyObj<HTMLIonModalElement>;
  let toast: jasmine.Spy;
  let refreshModalState: jasmine.Spy;
  let response: Subject<AuthState>;
  const account: StoredAccountMeta = {
    id: 'synthetic-account', username: 'example-user', label: 'Example User',
  };
  const authenticated: AuthState = {
    isLoggedIn: true, activeAccountId: account.id, activeAccountMeta: account, profile: null,
  };

  beforeEach(() => {
    response = new Subject<AuthState>();
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['login', 'switchAccount', 'snapshot']);
    auth.login.and.returnValue(response);
    auth.switchAccount.and.returnValue(response);
    auth.snapshot.and.returnValue({
      isLoggedIn: false, activeAccountId: null, activeAccountMeta: null, profile: null,
    });
    accounts = jasmine.createSpyObj<AccountStoreService>('AccountStoreService', ['listAccounts']);
    accounts.listAccounts.and.resolveTo([]);
    modals = jasmine.createSpyObj<ModalController>('ModalController', ['create', 'dismiss']);
    ownModal = jasmine.createSpyObj<HTMLIonModalElement>('OwnModal', ['dismiss']);
    ownModal.dismiss.and.resolveTo(true);
    const host = document.createElement('div');
    spyOn(host, 'closest').and.returnValue(ownModal);
    toast = jasmine.createSpy('presentToast');
    refreshModalState = jasmine.createSpy('refreshModalState').and.resolveTo();

    TestBed.configureTestingModule({ providers: [
      { provide: AuthService, useValue: auth },
      { provide: AccountStoreService, useValue: accounts },
      { provide: ModalController, useValue: modals },
      { provide: ElementRef, useValue: new ElementRef(host) },
      { provide: ToastService, useValue: { presentToast: toast } },
      { provide: Globals, useValue: { modal_open: true, refreshModalState } },
    ] });
    component = TestBed.runInInjectionContext(() => new SwitchUserModalComponent());
    component.username = 'example-user';
    component.password = 'synthetic-password';
  });

  afterEach(() => component.ngOnDestroy());

  it('cancels a pending login on close so late callbacks cannot dismiss another modal or show a toast', fakeAsync(() => {
    component.submitLogin();
    void component.close();
    response.next(authenticated);
    response.error(new Error('Synthetic late login failure'));
    flushMicrotasks();

    expect(response.observed).toBeFalse();
    expect(ownModal.dismiss).toHaveBeenCalledTimes(1);
    expect(modals.dismiss).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    expect(component.password).toBe('');
    expect(refreshModalState).toHaveBeenCalledTimes(1);
  }));

  it('dismisses its own overlay on successful switching and preserves the remaining modal state', fakeAsync(() => {
    refreshModalState.and.callFake(async () => { component.globals.modal_open = true; });
    component.tapStoredAccount(account);
    response.next(authenticated);
    flushMicrotasks();

    expect(ownModal.dismiss).toHaveBeenCalledTimes(1);
    expect(modals.dismiss).not.toHaveBeenCalled();
    expect(component.globals.modal_open).toBeTrue();
  }));

  it('cancels a pending account switch when destroyed', () => {
    component.tapStoredAccount(account);
    component.ngOnDestroy();
    response.next(authenticated);
    response.error(new Error('missing_password'));

    expect(response.observed).toBeFalse();
    expect(ownModal.dismiss).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('ignores an earlier login attempt while keeping the current attempt error feedback', () => {
    const firstResponse = response;
    component.submitLogin();
    response = new Subject<AuthState>();
    auth.login.and.returnValue(response);
    component.password = 'synthetic-retry-password';
    component.submitLogin();
    firstResponse.error(new Error('invalid_login'));

    expect(firstResponse.observed).toBeFalse();
    expect(component.password).toBe('synthetic-retry-password');
    expect(toast).not.toHaveBeenCalled();
    response.error(new Error('invalid_login'));
    expect(component.password).toBe('');
    expect(toast).toHaveBeenCalledOnceWith('Login failed. Check your username/password and try again.');
  });

  it('ignores saved accounts that finish loading after destruction', fakeAsync(() => {
    let resolveAccounts!: (value: StoredAccountMeta[]) => void;
    accounts.listAccounts.and.returnValue(new Promise(resolve => { resolveAccounts = resolve; }));
    component.ngOnInit();
    component.ngOnDestroy();
    resolveAccounts([account]);
    flushMicrotasks();

    expect(component.storedAccounts).toEqual([]);
  }));

  it('does not present a password-reset overlay created after the dialog closes', fakeAsync(() => {
    let resolveModal!: (value: HTMLIonModalElement) => void;
    const resetModal = jasmine.createSpyObj<HTMLIonModalElement>('ResetModal', ['present', 'remove']);
    modals.create.and.returnValue(new Promise(resolve => { resolveModal = resolve; }));
    void component.troubleLoggingIn();
    void component.close();
    resolveModal(resetModal);
    flushMicrotasks();

    expect(resetModal.present).not.toHaveBeenCalled();
    expect(resetModal.remove).toHaveBeenCalledTimes(1);
    expect(ownModal.dismiss).toHaveBeenCalledTimes(1);
  }));
});
