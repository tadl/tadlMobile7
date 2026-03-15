import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { Globals } from '../../globals';
import { ToastService } from '../../services/toast.service';
import { NewsDetailComponent } from './news-detail/news-detail.component';
import { NewsService, NewsletterItem } from '../../services/news.service';

@Component({
  standalone: true,
  selector: 'app-news',
  templateUrl: './news.page.html',
  styleUrls: ['./news.page.scss'],
  imports: [CommonModule, IonicModule],
})
export class NewsPage {
  newsletters: NewsletterItem[] = [];

  readonly placeholderImage = 'assets/location-placeholder.png'; // reuse your existing placeholder asset if present
  private brokenImages = new WeakSet<NewsletterItem>();

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
        this.newsletters = (Array.isArray(posts) ? posts : [])
          .slice()
          .sort((a, b) => (b?.published_at || '').localeCompare(a?.published_at || '')); // newest first
      },
      error: () => {
        this.globals.api_loading = false;
        this.toast.presentToast(this.globals.server_error_msg);
      },
    });
  }

  titleFor(n: NewsletterItem): string {
    return (n?.title ?? '').toString().trim();
  }

  dateFor(n: NewsletterItem): string {
    const raw = (n?.published_at ?? '').toString();
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

  excerptFor(n: NewsletterItem): string {
    const raw = (n?.summary ?? '').toString();
    let decoded = this.decodeHtmlEntities(raw);
    decoded = this.decodeHtmlEntities(decoded);

    const normalized = decoded
      .replace(/\u00A0/g, ' ') // nbsp -> normal space
      .replace(/\s+/g, ' ')
      .trim();

    const max = 140;
    if (normalized.length <= max) return normalized;

    const clipped = normalized.slice(0, max);
    const breakAt = Math.max(clipped.lastIndexOf(' '), clipped.lastIndexOf('.'), clipped.lastIndexOf(','));
    return `${(breakAt > 80 ? clipped.slice(0, breakAt) : clipped).trim()}...`;
  }

  thumbFor(n: NewsletterItem): string {
    if (this.brokenImages.has(n)) return this.placeholderImage;

    const url = (n?.image ?? '').toString().trim();
    return url || this.placeholderImage;
  }

  markImageBroken(n: NewsletterItem) {
    this.brokenImages.add(n);
  }

  private decodeHtmlEntities(input: string): string {
    // Browser-native decode that handles &quot;, &amp;nbsp;, &#39;, etc.
    const txt = document.createElement('textarea');
    txt.innerHTML = input;
    return txt.value;
  }

  async view_details(item: NewsletterItem) {
    const modal = await this.modalController.create({
      component: NewsDetailComponent,
      componentProps: { news: item },
    });
    this.globals.modal_open = true;
    return await modal.present();
  }
}
