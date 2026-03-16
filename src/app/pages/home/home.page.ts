import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
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
import { LocationsService, type AppLocation, type AppLocationException } from '../../services/locations.service';

type HomeClosureNotice = {
  message: string;
  actionLabel: string;
};

@Component({
  standalone: true,
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  imports: [CommonModule, IonicModule, RouterModule, FormsModule],
})
export class HomePage {
  homeQuery = '';
  closureNotice: HomeClosureNotice | null = null;

  constructor(
    public globals: Globals,
    public auth: AuthService,
    public patron: PatronService,
    private router: Router,
    private modal: ModalController,
    private toast: ToastService,
    private locationsService: LocationsService,
  ) {}

  ionViewDidEnter() {
    this.loadClosureNotice();
  }

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

  async goToRoute(url: string) {
    await this.dismissSearchInput();
    await this.router.navigateByUrl(url);
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

  private loadClosureNotice() {
    this.locationsService.getLocations().subscribe({
      next: (locations) => {
        this.closureNotice = this.buildClosureNotice(Array.isArray(locations) ? locations : []);
      },
      error: () => {
        this.closureNotice = null;
      },
    });
  }

  private buildClosureNotice(locations: AppLocation[]): HomeClosureNotice | null {
    const todayKey = this.globals.easternDateString();
    const tomorrowKey = this.globals.easternDateStringPlusDays(1);
    const targetKeys = [todayKey, tomorrowKey];

    const affected = locations
      .map((loc) => ({
        location: loc,
        exceptions: this.matchingExceptions(loc, targetKeys),
      }))
      .filter((entry) => entry.exceptions.length > 0);

    if (!affected.length) return null;

    const allDates = Array.from(
      new Set(
        affected.reduce<string[]>((acc, entry) => {
          acc.push(...entry.exceptions.map((ex) => (ex.date ?? '').toString().trim()));
          return acc;
        }, []),
      ),
    ).sort();
    const dateLabel = this.formatDateList(allDates);
    const allClosed = affected.every((entry) =>
      entry.exceptions.every((ex) => this.isClosedException(ex)),
    );
    const tense = this.noticeTenseForDates(allDates);
    const sharedReasonSuffix = this.reasonSuffixForExceptions(
      affected.reduce<AppLocationException[]>((acc, entry) => {
        acc.push(...entry.exceptions);
        return acc;
      }, []),
    );

    if (affected.length === 1) {
      const locationName = affected[0].location.fullname;
      const reasonSuffix = this.reasonSuffixForExceptions(affected[0].exceptions);
      return {
        message: allClosed
          ? `${this.closedMessageForSingle(locationName, allDates, tense, dateLabel)}${reasonSuffix}`
          : `${locationName} has modified hours on ${dateLabel}.${reasonSuffix}`,
        actionLabel: 'View locations',
      };
    }

    return {
      message: allClosed
        ? `${this.closedMessageForMultiple(allDates, tense, dateLabel)}${sharedReasonSuffix}`
        : `Some locations have modified hours on ${dateLabel}.${sharedReasonSuffix}`,
      actionLabel: 'View locations',
    };
  }

  private matchingExceptions(loc: AppLocation, targetKeys: string[]): AppLocationException[] {
    const exceptions = Array.isArray(loc.exceptions) ? loc.exceptions : [];
    return exceptions
      .filter((ex) => this.isClosureLikeException(ex))
      .filter((ex) => targetKeys.includes((ex?.date ?? '').toString().trim()));
  }

  private isClosureLikeException(ex: AppLocationException | null | undefined): boolean {
    const hours = (ex?.hours ?? '').toString().trim();
    const reason = (ex?.reason ?? '').toString().trim();
    return !!hours || !!reason;
  }

  private isClosedException(ex: AppLocationException | null | undefined): boolean {
    const hours = (ex?.hours ?? '').toString().trim().toLowerCase();
    return hours.includes('closed');
  }

  private noticeTenseForDates(dateKeys: string[]): 'present' | 'future' | 'mixed' {
    const today = this.globals.easternDateString();
    const tomorrow = this.globals.easternDateStringPlusDays(1);
    const hasToday = dateKeys.includes(today);
    const hasTomorrow = dateKeys.includes(tomorrow);
    if (hasToday && !hasTomorrow) return 'present';
    if (!hasToday && hasTomorrow) return 'future';
    return 'mixed';
  }

  private closedMessageForSingle(
    locationName: string,
    dateKeys: string[],
    tense: 'present' | 'future' | 'mixed',
    dateLabel: string,
  ): string {
    if (dateKeys.length === 1 && tense === 'present') return `${locationName} is closed today.`;
    if (dateKeys.length === 1 && tense === 'future') return `${locationName} will be closed tomorrow.`;
    return tense === 'future'
      ? `${locationName} will be closed on ${dateLabel}.`
      : `${locationName} is closed on ${dateLabel}.`;
  }

  private closedMessageForMultiple(
    dateKeys: string[],
    tense: 'present' | 'future' | 'mixed',
    dateLabel: string,
  ): string {
    if (dateKeys.length === 1 && tense === 'present') return 'Some locations are closed today.';
    if (dateKeys.length === 1 && tense === 'future') return 'Some locations will be closed tomorrow.';
    return tense === 'future'
      ? `Some locations will be closed on ${dateLabel}.`
      : `Some locations are closed on ${dateLabel}.`;
  }

  private formatDateList(dateKeys: string[]): string {
    const labels = dateKeys
      .map((dateKey) => this.formatDateKey(dateKey))
      .filter(Boolean);

    if (!labels.length) return 'the next two days';
    if (labels.length === 1) return labels[0];
    if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
    return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
  }

  private reasonSuffixForExceptions(exceptions: AppLocationException[]): string {
    const reasons = Array.from(
      new Set(
        exceptions
          .map((ex) => (ex?.reason ?? '').toString().trim())
          .filter(Boolean),
      ),
    );

    if (!reasons.length || reasons.length > 1) return '';
    return ` (${reasons.join('; ')})`;
  }

  private formatDateKey(dateKey: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((dateKey ?? '').toString().trim());
    if (!match) return dateKey;

    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
    return new Intl.DateTimeFormat(undefined, {
      timeZone: this.globals.app_time_zone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(date);
  }
}
