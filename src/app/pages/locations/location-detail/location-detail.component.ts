import { Component, Input, inject } from '@angular/core';

import {
  IonicModule,
  ActionSheetController,
  type ActionSheetButton,
} from '@ionic/angular/lazy';
import { Capacitor } from '@capacitor/core';
import { AppLauncher } from '@capacitor/app-launcher';
import { Globals } from '../../../globals';
import { ModalController } from '@ionic/angular/lazy';
import {
  LocationsService,
  type AppLocation,
  type AppLocationException,
  type LocationWeekdayKey,
  formatLocationDayHours,
  getLocationClosingMinutes,
  isLocationClosed,
} from '../../../services/locations.service';

type Location = AppLocation;
type LocationStatusDisplay = {
  label: string;
  detail: string;
  isException: boolean;
};

type HoursRow = {
  key: string;
  day: string;
  hours: string;
  isToday: boolean;
};

type UpcomingScheduleRow = {
  dateKey: string;
  dateLabel: string;
  hoursLabel: string;
  reason: string;
};

@Component({
  standalone: true,
  selector: 'app-location-detail',
  templateUrl: './location-detail.component.html',
  styleUrls: ['./location-detail.component.scss'],
  imports: [IonicModule],
})
export class LocationDetailComponent {
  globals = inject(Globals);
  private modalController = inject(ModalController);
  private locationsService = inject(LocationsService);
  private actionSheet = inject(ActionSheetController);

  @Input() shortname?: string;
  private currentLocation?: Location;
  @Input()
  set location(value: Location | undefined) {
    this.currentLocation = value;
    this.refreshScheduleRows(value);
  }
  get location(): Location | undefined {
    return this.currentLocation;
  }

  upcomingRows: UpcomingScheduleRow[] = [];
  weeklyHoursRows: HoursRow[] = [];

  loading = false;

  ionViewDidEnter() {
    this.refreshScheduleRows();
    // Fetch “real” detail via shortname (even if we already have a list object)
    if (this.shortname) {
      this.load_detail(this.shortname);
    }
  }

  load_detail(shortname: string) {
    this.loading = true;
    const skipCache = !!this.location;

    this.locationsService
      .getLocationByShortname(shortname, { skipCache })
      .subscribe({
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

  locationStatus(loc: Location): LocationStatusDisplay | null {
    const todayException = this.exceptionForDate(
      loc,
      this.globals.easternDateString()
    );
    if (todayException) {
      const todayDisplay = this.formatStatusDisplay(
        todayException.hours,
        'today',
        todayException.reason
      );
      if (!this.isPastExceptionClosingHours(todayException.hours))
        return todayDisplay;
      return this.tomorrowStatus(loc) || todayDisplay;
    }

    const todayKey = this.todayKey();
    const hours = formatLocationDayHours(loc, todayKey);
    if (!hours) return null;

    const todayDisplay = this.formatStatusDisplay(hours, 'today');
    if (!this.isPastClosingHours(loc, todayKey)) return todayDisplay;
    return this.tomorrowStatus(loc) || todayDisplay;
  }

  hasTodayException(loc: Location): boolean {
    return !!this.locationStatus(loc)?.isException;
  }

  private buildUpcomingScheduleRows(loc?: Location): UpcomingScheduleRow[] {
    const exceptions = this.upcomingExceptions(loc, 7);
    return exceptions.map((ex) => ({
      dateKey: (ex.date ?? '').toString().trim(),
      dateLabel: this.formatLongDate(ex.date),
      hoursLabel: (ex.hours ?? '').toString().trim() || 'Hours updated',
      reason: (ex.reason ?? '').toString().trim(),
    }));
  }

  private buildHoursRows(loc?: Location): HoursRow[] {
    if (!loc) return [];

    const todayKey = this.todayKey();

    const rows: Array<{ key: LocationWeekdayKey; day: string }> = [
      { key: 'sunday', day: 'Sunday' },
      { key: 'monday', day: 'Monday' },
      { key: 'tuesday', day: 'Tuesday' },
      { key: 'wednesday', day: 'Wednesday' },
      { key: 'thursday', day: 'Thursday' },
      { key: 'friday', day: 'Friday' },
      { key: 'saturday', day: 'Saturday' },
    ];

    return rows.map((r) => ({
      key: r.key,
      day: r.day,
      hours: formatLocationDayHours(loc, r.key),
      isToday: r.key === todayKey,
    }));
  }

  private refreshScheduleRows(loc = this.location): void {
    this.upcomingRows = this.buildUpcomingScheduleRows(loc);
    this.weeklyHoursRows = this.buildHoursRows(loc);
  }

  private todayKey(): LocationWeekdayKey {
    // globals.day_today() appears to return "Monday" etc in your app
    const d = (this.globals.day_today?.() || '')
      .toString()
      .trim()
      .toLowerCase();
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
        return this.globals.easternWeekdayKey(new Date()) as LocationWeekdayKey;
    }
  }

  private tomorrowStatus(loc: Location): LocationStatusDisplay | null {
    const tomorrowException = this.exceptionForDate(
      loc,
      this.globals.easternDateStringPlusDays(1)
    );
    if (tomorrowException) {
      return this.formatStatusDisplay(
        tomorrowException.hours,
        'tomorrow',
        tomorrowException.reason
      );
    }

    const tomorrowKey = this.weekdayKeyPlusDays(1);
    if (!tomorrowKey) return null;

    return this.formatStatusDisplay(
      formatLocationDayHours(loc, tomorrowKey),
      'tomorrow'
    );
  }

  private weekdayKeyPlusDays(days: number): LocationWeekdayKey | null {
    const weekday = this.globals.easternWeekdayKey(
      new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    );
    const map: Record<string, LocationWeekdayKey> = {
      sunday: 'sunday',
      monday: 'monday',
      tuesday: 'tuesday',
      wednesday: 'wednesday',
      thursday: 'thursday',
      friday: 'friday',
      saturday: 'saturday',
    };
    return map[weekday] ?? null;
  }

  private formatStatusDisplay(
    rawHours: unknown,
    dayLabel: 'today' | 'tomorrow',
    reason?: unknown
  ): LocationStatusDisplay {
    const hours = (rawHours ?? '').toString().trim();
    const reasonText = (reason ?? '').toString().trim();
    if (!hours) {
      const label =
        dayLabel === 'today' ? 'Hours Updated Today' : 'Hours Updated Tomorrow';
      return {
        label,
        detail: reasonText,
        isException: !!reasonText,
      };
    }

    const lower = hours.toLowerCase();
    const isClosed = lower === 'closed';
    const label = isClosed
      ? dayLabel === 'today'
        ? 'Closed Today'
        : 'Closed Tomorrow'
      : dayLabel === 'today'
      ? 'Open Today'
      : 'Open Tomorrow';

    const detail = [isClosed ? '' : hours, reasonText ? `(${reasonText})` : '']
      .filter(Boolean)
      .join(' ')
      .trim();

    return {
      label,
      detail,
      isException: !!reasonText,
    };
  }

  private isPastClosingHours(
    loc: Location,
    weekday: LocationWeekdayKey
  ): boolean {
    if (isLocationClosed(loc, weekday)) return false;

    const closeTime = getLocationClosingMinutes(loc, weekday);
    if (closeTime === null) return false;
    return this.currentEasternMinutes() > closeTime;
  }

  private isPastExceptionClosingHours(rawHours: unknown): boolean {
    const hours = (rawHours ?? '').toString().trim();
    if (!hours || hours.toLowerCase().includes('closed')) return false;

    const closeTime = this.extractCloseTime(hours);
    if (closeTime === null) return false;
    return this.currentEasternMinutes() > closeTime;
  }

  private extractCloseTime(hours: string): number | null {
    const trimmed = (hours ?? '').toString().trim();
    if (!trimmed) return null;

    const lower = trimmed.toLowerCase();
    if (lower.includes('midnight')) return 24 * 60;

    const match = trimmed.match(
      /(?:to|-|–|—)\s*([0-9]{1,2})(?::([0-9]{2}))?\s*([AaPp][Mm])/
    );
    if (!match) return null;

    const hour12 = Number(match[1]);
    const minutes = Number(match[2] ?? '0');
    const meridiem = (match[3] ?? '').toUpperCase();
    if (!Number.isFinite(hour12) || !Number.isFinite(minutes)) return null;

    let hour24 = hour12 % 12;
    if (meridiem === 'PM') hour24 += 12;
    return hour24 * 60 + minutes;
  }

  private currentEasternMinutes(): number {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: this.globals.app_time_zone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());

    const hour = Number(
      parts.find((part) => part.type === 'hour')?.value ?? '0'
    );
    const minute = Number(
      parts.find((part) => part.type === 'minute')?.value ?? '0'
    );
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0;
    return hour * 60 + minute;
  }

  private navigationQuery(loc?: Location): string {
    if (!loc) return '';
    return [loc.fullname, loc.address, loc.citystatezip]
      .map((v) => (v ?? '').toString().trim())
      .filter(Boolean)
      .join(', ');
  }

  private upcomingExceptions(
    loc: Location | undefined,
    daysAhead: number
  ): AppLocationException[] {
    if (!loc) return [];

    const start = this.globals.easternDateStringPlusDays(1); // Upcoming starts tomorrow, not today.
    const end = this.globals.easternDateStringPlusDays(daysAhead);

    const exceptions = Array.isArray(loc.exceptions) ? loc.exceptions : [];
    return exceptions
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

  private exceptionForDate(
    loc: Location,
    dateKey: string
  ): AppLocationException | null {
    const exceptions = Array.isArray(loc.exceptions) ? loc.exceptions : [];
    for (const ex of exceptions) {
      if ((ex?.date ?? '').toString().trim() === dateKey) return ex;
    }
    return null;
  }

  private isClosureException(
    ex: AppLocationException | null | undefined
  ): boolean {
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
    if (!Number.isFinite(y) || !Number.isFinite(mon) || !Number.isFinite(d))
      return null;
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

  private async navigationOptions(
    encodedQuery: string
  ): Promise<Array<{ text: string; url: string }>> {
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
