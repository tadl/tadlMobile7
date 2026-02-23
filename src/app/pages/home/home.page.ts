import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { RouterModule } from '@angular/router';
import { Globals } from '../../globals';
import { AuthState, AuthService } from '../../services/auth.service';
import { PatronService } from '../../services/patron.service';

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
  ) {}

  isDarkMode(): boolean {
    return this.globals.system_color?.matches === true;
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
}
