import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController, ActionSheetController } from '@ionic/angular';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
import { Globals } from '../../globals';
import { AuthState, AuthService } from '../../services/auth.service';
import { PatronService } from '../../services/patron.service';
import { ToastService } from '../../services/toast.service';
import { ShowCardModalComponent } from '../../components/show-card-modal/show-card-modal.component';
import { AccountStoreService } from '../../services/account-store.service';
import { SwitchUserModalComponent } from '../../components/switch-user-modal/switch-user-modal.component';

@Component({
  standalone: true,
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  imports: [CommonModule, IonicModule, RouterModule, FormsModule],
})
export class HomePage {
  homeQuery = '';

  constructor(
    public globals: Globals,
    public auth: AuthService,
    public patron: PatronService,
    private router: Router,
    private modal: ModalController,
    private actionSheet: ActionSheetController,
    private toast: ToastService,
    private accounts: AccountStoreService,
  ) {}

  isDarkMode(): boolean {
    return this.globals.isDarkTheme();
  }

  loggedInUsername(s: AuthState): string {
    return (
      s?.activeAccountMeta?.username?.toString()?.trim() ||
      s?.profile?.username?.toString()?.trim() ||
      'user'
    );
  }

  holdsCheckoutsSummary(profile: any): string {
    const b = this.patron.badgesFromProfile(profile);
    const parts: string[] = [];

    if (b.checkouts > 0) {
      parts.push(`${b.checkouts} item${b.checkouts === 1 ? '' : 's'} checked out`);
    }

    if (b.holds > 0) {
      let holdsText = `${b.holds} item${b.holds === 1 ? '' : 's'} on hold`;
      if (b.ready > 0) {
        holdsText += ` (${b.ready} ready for pickup)`;
      }
      parts.push(holdsText);
    }

    if (!parts.length) return 'You have no items checked out or on hold.';
    return `You have ${parts.join(', ')}.`;
  }

  overdueCount(profile: any): number {
    const n = Number(profile?.numOverdue ?? 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
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

  async showSwitchUser() {
    const m = await this.modal.create({
      component: SwitchUserModalComponent,
    });
    this.globals.modal_open = true;
    await m.present();
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
              next: () => this.toast.presentToast('Logged out.'),
              error: () => this.toast.presentToast('Logout failed.'),
            });
          },
        },
        {
          text: 'Logout and remove saved account',
          role: 'destructive',
          handler: () => {
            this.auth.logout().subscribe({
              next: async () => {
                try {
                  if (activeId) await this.accounts.removeAccount(activeId);
                } catch {}
                this.toast.presentToast('Logged out and removed saved account.');
              },
              error: () => this.toast.presentToast('Logout failed.'),
            });
          },
        },
        { text: 'Close', role: 'cancel' },
      ],
    });

    await sheet.present();
  }

  async submitSearch() {
    await this.dismissSearchInput();
    const q = (this.homeQuery ?? '').toString().trim();
    if (!q) {
      this.router.navigate(['/search']);
      return;
    }
    this.router.navigate(['/search'], { queryParams: { lookfor: q } });
  }

  async openAdvancedSearch() {
    await this.dismissSearchInput();
    const q = (this.homeQuery ?? '').toString().trim();
    if (!q) {
      this.router.navigate(['/search'], { queryParams: { advanced: 1 } });
      return;
    }
    this.router.navigate(['/search'], { queryParams: { advanced: 1, lookfor: q } });
  }

  private async dismissSearchInput() {
    const active = document.activeElement as HTMLElement | null;
    if (active && typeof active.blur === 'function') {
      active.blur();
      await this.waitForFocusRelease();
    }

    if (!Capacitor.isNativePlatform()) return;
    try {
      await Keyboard.hide();
    } catch {
      // Ignore keyboard plugin errors and proceed with navigation.
    }
  }

  private async waitForFocusRelease(): Promise<void> {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }
}
