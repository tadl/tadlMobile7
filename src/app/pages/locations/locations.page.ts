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
} from '../../services/locations.service';

type Location = AppLocation;

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

  ionViewDidEnter() {
    this.get_locations();
  }

  get_locations() {
    this.globals.loading_show();

    this.locationsService.getLocations().subscribe({
      next: (locations) => {
        this.globals.api_loading = false;
        this.locations = (locations ?? []).slice().sort((a, b) =>
          (a.fullname || '').localeCompare(b.fullname || ''),
        );
      },
      error: () => {
        this.globals.api_loading = false;
        this.toast.presentToast(this.globals.server_error_msg);
      },
    });
  }

  private todayKey(): keyof Location | null {
    const fromGlobals = (this.globals.day_today?.() || '').toString().toLowerCase().trim();
    const map: Record<string, keyof Location> = {
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
    ] as keyof Location) ?? null;
  }

  today_hours(loc: Location): string {
    const todayException = this.exceptionForDate(loc, this.startOfDay(new Date()));
    if (todayException) {
      const exHours = (todayException.hours ?? '').toString().trim();
      const exReason = (todayException.reason ?? '').toString().trim();
      const closure = exHours.toLowerCase().includes('closed');
      const base = closure ? 'Closed today' : exHours ? `Open ${exHours} today` : 'Hours updated today';
      return exReason ? `${base} (${exReason})` : base;
    }

    const key = this.todayKey();
    if (!key) return '';

    const raw = ((loc as any)?.[key] ?? '').toString().trim();
    if (!raw) return '';

    const lower = raw.toLowerCase();
    if (lower.includes('closed')) return 'Closed today';

    return `Open ${raw} today`;
  }

  addressLine(loc: Location): string {
    const a = (loc.address || '').trim();
    const csz = (loc.citystatezip || '').trim();
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

  private exceptionForDate(loc: Location, date: Date): AppLocationException | null {
    const target = this.startOfDay(date).getTime();
    const exceptions = Array.isArray(loc?.exceptions) ? loc.exceptions : [];
    for (const ex of exceptions) {
      const dt = this.parseLocalDate(ex?.date);
      if (dt && dt.getTime() === target) return ex;
    }
    return null;
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
