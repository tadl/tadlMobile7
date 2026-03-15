import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SecurityContext } from '@angular/core';
import { IonicModule, ModalController } from '@ionic/angular';
import { DomSanitizer } from '@angular/platform-browser';
import { Globals } from '../../../globals';
import { NewsletterItem } from '../../../services/news.service';
import { DiscoveryLinkRouterService } from '../../../services/discovery-link-router.service';

@Component({
  standalone: true,
  selector: 'app-news-detail',
  templateUrl: './news-detail.component.html',
  styleUrls: ['./news-detail.component.scss'],
  imports: [CommonModule, IonicModule],
})
export class NewsDetailComponent {
  @Input() news?: NewsletterItem;

  readonly placeholderImage = 'assets/location-placeholder.png';
  private htmlContentCacheRaw: string | null = null;
  private htmlContentCacheValue = '';

  constructor(
    public globals: Globals,
    private modalController: ModalController,
    private discoveryLinks: DiscoveryLinkRouterService,
    private sanitizer: DomSanitizer,
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
    return (this.news?.title ?? '').toString();
  }

  dateFor(): string {
    const raw = (this.news?.published_at ?? '').toString();
    if (!raw) return '';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  heroImage(): string | null {
    const thumb = (this.news?.image ?? '').toString().trim();
    return thumb || null;
  }

  shouldShowHero(): boolean {
    return !!this.heroImage() && !this.renderedHtmlContainsImage();
  }

  postUrl(): string | null {
    const u = (this.news?.url ?? '').toString().trim();
    return u || null;
  }

  htmlContent(): string {
    const raw = (this.news?.html ?? '').toString();
    if (raw === this.htmlContentCacheRaw) return this.htmlContentCacheValue;

    this.htmlContentCacheRaw = raw;
    this.htmlContentCacheValue = this.buildHtmlContent(raw);
    return this.htmlContentCacheValue;
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

  private buildHtmlContent(raw: string): string {
    if (!raw) return '';

    const sanitized =
      this.sanitizer.sanitize(SecurityContext.HTML, raw)?.trim() ?? '';
    if (!sanitized) return '';

    const parser = new DOMParser();
    const doc = parser.parseFromString(sanitized, 'text/html');
    const body = doc.body;
    if (!body) return '';

    return body.innerHTML.trim();
  }

  private renderedHtmlContainsImage(): boolean {
    const rendered = this.htmlContent();
    if (!rendered) return false;

    const parser = new DOMParser();
    const doc = parser.parseFromString(rendered, 'text/html');
    return !!doc.body?.querySelector('img');
  }
}
