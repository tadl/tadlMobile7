import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { RouterModule } from '@angular/router';
import { Globals } from '../../globals';
import { AuthState, AuthService } from '../../services/auth.service';
import { PatronService } from '../../services/patron.service';
import { ToastService } from '../../services/toast.service';
import { ShowCardModalComponent } from '../../components/show-card-modal/show-card-modal.component';

@Component({
  standalone: true,
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  imports: [CommonModule, IonicModule, RouterModule],
})
export class HomePage {
  constructor(
    public globals: Globals,
    public auth: AuthService,
    public patron: PatronService,
    private modal: ModalController,
    private toast: ToastService,
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

  showAccountShortcuts(profile: any): boolean {
    const b = this.patron.badgesFromProfile(profile);
    return b.checkouts > 0 || b.holds > 0 || b.finesVal > 0;
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
}
