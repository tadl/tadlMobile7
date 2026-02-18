import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { HttpClient } from '@angular/common/http';
import { Globals } from '../../globals';
import { ToastService } from '../../services/toast.service';
import { LocationDetailComponent } from './location-detail/location-detail.component';
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
    private http: HttpClient,
    private modalController: ModalController,
  ) {
    this.url = this.globals.locations_list_url;
  }

  ionViewDidEnter() {
    this.get_locations();
  }

  get_locations() {
    this.globals.loading_show();

    this.http.get<{ locations: Location[] }>(this.url).subscribe({
      next: (data) => {
        this.globals.api_loading = false;
        this.locations = (data?.locations ?? []).slice().sort((a, b) =>
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
