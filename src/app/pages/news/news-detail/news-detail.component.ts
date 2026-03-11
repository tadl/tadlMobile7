import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { Globals } from '../../../globals';
import { MobilePost } from '../../../services/news.service';
import { DiscoveryLinkRouterService } from '../../../services/discovery-link-router.service';

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
    private discoveryLinks: DiscoveryLinkRouterService,
  ) {}

  close() {
    this.modalController.dismiss();
    this.globals.modal_open = false;
  }

  async openLink(url?: string) {
    const resolved = this.resolveLinkUrl(url);
    if (!resolved) return;

    const isDiscovery = this.discoveryLinks.isDiscoveryUrl(resolved);
    if (isDiscovery && this.globals.link_mode === 'app') {
      this.close();
    }

    const handled = await this.discoveryLinks.routeIfHandled(resolved, {
      openExternalWhenBrowserMode: true,
      openExternalForUnmatchedPath: true,
    });
    if (handled) return;

    await this.globals.open_external_page(resolved);
  }

  async handleBodyLinkClick(ev: Event) {
    const target = ev?.target as HTMLElement | null;
    const link = target?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!link) return;

    const href = (link.getAttribute('href') ?? '').toString().trim();
    if (!href) return;

    ev.preventDefault();
    ev.stopPropagation();
    await this.openLink(href);
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

  private resolveLinkUrl(url?: string): string {
    const raw = (url ?? '').toString().trim();
    if (!raw) return '';

    try {
      const base = this.postUrl() || this.globals.aspen_discovery_base;
      return new URL(raw, base).toString();
    } catch {
      return raw;
    }
  }
}
