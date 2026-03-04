import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Globals } from '../../../globals';
import { ModalController } from '@ionic/angular/standalone';
import { LocationsService, type AppLocation } from '../../../services/locations.service';
import { Capacitor } from '@capacitor/core';

type Location = AppLocation;

type HoursRow = {
  key: string;
  day: string;
  hours: string;
  isToday: boolean;
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
    const platform = Capacitor.getPlatform();

    // Use platform-native style deep links first, then rely on global external opener fallback behavior.
    const targetUrl =
      platform === 'ios'
        ? `maps://?daddr=${encoded}&dirflg=d`
        : platform === 'android'
          ? `geo:0,0?q=${encoded}`
          : `https://www.google.com/maps/dir/?api=1&destination=${encoded}&travelmode=driving`;

    await this.globals.open_external_page(targetUrl);
  }

  openTodayLine(loc: Location): string {
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
        const idx = new Date().getDay(); // 0 sunday
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
}
