import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Globals } from '../../globals';
import { ToastService } from '../../services/toast.service';
import { LocationDetailComponent } from './location-detail/location-detail.component';
import { ModalController } from '@ionic/angular/standalone';
import {
  LocationsService,
  type AppLocation,
  type AppLocationException,
  type LocationWeekdayKey,
  formatLocationDayHours,
  getLocationClosingMinutes,
  isLocationClosed,
} from '../../services/locations.service';

type Location = AppLocation;
type LocationStatusDisplay = {
  label: string;
  detail: string;
  isException: boolean;
};

@Component({
  standalone: true,
  selector: 'app-locations',
  templateUrl: './locations.page.html',
  styleUrls: ['./locations.page.scss'],
  imports: [CommonModule, IonicModule],
})
export class LocationsPage {
  url: string;
  locations: Location[] = [];
  loadingLocations = false;
  hasLoadedLocations = false;

  readonly placeholderImage = 'assets/placeholder.png';
  private brokenLocationImages = new WeakSet<Location>();

  constructor(
    public globals: Globals,
    public toast: ToastService,
    private locationsService: LocationsService,
    private modalController: ModalController,
  ) {
    this.url = this.globals.locations_list_url;
  }

  ionViewWillEnter() {
    const latest = this.sortedLocations(this.locationsService.getLatestLocationsSnapshot());
    if (latest.length) {
      this.locations = latest;
    }
    this.get_locations();
  }

  get_locations() {
    const hasVisibleLocations = this.locations.length > 0;
    this.loadingLocations = true;
    if (!hasVisibleLocations) {
      this.globals.loading_show();
    }

    this.locationsService.getLocations().subscribe({
      next: (locations) => {
        this.globals.api_loading = false;
        this.loadingLocations = false;
        this.hasLoadedLocations = true;
        this.locations = this.sortedLocations(locations ?? []);
      },
      error: () => {
        this.globals.api_loading = false;
        this.loadingLocations = false;
        this.hasLoadedLocations = true;
        this.toast.presentToast(this.globals.server_error_msg);
      },
    });
  }

  private sortedLocations(locations: Location[]): Location[] {
    return (locations ?? []).slice().sort((a, b) =>
      (a.fullname || '').localeCompare(b.fullname || ''),
    );
  }

  private todayKey(): LocationWeekdayKey | null {
    const fromGlobals = (this.globals.day_today?.() || '').toString().toLowerCase().trim();
    const map: Record<string, LocationWeekdayKey> = {
      sunday: 'sunday',
      monday: 'monday',
      tuesday: 'tuesday',
      wednesday: 'wednesday',
      thursday: 'thursday',
      friday: 'friday',
      saturday: 'saturday',
    };
    if (fromGlobals && map[fromGlobals]) return map[fromGlobals];

    const d = new Date().getDay();
    return (['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][
      d
    ] as LocationWeekdayKey) ?? null;
  }

  locationStatus(loc: Location): LocationStatusDisplay | null {
    const todayException = this.exceptionForDate(loc, this.globals.easternDateString());
    if (todayException) {
      const todayDisplay = this.formatStatusDisplay(
        todayException.hours,
        'today',
        todayException.reason,
      );
      if (!this.isPastExceptionClosingHours(todayException.hours)) return todayDisplay;
      return this.tomorrowStatus(loc) || todayDisplay;
    }

    const key = this.todayKey();
    if (!key) return null;

    const todayHours = formatLocationDayHours(loc, key);
    if (!todayHours) return null;

    const todayDisplay = this.formatStatusDisplay(todayHours, 'today');
    if (!this.isPastClosingHours(loc, key)) return todayDisplay;
    return this.tomorrowStatus(loc) || todayDisplay;
  }

  isTodayException(loc: Location): boolean {
    return !!this.exceptionForDate(loc, this.globals.easternDateString());
  }

  addressLine(loc: Location): string {
    const a = (loc.address || '').trim();
    const csz = this.compactCityState(loc.citystatezip);
    if (a && csz) return `${a} • ${csz}`;
    return a || csz;
  }

  imageFor(loc: Location): string {
    if (this.brokenLocationImages.has(loc)) return this.placeholderImage;

    const anyLoc: any = loc as any;
    const candidates: any[] = [
      anyLoc.image,
      anyLoc.imageUrl,
      anyLoc.image_url,
      anyLoc.photo,
      anyLoc.photo_url,
      anyLoc.thumbnail,
      anyLoc.thumbnail_url,
      anyLoc.media?.url,
      anyLoc.media?.source_url,
    ];

    const url =
      candidates.find((v) => typeof v === 'string' && v.trim().length > 0)?.trim() ?? null;

    return url || this.placeholderImage;
  }

  markLocationImageBroken(loc: Location): void {
    this.brokenLocationImages.add(loc);
  }

  private exceptionForDate(loc: Location, dateKey: string): AppLocationException | null {
    const exceptions = Array.isArray(loc?.exceptions) ? loc.exceptions : [];
    for (const ex of exceptions) {
      if ((ex?.date ?? '').toString().trim() === dateKey) return ex;
    }
    return null;
  }

  private tomorrowStatus(loc: Location): LocationStatusDisplay | null {
    const tomorrowException = this.exceptionForDate(loc, this.globals.easternDateStringPlusDays(1));
    if (tomorrowException) {
      return this.formatStatusDisplay(
        tomorrowException.hours,
        'tomorrow',
        tomorrowException.reason,
      );
    }

    const tomorrowKey = this.weekdayKeyPlusDays(1);
    if (!tomorrowKey) return null;

    return this.formatStatusDisplay(formatLocationDayHours(loc, tomorrowKey), 'tomorrow');
  }

  private weekdayKeyPlusDays(days: number): LocationWeekdayKey | null {
    const weekday = this.globals.easternWeekdayKey(
      new Date(Date.now() + days * 24 * 60 * 60 * 1000),
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
    reason?: unknown,
  ): LocationStatusDisplay {
    const hours = (rawHours ?? '').toString().trim();
    const reasonText = (reason ?? '').toString().trim();
    if (!hours) {
      const label = dayLabel === 'today' ? 'Hours Updated Today' : 'Hours Updated Tomorrow';
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

  private isPastClosingHours(loc: Location, weekday: LocationWeekdayKey): boolean {
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

    const match = trimmed.match(/(?:to|-|–|—)\s*([0-9]{1,2})(?::([0-9]{2}))?\s*([AaPp][Mm])/);
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

    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0;
    return hour * 60 + minute;
  }

  private compactCityState(value: string | undefined): string {
    const raw = (value ?? '').toString().trim();
    if (!raw) return '';
    return raw.replace(/,\s*MI\s+\d{5}(?:-\d{4})?$/i, '').trim();
  }

  async view_details(loc: Location) {
    const modal = await this.modalController.create({
      component: LocationDetailComponent,
      componentProps: { shortname: loc.shortname, location: loc },
    });

    this.globals.modal_open = true;
    modal.onDidDismiss().then(() => (this.globals.modal_open = false));

    return await modal.present();
  }
}
