import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonicModule,
  ActionSheetController,
  AlertController,
} from '@ionic/angular';
import { finalize } from 'rxjs';

import { Globals } from '../../globals';
import { ToastService } from '../../services/toast.service';
import { AuthService } from '../../services/auth.service';
import { AccountStoreService } from '../../services/account-store.service';
import {
  AccountPreferencesService,
  type AccountPreferences,
} from '../../services/account-preferences.service';

interface SelectOption {
  code: string;
  name: string;
}

@Component({
  standalone: true,
  selector: 'app-account-preferences',
  templateUrl: './account-preferences.page.html',
  styleUrls: ['./account-preferences.page.scss'],
  imports: [CommonModule, FormsModule, IonicModule],
})
export class AccountPreferencesPage {
  loading = false;
  saving = false;

  preferences: AccountPreferences | null = null;

  private token = '';
  private activeAccountId = '';
  private activeUsername = '';
  private activePassword = '';
  private ignoreCircHistoryChange = false;

  readonly pickupOptions: SelectOption[] = [
    { name: 'Traverse City', code: '23' },
    { name: 'Interlochen', code: '24' },
    { name: 'Kingsley', code: '25' },
    { name: 'Peninsula', code: '26' },
    { name: 'Fife Lake', code: '27' },
    { name: 'East Bay', code: '28' },
  ];

  readonly searchOptions: SelectOption[] = [
    { name: 'All locations', code: '22' },
    ...this.pickupOptions,
  ];

  constructor(
    public globals: Globals,
    private auth: AuthService,
    private accounts: AccountStoreService,
    private prefsService: AccountPreferencesService,
    private actionSheetController: ActionSheetController,
    private alertController: AlertController,
    private toast: ToastService,
  ) {}

  ionViewWillEnter() {
    this.loadPreferences();
  }

  onPickupLibraryChanged(ev: CustomEvent) {
    const next = (ev?.detail as any)?.value?.toString?.() ?? '';
    if (!this.preferences || !next || this.saving) return;

    this.submitUpdate(
      {
        circ_prefs_changed: true,
        pickup_library: next,
        default_search: this.preferences.default_search,
        keep_circ_history: this.preferences.keep_circ_history,
        keep_hold_history: this.preferences.keep_hold_history,
      },
      undefined,
      false,
    );
  }

  onDefaultSearchChanged(ev: CustomEvent) {
    const next = (ev?.detail as any)?.value?.toString?.() ?? '';
    if (!this.preferences || !next || this.saving) return;

    this.submitUpdate(
      {
        circ_prefs_changed: true,
        pickup_library: this.preferences.pickup_library,
        default_search: next,
        keep_circ_history: this.preferences.keep_circ_history,
        keep_hold_history: this.preferences.keep_hold_history,
      },
      undefined,
      false,
    );
  }

  async onKeepCircHistoryToggle(ev: CustomEvent) {
    const checked = !!(ev?.detail as any)?.checked;
    if (!this.preferences || this.saving) return;

    if (this.ignoreCircHistoryChange) {
      this.ignoreCircHistoryChange = false;
      return;
    }

    if (!checked) {
      const sheet = await this.actionSheetController.create({
        header: 'Warning: turning off checkout history will permanently delete your existing history.',
        buttons: [
          {
            text: 'Delete Checkout History',
            role: 'destructive',
            handler: () => this.updateCircHistory(false),
          },
          {
            text: 'Cancel',
            role: 'cancel',
            handler: () => {
              this.ignoreCircHistoryChange = true;
              if (this.preferences) this.preferences.keep_circ_history = true;
            },
          },
        ],
      });
      await sheet.present();
      return;
    }

    this.updateCircHistory(true);
  }

  private updateCircHistory(enabled: boolean) {
    if (!this.preferences) return;

    this.submitUpdate(
      {
        circ_prefs_changed: true,
        pickup_library: this.preferences.pickup_library,
        default_search: this.preferences.default_search,
        keep_circ_history: enabled,
        keep_hold_history: this.preferences.keep_hold_history,
      },
      undefined,
      false,
    );
  }

  async updateUsername() {
    const alert = await this.alertController.create({
      header: 'Change Username',
      message: 'Enter your new username and your current password.',
      inputs: [
        {
          name: 'username',
          type: 'text',
          placeholder: 'New username',
          value: this.preferences?.username ?? '',
        },
        {
          name: 'current_password',
          type: 'password',
          placeholder: 'Current password',
        },
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Save',
          handler: (values) => {
            const username = (values?.username ?? '').toString().trim();
            const currentPassword = (values?.current_password ?? '').toString();
            if (!this.preferences) return false;
            if (!username || username === this.preferences.username) return false;
            if (!currentPassword) {
              this.toast.presentToast('Current password is required.');
              return false;
            }

            this.submitUpdate(
              {
                user_prefs_changed: true,
                username_changed: true,
                username,
                current_password: currentPassword,
              },
              undefined,
              true,
              () => this.persistUsername(username),
            );

            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  async updateAlias() {
    const alert = await this.alertController.create({
      header: 'Change Holdshelf Alias',
      message: 'Enter a new holdshelf alias and your current password.',
      inputs: [
        {
          name: 'hold_shelf_alias',
          type: 'text',
          placeholder: 'New holdshelf alias',
          value: this.preferences?.hold_shelf_alias ?? '',
        },
        {
          name: 'current_password',
          type: 'password',
          placeholder: 'Current password',
        },
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Save',
          handler: (values) => {
            const alias = (values?.hold_shelf_alias ?? '').toString().trim();
            const currentPassword = (values?.current_password ?? '').toString();
            if (!this.preferences) return false;
            if (!alias || alias === this.preferences.hold_shelf_alias) return false;
            if (!currentPassword) {
              this.toast.presentToast('Current password is required.');
              return false;
            }

            this.submitUpdate(
              {
                user_prefs_changed: true,
                hold_shelf_alias_changed: true,
                hold_shelf_alias: alias,
                current_password: currentPassword,
              },
              undefined,
              true,
            );

            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  async updateEmail() {
    const alert = await this.alertController.create({
      header: 'Change Email Address',
      message: 'Enter your new email address and your current password.',
      inputs: [
        {
          name: 'email',
          type: 'email',
          placeholder: 'Email address',
          value: this.preferences?.email ?? '',
        },
        {
          name: 'current_password',
          type: 'password',
          placeholder: 'Current password',
        },
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Save',
          handler: (values) => {
            const email = (values?.email ?? '').toString().trim();
            const currentPassword = (values?.current_password ?? '').toString();
            if (!this.preferences) return false;
            if (!email || email === this.preferences.email) return false;
            if (!currentPassword) {
              this.toast.presentToast('Current password is required.');
              return false;
            }

            this.submitUpdate(
              {
                user_prefs_changed: true,
                email_changed: true,
                email,
                current_password: currentPassword,
              },
              undefined,
              true,
            );

            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  async updatePassword() {
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d!@#$%^&*()\-_=+\[\]{};:'",.<>/?\\|]{7,}$/;

    const alert = await this.alertController.create({
      header: 'Change Password',
      message: 'Enter your new password twice and your current password.',
      inputs: [
        {
          name: 'new_password1',
          type: 'password',
          placeholder: 'New password',
        },
        {
          name: 'new_password2',
          type: 'password',
          placeholder: 'New password again',
        },
        {
          name: 'current_password',
          type: 'password',
          placeholder: 'Current password',
        },
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Save',
          handler: (values) => {
            const newPw1 = (values?.new_password1 ?? '').toString();
            const newPw2 = (values?.new_password2 ?? '').toString();
            const currentPassword = (values?.current_password ?? '').toString();

            if (newPw1 !== newPw2) {
              this.toast.presentToast('Passwords did not match.');
              return false;
            }
            if (!currentPassword) {
              this.toast.presentToast('Current password is required.');
              return false;
            }
            if (!passwordRegex.test(newPw1)) {
              this.toast.presentToast('Password must be at least 7 characters and include one letter and one number.', 8000);
              return false;
            }

            this.submitUpdate(
              {
                user_prefs_changed: true,
                password_changed: true,
                new_password: newPw1,
                current_password: currentPassword,
              },
              undefined,
              true,
              () => this.persistPassword(newPw1),
            );

            return true;
          },
        },
      ],
    });

    await alert.present();
  }

  async updatePhoneNotifyNumber() {
    const alert = await this.alertController.create({
      header: 'Change Phone Notify Number',
      message: 'Enter a 10-digit phone number for voice notifications.',
      inputs: [
        {
          name: 'phone_notify_number',
          type: 'tel',
          placeholder: '231-111-1111',
          value: this.preferences?.phone_notify_number ?? '',
        },
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Save',
          handler: (values) => {
            const formatted = this.formatTenDigitPhone(values?.phone_notify_number);
            if (!formatted) {
              this.toast.presentToast('Please enter a 10-digit phone number.');
              return false;
            }
            if (!this.preferences) return false;
            if (formatted === this.preferences.phone_notify_number) {
              this.toast.presentToast('New number matches current number.');
              return false;
            }

            this.submitUpdate(
              {
                notify_prefs_changed: true,
                phone_notify_number: formatted,
                text_notify_number: this.preferences.text_notify_number,
                email_notify: this.preferences.email_notify,
                phone_notify: this.preferences.phone_notify,
                text_notify: this.preferences.text_notify,
              },
              undefined,
              false,
            );
            return true;
          },
        },
      ],
    });

    await alert.present();
  }

  async updateTextNotifyNumber() {
    const alert = await this.alertController.create({
      header: 'Change Text Notify Number',
      message: 'Enter a 10-digit phone number for text notifications.',
      inputs: [
        {
          name: 'text_notify_number',
          type: 'tel',
          placeholder: '231-111-1111',
          value: this.preferences?.text_notify_number ?? '',
        },
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Save',
          handler: (values) => {
            const formatted = this.formatTenDigitPhone(values?.text_notify_number);
            if (!formatted) {
              this.toast.presentToast('Please enter a 10-digit phone number.');
              return false;
            }
            if (!this.preferences) return false;
            if (formatted === this.preferences.text_notify_number) {
              this.toast.presentToast('New number matches current number.');
              return false;
            }

            this.submitUpdate(
              {
                notify_prefs_changed: true,
                phone_notify_number: this.preferences.phone_notify_number,
                text_notify_number: formatted,
                email_notify: this.preferences.email_notify,
                phone_notify: this.preferences.phone_notify,
                text_notify: this.preferences.text_notify,
              },
              undefined,
              false,
            );
            return true;
          },
        },
      ],
    });

    await alert.present();
  }

  onToggleNotify(method: 'email_notify' | 'phone_notify' | 'text_notify', checked: boolean) {
    if (!this.preferences || this.saving) return;

    this.submitUpdate(
      {
        notify_prefs_changed: true,
        phone_notify_number: this.preferences.phone_notify_number,
        text_notify_number: this.preferences.text_notify_number,
        email_notify: method === 'email_notify' ? checked : this.preferences.email_notify,
        phone_notify: method === 'phone_notify' ? checked : this.preferences.phone_notify,
        text_notify: method === 'text_notify' ? checked : this.preferences.text_notify,
      },
      undefined,
      false,
    );
  }

  async loadPreferences(ev?: any) {
    if (this.loading) {
      ev?.target?.complete?.();
      return;
    }

    this.loading = true;

    try {
      const active = this.auth.snapshot().activeAccountMeta;
      if (!active?.id || !active?.username) {
        this.toast.presentToast('No active account found.');
        this.loading = false;
        ev?.target?.complete?.();
        return;
      }

      const pw = await this.accounts.getPassword(active.id);
      if (!pw) {
        this.toast.presentToast('Could not read saved password for this account.');
        this.loading = false;
        ev?.target?.complete?.();
        return;
      }

      this.activeUsername = active.username;
      this.activeAccountId = active.id;
      this.activePassword = pw;

      const cached = await this.prefsService.getCachedPreferences(this.activeAccountId);
      if (cached) {
        this.preferences = cached;
      }

      this.prefsService
        .fetchForAccount(this.activeAccountId, this.activeUsername, this.activePassword)
        .pipe(
          finalize(() => {
            this.loading = false;
            ev?.target?.complete?.();
          }),
        )
        .subscribe({
          next: (res) => {
            if (!res.token || !res.preferences) {
              this.toast.presentToast('Could not load account preferences.');
              return;
            }
            this.token = (res.token ?? '').toString().trim();
            this.preferences = res.preferences;
            if (this.activeAccountId && this.token) {
              void this.prefsService.persistTokenForAccount(this.activeAccountId, this.token);
            }
          },
          error: () => this.toast.presentToast('Could not load account preferences.'),
        });
    } catch {
      this.loading = false;
      ev?.target?.complete?.();
      this.toast.presentToast('Could not load account preferences.');
    }
  }

  private submitUpdate(
    values: Record<string, string | number | boolean>,
    successToast?: string,
    showDefaultSuccessToast: boolean = true,
    onSuccess?: () => void,
  ) {
    if (!this.activeAccountId || !this.activeUsername || !this.activePassword) {
      this.toast.presentToast('Missing account credentials. Pull to refresh and try again.');
      return;
    }
    if (this.saving) return;

    this.saving = true;

    this.prefsService
      .updateForAccount(
        this.activeAccountId,
        this.activeUsername,
        this.activePassword,
        this.token,
        values,
      )
      .pipe(finalize(() => (this.saving = false)))
      .subscribe({
        next: (res) => {
          if (!res.success) {
            this.toast.presentToast(res.message || 'Could not update preferences.');
            return;
          }

          const freshToken = (res.token ?? '').toString().trim();
          if (freshToken) {
            this.token = freshToken;
          }

          if (res.preferences) {
            this.preferences = res.preferences;
            if (this.activeAccountId) {
              void this.prefsService.persistPreferencesForAccount(this.activeAccountId, res.preferences);
            }
          }
          if (this.activeAccountId && this.token) {
            void this.prefsService.persistTokenForAccount(this.activeAccountId, this.token);
          }

          if (onSuccess) onSuccess();
          void this.refreshTokenFromCache();
          void this.refreshPreferencesFromServer();

          if (successToast) {
            this.toast.presentToast(successToast);
          } else if (showDefaultSuccessToast && res.message) {
            this.toast.presentToast(res.message);
          }
        },
        error: () => this.toast.presentToast('Could not update preferences.'),
      });
  }

  private async persistUsername(newUsername: string) {
    const snap = this.auth.snapshot();
    if (!snap.activeAccountMeta) return;
    await this.accounts.upsertAccountMeta({
      id: snap.activeAccountMeta.id,
      username: newUsername,
      label: snap.activeAccountMeta.label,
    });
    this.activeUsername = newUsername;
  }

  private async persistPassword(newPassword: string) {
    const snap = this.auth.snapshot();
    if (!snap.activeAccountMeta) return;
    await this.accounts.setPassword(snap.activeAccountMeta.id, newPassword);
    this.activePassword = newPassword;
  }

  private formatTenDigitPhone(value: any): string | null {
    const digits = `${value ?? ''}`.replace(/\D/g, '');
    if (digits.length !== 10) return null;
    return digits.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');
  }

  private async refreshTokenFromCache() {
    if (!this.activeAccountId) return;
    const token = await this.prefsService.getCachedToken(this.activeAccountId);
    const t = (token ?? '').toString().trim();
    if (t) this.token = t;
  }

  private async refreshPreferencesFromServer() {
    if (!this.activeAccountId || !this.activeUsername || !this.activePassword) return;

    this.prefsService
      .fetchForAccount(this.activeAccountId, this.activeUsername, this.activePassword)
      .subscribe({
        next: (res) => {
          if (!res?.preferences) return;
          this.token = (res.token ?? '').toString().trim() || this.token;
          this.preferences = res.preferences;
          if (this.activeAccountId && this.token) {
            void this.prefsService.persistTokenForAccount(this.activeAccountId, this.token);
          }
          if (this.activeAccountId) {
            void this.prefsService.persistPreferencesForAccount(this.activeAccountId, res.preferences);
          }
        },
      });
  }
}
