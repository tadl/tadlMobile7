import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { HttpClient } from '@angular/common/http';
import { Globals } from '../../globals';
import { ToastService } from '../../services/toast.service';
import { NewsDetailComponent } from './news-detail/news-detail.component';

@Component({
  standalone: true,
  selector: 'app-news',
  templateUrl: './news.page.html',
  styleUrls: ['./news.page.scss'],
  imports: [CommonModule, IonicModule],
})
export class NewsPage {
  url: string;
  news: any[] = [];

  constructor(
    public globals: Globals,
    public toast: ToastService,
    private http: HttpClient,
    private modalController: ModalController,
  ) {
    this.url = this.globals.news_api_url;
  }

  ionViewDidEnter() {
    this.get_news();
  }

  get_news() {
    this.globals.loading_show();
    this.http.get(this.url).subscribe({
      next: (data: any) => {
        this.globals.api_loading = false;
        this.news = Array.isArray(data) ? data : [];
      },
      error: () => {
        this.globals.api_loading = false;
        this.toast.presentToast(this.globals.server_error_msg);
      },
    });
  }

  async view_details(item: any) {
    const modal = await this.modalController.create({
      component: NewsDetailComponent,
      componentProps: { news: item },
    });
    this.globals.modal_open = true;
    return await modal.present();
  }
}
