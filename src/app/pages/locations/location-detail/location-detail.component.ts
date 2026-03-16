import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ActionSheetController, type ActionSheetButton } from '@ionic/angular';
import { Capacitor } from '@capacitor/core';
import { AppLauncher } from '@capacitor/app-launcher';
import { Globals } from '../../../globals';
import { ModalController } from '@ionic/angular/standalone';
import {
  LocationsService,
  type AppLocation,
  type AppLocationException,
} from '../../../services/locations.service';

type Location = AppLocation;

type HoursRow = {
  key: string;
  day: string;
  hours: string;
  isToday: boolean;
};

type UpcomingClosureRow = {
  dateLabel: string;
  reason: string;
};

@Component({
  standalone: true,
  selector: 'app-location-detail',
  templateUrl: './location-detail.component.html',
  styleUrls: ['./location-detail.component.scss'],
  imports: [CommonModule, IonicModule],
})
export class LocationDetailComponent {
  @Input() shortname?: string;
  @Input() location?: Location;

  loading = false;

  constructor(
    public globals: Globals,
    private modalController: ModalController,
    private locationsService: LocationsService,
    private actionSheet: ActionSheetController,
  ) {}

  ionViewDidEnter() {
    // Fetch “real” detail via shortname (even if we already have a list object)
    if (this.shortname) {
      this.load_detail(this.shortname);
    }
  }

  load_detail(shortname: string) {
    this.loading = true;

    this.locationsService.getLocationByShortname(shortname).subscribe({
      next: (detail) => {
        this.location = detail ?? this.location;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        console.warn('[LocationDetail] Failed to load detail for', shortname);
      },
    });
  }

  close() {
    this.modalController.dismiss();
    this.globals.modal_open = false;
  }

  telHref(phone: string): string {
    // keep leading + if present, otherwise strip non-digits
    const trimmed = (phone || '').trim();
    const normalized = trimmed.startsWith('+')
      ? '+' + trimmed.slice(1).replace(/[^\d]/g, '')
      : trimmed.replace(/[^\d]/g, '');
    return `tel:${normalized}`;
  }

  mailtoHref(email: string): string {
    return `mailto:${(email || '').trim()}`;
  }

  hasNavigationTarget(loc?: Location): boolean {
    return this.navigationQuery(loc).length > 0;
  }

  async openNavigation(loc?: Location) {
    const query = this.navigationQuery(loc);
    if (!query) return;

    const encoded = encodeURIComponent(query);
    const options = await this.navigationOptions(encoded);
    if (options.length === 1) {
      await this.globals.open_external_page(options[0].url);
      return;
    }

    const buttons: ActionSheetButton[] = options.map((opt) => ({
      text: opt.text,
      handler: () => {
        void this.globals.open_external_page(opt.url);
      },
    }));
    buttons.push({ text: 'Close', role: 'cancel' });

    const sheet = await this.actionSheet.create({
      header: 'Navigate with',
      buttons,
    });

    await sheet.present();
  }

  openTodayLine(loc: Location): string {
    const todayException = this.exceptionForDate(loc, this.globals.easternDateString());
    if (todayException) {
      const exHours = (todayException.hours ?? '').toString().trim();
      const exReason = (todayException.reason ?? '').toString().trim();
      const closure = exHours.toLowerCase().includes('closed');
      const base = closure ? 'Closed today' : exHours ? `Open ${exHours} today` : 'Hours updated today';
      return exReason ? `${base} (${exReason})` : base;
    }

    const todayKey = this.todayKey();
    const raw = (loc as any)?.[todayKey];
    const hours = (raw ?? '').toString().trim();
    if (!hours) return '';

    // Normalize common cases
    const lower = hours.toLowerCase();
    if (lower === 'closed') return 'Closed today';

    // Expected: "9:00 AM to 7:00 PM"
    return `Open ${hours} today`;
  }

  hasTodayException(loc: Location): boolean {
    return !!this.exceptionForDate(loc, this.globals.easternDateString());
  }

  upcomingClosureRows(loc?: Location): UpcomingClosureRow[] {
    const exceptions = this.upcomingClosureExceptions(loc, 30);
    return exceptions.map((ex) => ({
      dateLabel: this.formatLongDate(ex.date),
      reason: (ex.reason ?? '').toString().trim(),
    }));
  }

  hoursRows(loc?: Location): HoursRow[] {
    if (!loc) return [];

    const todayKey = this.todayKey();

    const rows: Array<{ key: keyof Location | string; day: string; hours: any }> = [
      { key: 'sunday', day: 'Sunday', hours: loc.sunday },
      { key: 'monday', day: 'Monday', hours: loc.monday },
      { key: 'tuesday', day: 'Tuesday', hours: loc.tuesday },
      { key: 'wednesday', day: 'Wednesday', hours: loc.wednesday },
      { key: 'thursday', day: 'Thursday', hours: loc.thursday },
      { key: 'friday', day: 'Friday', hours: loc.friday },
      { key: 'saturday', day: 'Saturday', hours: loc.saturday },
    ];

    return rows
      .map((r) => {
        const hours = (r.hours ?? '').toString().trim();
        return {
          key: r.key.toString(),
          day: r.day,
          hours: hours || '—',
          isToday: r.key.toString() === todayKey,
        } as HoursRow;
      })
      .filter((r) => r.hours.length > 0);
  }

  private todayKey(): string {
    // globals.day_today() appears to return "Monday" etc in your app
    const d = (this.globals.day_today?.() || '').toString().trim().toLowerCase();
    // ensure it matches the JSON keys
    switch (d) {
      case 'sunday':
      case 'monday':
      case 'tuesday':
      case 'wednesday':
      case 'thursday':
      case 'friday':
      case 'saturday':
        return d;
      default:
        // fallback to real date if globals returns something unexpected
        const idxMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const eastern = this.globals.easternWeekdayKey(new Date());
        const idx = idxMap.indexOf(eastern);
        return ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][idx];
    }
  }

  private navigationQuery(loc?: Location): string {
    if (!loc) return '';
    return [loc.fullname, loc.address, loc.citystatezip]
      .map((v) => (v ?? '').toString().trim())
      .filter(Boolean)
      .join(', ');
  }

  private upcomingClosureExceptions(
    loc: Location | undefined,
    daysAhead: number,
  ): AppLocationException[] {
    if (!loc) return [];

    const start = this.globals.easternDateStringPlusDays(1); // Upcoming starts tomorrow, not today.
    const end = this.globals.easternDateStringPlusDays(daysAhead);

    const exceptions = Array.isArray(loc.exceptions) ? loc.exceptions : [];
    return exceptions
      .filter((ex) => this.isClosureException(ex))
      .filter((ex) => {
        const dateKey = (ex?.date ?? '').toString().trim();
        if (!dateKey) return false;
        return dateKey >= start && dateKey <= end;
      })
      .sort((a, b) => {
        const aKey = (a?.date ?? '').toString().trim() || '9999-99-99';
        const bKey = (b?.date ?? '').toString().trim() || '9999-99-99';
        return aKey.localeCompare(bKey);
      });
  }

  private exceptionForDate(loc: Location, dateKey: string): AppLocationException | null {
    const exceptions = Array.isArray(loc.exceptions) ? loc.exceptions : [];
    for (const ex of exceptions) {
      if ((ex?.date ?? '').toString().trim() === dateKey) return ex;
    }
    return null;
  }

  private isClosureException(ex: AppLocationException | null | undefined): boolean {
    const hours = (ex?.hours ?? '').toString().trim().toLowerCase();
    return !!hours && hours.includes('closed');
  }

  private parseLocalDate(value: string | undefined): Date | null {
    const raw = (value ?? '').toString().trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (!m) return null;
    const y = Number(m[1]);
    const mon = Number(m[2]);
    const d = Number(m[3]);
    if (!Number.isFinite(y) || !Number.isFinite(mon) || !Number.isFinite(d)) return null;
    const parsed = new Date(y, mon - 1, d);
    return Number.isNaN(parsed.getTime()) ? null : this.startOfDay(parsed);
  }

  private startOfDay(value: Date): Date {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  private formatLongDate(value: string | undefined): string {
    const date = this.parseLocalDate(value);
    if (!date) return (value ?? '').toString();
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(date);
  }

  private async navigationOptions(encodedQuery: string): Promise<Array<{ text: string; url: string }>> {
    const browserFallback: Array<{ text: string; url: string }> = [
      {
        text: 'Google Maps (Web)',
        url: `https://www.google.com/maps/dir/?api=1&destination=${encodedQuery}&travelmode=driving`,
      },
      {
        text: 'Waze (Web)',
        url: `https://waze.com/ul?q=${encodedQuery}&navigate=yes`,
      },
    ];

    if (!Capacitor.isNativePlatform()) {
      return browserFallback;
    }

    const candidates = [
      {
        text: 'Apple Maps',
        probe: 'maps://',
        url: `maps://?daddr=${encodedQuery}&dirflg=d`,
      },
      {
        text: 'Google Maps',
        probe: 'comgooglemaps://',
        url: `comgooglemaps://?daddr=${encodedQuery}&directionsmode=driving`,
      },
      {
        text: 'Waze',
        probe: 'waze://',
        url: `waze://?q=${encodedQuery}&navigate=yes`,
      },
    ];

    const available: Array<{ text: string; url: string }> = [];
    for (const candidate of candidates) {
      try {
        const result = await AppLauncher.canOpenUrl({ url: candidate.probe });
        if (result?.value) {
          available.push({ text: candidate.text, url: candidate.url });
        }
      } catch {
        // Ignore probe failures and continue.
      }
    }

    if (available.length) return available;
    return browserFallback;
  }
}
