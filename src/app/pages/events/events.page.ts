import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Globals } from '../../globals';
import { ToastService } from '../../services/toast.service';
import { EventDetailComponent } from './event-detail/event-detail.component';

@Component({
  standalone: true,
  selector: 'app-events',
  templateUrl: './events.page.html',
  styleUrls: ['./events.page.scss'],
  imports: [CommonModule, IonicModule],
})
export class EventsPage {
  url: string;
  web_events: any[] = [];
  location: string = '';

  constructor(
    public globals: Globals,
    public toast: ToastService,
    private http: HttpClient,
    private modalController: ModalController,
  ) {
    this.url = this.globals.events_api_url;
  }

  ionViewDidEnter() {
    this.get_events(this.location);
  }

  get_events(loc?: string) {
    let params = new HttpParams();
    if (loc) params = params.set('venue', loc);

    this.globals.loading_show();
    this.http.get(this.url, { params }).subscribe({
      next: (data: any) => {
        this.globals.api_loading = false;
        this.web_events = data?.events ?? [];
      },
      error: () => {
        this.globals.api_loading = false;
        this.toast.presentToast(this.globals.server_error_msg);
      },
    });
  }

  async view_details(event: any) {
    const modal = await this.modalController.create({
      component: EventDetailComponent,
      componentProps: { event },
    });
    this.globals.modal_open = true;
    return await modal.present();
  }
}
