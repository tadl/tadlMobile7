import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController } from '@ionic/angular/lazy';
import { Subscription } from 'rxjs';

import { Globals } from '../../globals';
import { ToastService } from '../../services/toast.service';
import { AuthService } from '../../services/auth.service';
import {
  AccountStoreService,
  StoredAccountMeta,
} from '../../services/account-store.service';
import { PasswordResetModalComponent } from '../password-reset-modal/password-reset-modal.component';

@Component({
  standalone: true,
  selector: 'app-switch-user-modal',
  templateUrl: './switch-user-modal.component.html',
  styleUrls: ['./switch-user-modal.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [CommonModule, IonicModule, FormsModule],
})
export class SwitchUserModalComponent implements OnInit, OnDestroy {
  globals = inject(Globals);
  auth = inject(AuthService);
  private accounts = inject(AccountStoreService);
  private toast = inject(ToastService);
  private modalCtrl = inject(ModalController);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private authRequest?: Subscription;
  private authRevision = 0;
  private closed = false;

  username = '';
  password = '';
  showPassword = false;

  storedAccounts: StoredAccountMeta[] = [];
  loadingAccounts = false;

  ngOnInit() {
    this.refreshStoredAccounts();
  }

  ngOnDestroy() {
    this.stopRequests();
  }

  async close() {
    if (this.closed) return;
    this.stopRequests();
    this.password = '';
    const modal = this.host.nativeElement.closest<HTMLIonModalElement>('ion-modal');
    await modal?.dismiss();
    await this.globals.refreshModalState();
  }

  refreshStoredAccounts() {
    if (this.closed) return;
    this.loadingAccounts = true;
    this.accounts
      .listAccounts()
      .then((list) => {
        if (this.closed) return;
        this.storedAccounts = list ?? [];
      })
      .catch(() => {
        if (this.closed) return;
        this.storedAccounts = [];
      })
      .finally(() => {
        if (this.closed) return;
        this.loadingAccounts = false;
      });
  }

  accountLabel(a: StoredAccountMeta): string {
    const label = (a?.label ?? '').toString().trim();
    return label || a.username || 'Account';
  }

  tapStoredAccount(acct: StoredAccountMeta) {
    if (this.closed) return;
    const snap = this.auth.snapshot();
    if (snap.isLoggedIn && snap.activeAccountId === acct.id) {
      void this.close();
      return;
    }

    const revision = this.beginAuthRequest();
    this.authRequest = this.auth.switchAccount(acct.id).subscribe({
      next: () => {
        if (!this.isCurrentAuthRequest(revision)) return;
        void this.close();
      },
      error: (e) => {
        if (!this.isCurrentAuthRequest(revision)) return;
        const msg = e?.message ?? '';
        if (msg === 'missing_password') {
          this.toast.presentToast(
            'No password stored for that account. Please log in manually.'
          );
        } else {
          this.toast.presentToast('Could not switch user.');
        }
      },
    });
  }

  async troubleLoggingIn() {
    if (this.closed) return;
    const m = await this.modalCtrl.create({
      component: PasswordResetModalComponent,
    });
    if (this.closed) {
      m.remove();
      return;
    }
    this.globals.modal_open = true;
    await m.present();
    if (this.closed) {
      await m.dismiss();
      await this.globals.refreshModalState();
    }
  }

  submitLogin() {
    if (this.closed) return;
    const u = (this.username ?? '').trim();
    const p = (this.password ?? '').trim();

    if (!u || !p) {
      this.toast.presentToast('Please enter your username and password.');
      return;
    }

    const revision = this.beginAuthRequest();
    this.authRequest = this.auth.login(u, p).subscribe({
      next: () => {
        if (!this.isCurrentAuthRequest(revision)) return;
        this.password = '';
        this.username = '';
        void this.close();
      },
      error: (e) => {
        if (!this.isCurrentAuthRequest(revision)) return;
        this.password = '';
        const msg = e?.message ?? '';
        if (msg === 'invalid_login')
          this.toast.presentToast(
            'Login failed. Check your username/password and try again.'
          );
        else this.toast.presentToast('Login failed. Please try again.');
      },
    });
  }

  private beginAuthRequest(): number {
    this.authRequest?.unsubscribe();
    return ++this.authRevision;
  }

  private isCurrentAuthRequest(revision: number): boolean {
    return !this.closed && revision === this.authRevision;
  }

  private stopRequests() {
    this.closed = true;
    this.authRevision += 1;
    this.authRequest?.unsubscribe();
  }

  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }
}
