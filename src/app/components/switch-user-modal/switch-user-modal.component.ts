import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController } from '@ionic/angular';

import { Globals } from '../../globals';
import { ToastService } from '../../services/toast.service';
import { AuthService } from '../../services/auth.service';
import { AccountStoreService, StoredAccountMeta } from '../../services/account-store.service';

@Component({
  standalone: true,
  selector: 'app-switch-user-modal',
  templateUrl: './switch-user-modal.component.html',
  styleUrls: ['./switch-user-modal.component.scss'],
  imports: [CommonModule, IonicModule, FormsModule],
})
export class SwitchUserModalComponent implements OnInit {
  username = '';
  password = '';
  showPassword = false;

  storedAccounts: StoredAccountMeta[] = [];
  loadingAccounts = false;

  constructor(
    public globals: Globals,
    public auth: AuthService,
    private accounts: AccountStoreService,
    private toast: ToastService,
    private modalCtrl: ModalController,
  ) {}

  ngOnInit() {
    this.refreshStoredAccounts();
  }

  close() {
    void this.modalCtrl.dismiss();
    this.globals.modal_open = false;
  }

  refreshStoredAccounts() {
    this.loadingAccounts = true;
    this.accounts.listAccounts()
      .then((list) => {
        this.storedAccounts = list ?? [];
      })
      .catch(() => {
        this.storedAccounts = [];
      })
      .finally(() => {
        this.loadingAccounts = false;
      });
  }

  accountLabel(a: StoredAccountMeta): string {
    const label = (a?.label ?? '').toString().trim();
    return label || a.username || 'Account';
  }

  tapStoredAccount(acct: StoredAccountMeta) {
    const snap = this.auth.snapshot();
    if (snap.isLoggedIn && snap.activeAccountId === acct.id) {
      this.close();
      return;
    }

    this.auth.switchAccount(acct.id).subscribe({
      next: () => {
        this.close();
      },
      error: (e) => {
        const msg = e?.message ?? '';
        if (msg === 'missing_password') {
          this.toast.presentToast('No password stored for that account. Please log in manually.');
        } else {
          this.toast.presentToast('Could not switch user.');
        }
      },
    });
  }

  troubleLoggingIn() {
    this.globals.open_page('https://discover.tadl.org/MyAccount/Home');
  }

  submitLogin() {
    const u = (this.username ?? '').trim();
    const p = (this.password ?? '').trim();

    if (!u || !p) {
      this.toast.presentToast('Please enter your username and password.');
      return;
    }

    this.auth.login(u, p).subscribe({
      next: () => {
        this.password = '';
        this.username = '';
        this.close();
      },
      error: (e) => {
        this.password = '';
        const msg = e?.message ?? '';
        if (msg === 'invalid_login') this.toast.presentToast('Login failed. Check your username/password and try again.');
        else this.toast.presentToast('Login failed. Please try again.');
      },
    });
  }

  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }
}
