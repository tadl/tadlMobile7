import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { HttpClient } from '@angular/common/http';
import { Globals } from '../../../globals';
import { ModalController } from '@ionic/angular/standalone';

type Location = {
  id: number;
  shortname: string;
  fullname: string;
  group: string;
  address: string;
  citystatezip: string;
  phone: string;
  fax?: string;
  email?: string;
  image?: string;

  sunday?: string;
  monday?: string;
  tuesday?: string;
  wednesday?: string;
  thursday?: string;
  friday?: string;
  saturday?: string;

  exceptions?: any[];
};

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
    private http: HttpClient,
  ) {}

  ionViewDidEnter() {
    // Fetch “real” detail via shortname (even if we already have a list object)
    if (this.shortname) {
      this.load_detail(this.shortname);
    }
  }

  load_detail(shortname: string) {
    this.loading = true;

    const url = this.globals.locations_detail_url(shortname);
    this.http.get<{ locations: Location[] }>(url).subscribe({
      next: (data) => {
        this.location = data?.locations?.[0] ?? this.location;
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
}
