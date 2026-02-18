import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { HttpClient } from '@angular/common/http';
import { Globals } from '../../globals';
import { ToastService } from '../../services/toast.service';
import { LocationDetailComponent } from './location-detail/location-detail.component';

@Component({
  standalone: true,
  selector: 'app-locations',
  templateUrl: './locations.page.html',
  styleUrls: ['./locations.page.scss'],
  imports: [CommonModule, IonicModule],
})
export class LocationsPage {
  url: string;
  locations: any[] = [];

  constructor(
    public globals: Globals,
    public toast: ToastService,
    private http: HttpClient,
    private modalController: ModalController,
  ) {
    this.url = this.globals.hours_locations_url;
  }

  ionViewDidEnter() {
    this.get_locations();
  }

  get_locations() {
    this.globals.loading_show();
    this.http.get(this.url).subscribe({
      next: (data: any) => {
        this.globals.api_loading = false;
        this.locations = data?.locations ?? [];
      },
      error: () => {
        this.globals.api_loading = false;
        this.toast.presentToast(this.globals.server_error_msg);
      },
    });
  }

  async view_details(location: any) {
    const modal = await this.modalController.create({
      component: LocationDetailComponent,
      componentProps: { location },
    });
    this.globals.modal_open = true;
    return await modal.present();
  }
}
