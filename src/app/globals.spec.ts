import { TestBed } from '@angular/core/testing';
import { AlertController, MenuController, ModalController, Platform } from '@ionic/angular/lazy';

import { Globals } from './globals';

describe('Globals modal navigation', () => {
  let globals: Globals;
  let modals: jasmine.SpyObj<ModalController>;
  let alerts: jasmine.SpyObj<AlertController>;

  beforeEach(() => {
    modals = jasmine.createSpyObj<ModalController>('ModalController', ['getTop']);
    alerts = jasmine.createSpyObj<AlertController>('AlertController', ['create']);
    TestBed.configureTestingModule({ providers: [
      { provide: ModalController, useValue: modals },
      { provide: AlertController, useValue: alerts },
      { provide: MenuController, useValue: {} },
      { provide: Platform, useValue: {} },
    ] });
    globals = TestBed.inject(Globals);
  });

  it('dismisses the actual top modal even when a nested close cleared the legacy flag', async () => {
    const parent = document.createElement('ion-modal');
    const child = jasmine.createSpyObj<HTMLIonModalElement>('ChildModal', ['dismiss']);
    const dismissed = child.dismiss.and.resolveTo(true);
    modals.getTop.and.returnValues(Promise.resolve(child), Promise.resolve(parent));
    globals.modal_open = false;
    await globals.confirm_exit();
    expect(dismissed).toHaveBeenCalledOnceWith('Wrapped up!');
    expect(globals.modal_open).toBeTrue();
    expect(alerts.create).not.toHaveBeenCalled();
  });

  it('keeps back navigation inside a modal that refuses dismissal', async () => {
    const modal = jasmine.createSpyObj<HTMLIonModalElement>('Modal', ['dismiss']);
    modal.dismiss.and.resolveTo(false);
    modals.getTop.and.resolveTo(modal);
    const history = spyOn(window.history, 'back');
    await globals.go_back();
    expect(history).not.toHaveBeenCalled();
    expect(globals.modal_open).toBeTrue();
  });

  it('navigates back normally when no modal exists despite a stale flag', async () => {
    modals.getTop.and.resolveTo(undefined);
    globals.modal_open = true;
    const history = spyOn(window.history, 'back');
    await globals.go_back();
    expect(history).toHaveBeenCalledTimes(1);
    expect(globals.modal_open).toBeFalse();
  });
});
