import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ActionSheetController, ModalController } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { filter } from 'rxjs';

import { Globals } from '../../globals';
import { ToastService } from '../../services/toast.service';
import { AuthService } from '../../services/auth.service';
import { AccountStoreService, StoredAccountMeta } from '../../services/account-store.service';
import { PatronService } from '../../services/patron.service';
import { ShowCardModalComponent } from '../../components/show-card-modal/show-card-modal.component';
import { ListsService } from '../../services/lists.service';

@Component({
  standalone: true,
  selector: 'app-account-page',
  templateUrl: './account.page.html',
  styleUrls: ['./account.page.scss'],
  imports: [CommonModule, IonicModule, FormsModule],
})
export class AccountPage implements OnInit {
  username = '';
  password = '';
  myListsCount = 0;

  storedAccounts: StoredAccountMeta[] = [];
  loadingAccounts = false;

  // when true, show "stored accounts + login form" while still logged in
  showSwitchUser = false;

  constructor(
    public globals: Globals,
    public auth: AuthService,
    public patron: PatronService,
    private router: Router,
    private accounts: AccountStoreService,
    private toast: ToastService,
    private actionSheet: ActionSheetController,
    private modal: ModalController,
    private lists: ListsService,
  ) {}

  ngOnInit() {
    this.refreshStoredAccounts();
    this.auth.authState()
      .pipe(filter((s) => !!s?.isLoggedIn))
      .subscribe(() => {
        this.refreshMyListsCount();
      });
    this.refreshMyListsCount();
  }

  refreshStoredAccounts() {
    this.loadingAccounts = true;
    this.accounts
      .listAccounts()
      .then(list => {
        this.storedAccounts = list ?? [];
      })
      .catch(() => {
        this.storedAccounts = [];
      })
      .finally(() => {
        this.loadingAccounts = false;
      });
  }

  // Use firstname + lastname, per your request
  loggedInName(profile: any): string {
    const first = (profile?.firstname ?? '').toString().trim();
    const last = (profile?.lastname ?? '').toString().trim();
    const combined = `${first} ${last}`.trim();
    return combined || 'Unknown';
  }

  loggedInNameUpper(profile: any): string {
    return this.loggedInName(profile).toUpperCase();
  }

  // Small label for list (keep it compact)
  accountLabel(a: StoredAccountMeta): string {
    // if stored meta label exists, use it; otherwise fall back
    const label = (a?.label ?? '').toString().trim();
    return label || a.username || 'Account';
  }

  toggleSwitchUser() {
    this.showSwitchUser = !this.showSwitchUser;
    if (this.showSwitchUser) this.refreshStoredAccounts();
  }

  // “Cancel” by selecting the active account in the list
  closeSwitchUser() {
    this.showSwitchUser = false;
    this.password = '';
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
        this.showSwitchUser = false;
        this.refreshStoredAccounts();
      },
      error: (e) => {
        const msg = e?.message ?? '';
        if (msg === 'invalid_login') this.toast.presentToast('Login failed. Check your username/password and try again.');
        else this.toast.presentToast('Login failed. Please try again.');
      },
    });
  }

  tapStoredAccount(acct: StoredAccountMeta) {
    const snap = this.auth.snapshot();

    // If they tap the currently active account, that’s the “cancel”
    if (snap.isLoggedIn && snap.activeAccountId === acct.id) {
      this.closeSwitchUser();
      return;
    }

    this.auth.switchAccount(acct.id).subscribe({
      next: () => {
        this.showSwitchUser = false;
        this.refreshStoredAccounts();
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

  async showLogoutActions() {
    const snap = this.auth.snapshot();
    const activeId = snap.activeAccountId;

    const sheet = await this.actionSheet.create({
      header: 'Logout',
      buttons: [
        {
          text: 'Logout',
          role: 'destructive',
          handler: () => {
            this.auth.logout().subscribe({
              next: () => {
                this.toast.presentToast('Logged out.');
                this.showSwitchUser = false;
              },
              error: () => this.toast.presentToast('Logout failed.'),
            });
          },
        },
        {
          text: 'Logout and remove saved account',
          role: 'destructive',
          handler: () => {
            // Logout first; then remove the account+password
            this.auth.logout().subscribe({
              next: async () => {
                try {
                  if (activeId) await this.accounts.removeAccount(activeId);
                } catch {
                  // ignore, but we can warn later if you want
                }
                this.toast.presentToast('Logged out and removed saved account.');
                this.showSwitchUser = false;
                this.refreshStoredAccounts();
              },
              error: () => this.toast.presentToast('Logout failed.'),
            });
          },
        },
        {
          text: 'Cancel',
          role: 'cancel',
        },
      ],
    });

    await sheet.present();
  }

  async showCard() {
    const snap = this.auth.snapshot();
    const barcode = (snap?.profile?.ils_barcode ?? '').toString().trim();
    const melcatId = (snap?.profile?.username ?? snap?.profile?.unique_ils_id ?? '').toString().trim();
    if (!barcode) {
      this.toast.presentToast('No barcode found on this account.');
      return;
    }

    const m = await this.modal.create({
      component: ShowCardModalComponent,
      componentProps: { barcode, melcatId },
    });
    this.globals.modal_open = true;
    await m.present();
  }

  goHolds() {
    this.goAccountPage('/holds');
  }

  goCheckouts() {
    this.goAccountPage('/checkouts');
  }

  goMyLists() {
    this.goAccountPage('/my-lists');
  }

  goFines() { this.goAccountPage('/fines'); }
  goHistory() {
    this.goAccountPage('/checkout-history');
  }
  goPrefs() { this.goAccountPage('/account-preferences'); }

  themeMode(): 'light' | 'dark' {
    return this.globals.theme_mode;
  }

  onThemeChange(ev: CustomEvent) {
    const value = (ev.detail as { value?: string } | undefined)?.value;
    if (value !== 'light' && value !== 'dark') return;
    void this.globals.setTheme(value);
  }

  private refreshMyListsCount() {
    const snap = this.auth.snapshot();
    if (!snap?.isLoggedIn || !snap?.activeAccountId) {
      this.myListsCount = 0;
      return;
    }

    this.lists.fetchUserLists().subscribe({
      next: (list) => {
        this.myListsCount = Array.isArray(list) ? list.length : 0;
      },
      error: () => {
        // Keep previous value; this is a non-blocking badge enhancement.
      },
    });
  }

  private goAccountPage(url: string) {
    this.router.navigateByUrl(url);
  }
}
