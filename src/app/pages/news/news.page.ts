import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { Globals } from '../../globals';
import { ToastService } from '../../services/toast.service';
import { NewsDetailComponent } from './news-detail/news-detail.component';
import { NewsService, MobilePost } from '../../services/news.service';

@Component({
  standalone: true,
  selector: 'app-news',
  templateUrl: './news.page.html',
  styleUrls: ['./news.page.scss'],
  imports: [CommonModule, IonicModule],
})
export class NewsPage {
  news: MobilePost[] = [];

  readonly placeholderImage = 'assets/location-placeholder.png'; // reuse your existing placeholder asset if present
  private brokenImages = new WeakSet<MobilePost>();

  constructor(
    public globals: Globals,
    public toast: ToastService,
    private newsService: NewsService,
    private modalController: ModalController,
  ) {}

  ionViewDidEnter() {
    this.get_news();
  }

  get_news() {
    this.globals.loading_show();

    this.newsService.getPosts().subscribe({
      next: (posts) => {
        this.globals.api_loading = false;
        this.news = (Array.isArray(posts) ? posts : [])
          .slice()
          .sort((a, b) => (b?.date || '').localeCompare(a?.date || '')); // newest first
      },
      error: () => {
        this.globals.api_loading = false;
        this.toast.presentToast(this.globals.server_error_msg);
      },
    });
  }

  titleFor(n: MobilePost): string {
    return (n?.title?.rendered ?? '').toString();
  }

  dateFor(n: MobilePost): string {
    const raw = (n?.date ?? '').toString();
    if (!raw) return '';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  excerptFor(n: MobilePost): string {
    // excerpt.rendered is HTML with entities (&quot;, &amp;nbsp;, etc.)
    const html = (n?.excerpt?.rendered ?? '').toString();

    // 1) remove tags
    const withoutTags = this.stripHtml(html);

    // 2) decode entities
    let decoded = this.decodeHtmlEntities(withoutTags);
    decoded = this.decodeHtmlEntities(decoded);

    // 3) normalize whitespace (including non-breaking spaces)
    return decoded
      .replace(/\u00A0/g, ' ') // nbsp -> normal space
      .replace(/\s+/g, ' ')
      .trim();
  }

  thumbFor(n: MobilePost): string {
    if (this.brokenImages.has(n)) return this.placeholderImage;

    const url = (n?.featured_image_urls?.thumbnail ?? '').toString().trim();
    return url || this.placeholderImage;
  }

  markImageBroken(n: MobilePost) {
    this.brokenImages.add(n);
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, ' ');
  }

  private decodeHtmlEntities(input: string): string {
    // Browser-native decode that handles &quot;, &amp;nbsp;, &#39;, etc.
    const txt = document.createElement('textarea');
    txt.innerHTML = input;
    return txt.value;
  }

  async view_details(item: MobilePost) {
    const modal = await this.modalController.create({
      component: NewsDetailComponent,
      componentProps: { news: item },
    });
    this.globals.modal_open = true;
    return await modal.present();
  }
}
