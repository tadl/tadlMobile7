import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { Globals } from '../../../globals';
import { MobilePost } from '../../../services/news.service';

@Component({
  standalone: true,
  selector: 'app-news-detail',
  templateUrl: './news-detail.component.html',
  styleUrls: ['./news-detail.component.scss'],
  imports: [CommonModule, IonicModule],
})
export class NewsDetailComponent {
  @Input() news?: MobilePost;

  readonly placeholderImage = 'assets/location-placeholder.png';

  constructor(
    public globals: Globals,
    private modalController: ModalController,
  ) {}

  close() {
    this.modalController.dismiss();
    this.globals.modal_open = false;
  }

  openLink(url?: string) {
    if (url) this.globals.open_page(url);
  }

  titleFor(): string {
    return (this.news?.title?.rendered ?? '').toString();
  }

  dateFor(): string {
    const raw = (this.news?.date ?? '').toString();
    if (!raw) return '';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }

  heroImage(): string | null {
    const thumb = (this.news?.featured_image_urls?.thumbnail ?? '').toString().trim();
    return thumb || null;
  }

  postUrl(): string | null {
    const u = (this.news?.post_url ?? '').toString().trim();
    return u || null;
  }

  htmlContent(): string {
    return (this.news?.content?.rendered ?? '').toString();
  }
}
