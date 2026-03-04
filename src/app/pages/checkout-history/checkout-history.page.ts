import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { finalize } from 'rxjs';

import { Globals } from '../../globals';
import { ToastService } from '../../services/toast.service';
import { AuthService } from '../../services/auth.service';
import { HistoryService, type AspenReadingHistoryItem } from '../../services/history.service';
import { ItemDetailComponent } from '../../components/item-detail/item-detail.component';
import type { AspenSearchHit } from '../../services/search.service';

@Component({
  standalone: true,
  selector: 'app-checkout-history',
  templateUrl: './checkout-history.page.html',
  styleUrls: ['./checkout-history.page.scss'],
  imports: [CommonModule, IonicModule],
})
export class CheckoutHistoryPage {
  loading = false;
  loadingMore = false;

  items: AspenReadingHistoryItem[] = [];
  page = 1;
  totalPages = 1;
  pageSize = 50;
  sort = 'checkedOut';
  infiniteDisabled = true;

  constructor(
    public globals: Globals,
    private toast: ToastService,
    private auth: AuthService,
    private history: HistoryService,
    private modalCtrl: ModalController,
  ) {}

  ionViewWillEnter() {
    this.refresh();
  }

  refresh(ev?: any) {
    if (this.loading) {
      ev?.target?.complete?.();
      return;
    }

    const snap = this.auth.snapshot();
    if (!snap.isLoggedIn || !snap.activeAccountId) {
      this.items = [];
      this.page = 1;
      this.totalPages = 1;
      this.infiniteDisabled = true;
      ev?.target?.complete?.();
      return;
    }

    this.loading = true;
    this.page = 1;
    this.totalPages = 1;
    this.infiniteDisabled = true;

    this.history.fetchReadingHistoryPage(this.page, this.pageSize, this.sort, '', true)
      .pipe(finalize(() => {
        this.loading = false;
        ev?.target?.complete?.();
      }))
      .subscribe({
        next: (res) => {
          if (!res?.success) {
            if (this.isLoginUnsuccessful(res?.message)) {
              this.retryRefreshAfterAuthGlitch();
              return;
            }
            this.items = [];
            this.toast.presentToast(res?.message || 'Could not load checkout history.');
            return;
          }

          this.page = Number(res.pageCurrent || 1);
          this.totalPages = Number(res.pageTotal || 1);
          this.items = this.normalizeHistoryItems(res.items ?? []);
          this.infiniteDisabled = !(this.page < this.totalPages);
        },
        error: () => {
          this.items = [];
          this.toast.presentToast('Could not load checkout history.');
        },
      });
  }

  private retryRefreshAfterAuthGlitch() {
    this.history.fetchReadingHistoryPage(1, this.pageSize, this.sort, '', false)
      .subscribe({
        next: (res) => {
          if (!res?.success) {
            this.items = [];
            this.toast.presentToast(res?.message || 'Could not load checkout history.');
            return;
          }

          this.page = Number(res.pageCurrent || 1);
          this.totalPages = Number(res.pageTotal || 1);
          this.items = (res.items ?? []).slice();
          this.infiniteDisabled = !(this.page < this.totalPages);
        },
        error: () => {
          this.items = [];
          this.toast.presentToast('Could not load checkout history.');
        },
      });
  }

  loadMore(ev: any) {
    if (this.loadingMore || this.loading || this.infiniteDisabled) {
      ev?.target?.complete?.();
      return;
    }
    if (this.page >= this.totalPages) {
      this.infiniteDisabled = true;
      ev?.target?.complete?.();
      return;
    }

    this.loadingMore = true;
    const nextPage = this.page + 1;
    this.history.fetchReadingHistoryPage(nextPage, this.pageSize, this.sort, '', false)
      .pipe(finalize(() => {
        this.loadingMore = false;
        ev?.target?.complete?.();
      }))
      .subscribe({
        next: (res) => {
          if (!res?.success) {
            this.toast.presentToast(res?.message || 'Could not load more history.');
            return;
          }

          this.page = Number(res.pageCurrent || nextPage);
          this.totalPages = Number(res.pageTotal || this.totalPages);
          this.items = [...this.items, ...this.normalizeHistoryItems(res.items ?? [])];
          this.infiniteDisabled = !(this.page < this.totalPages);
        },
        error: () => this.toast.presentToast('Could not load more history.'),
      });
  }

  titleText(i: AspenReadingHistoryItem): string {
    const raw = (i?.title ?? '').toString().trim();
    return this.normalizeTitle(raw);
  }

  authorText(i: AspenReadingHistoryItem): string {
    return (i?.author ?? '').toString().trim();
  }

  whenText(i: AspenReadingHistoryItem): string {
    const ts = this.pickUnixTimestamp(i);
    if (ts > 0) {
      const dt = new Date(ts * 1000);
      return `Last checkout: ${dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }

    const d = (i?.lastCheckout ?? i?.checkout ?? '').toString().trim();
    return d ? `Last checkout: ${d}` : '';
  }

  coverUrl(i: AspenReadingHistoryItem): string {
    const raw = (i?.coverUrl ?? i?.image ?? '').toString().trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith('//')) return `https:${raw}`;
    if (raw.startsWith('/')) return `${this.globals.aspen_discovery_base}${raw}`;
    return `${this.globals.aspen_discovery_base}/${raw}`;
  }

  async openItem(i: AspenReadingHistoryItem) {
    const key = (i?.groupedWorkId ?? i?.['permanentId'] ?? i?.['groupedWorkPermanentId'] ?? i?.id ?? '').toString().trim();
    const recordId = (i?.recordId ?? '').toString().trim();

    if (key) {
      const hit: AspenSearchHit = {
        key,
        title: this.titleText(i),
        author: this.authorText(i) || undefined,
        coverUrl: this.coverUrl(i) || undefined,
        summary: undefined,
        language: undefined,
        format: i?.format,
        itemList: [],
        catalogUrl: `${this.globals.aspen_discovery_base}/GroupedWork/${encodeURIComponent(key)}`,
        raw: i,
      };

      const m = await this.modalCtrl.create({
        component: ItemDetailComponent,
        componentProps: { hit },
      });
      this.globals.modal_open = true;
      await m.present();
      return;
    }

    if (recordId) {
      await this.globals.open_page(`${this.globals.aspen_discovery_base}/Record/${encodeURIComponent(recordId)}`);
      return;
    }

    this.toast.presentToast('No record link available for this history item.');
  }

  trackByItem(_idx: number, i: AspenReadingHistoryItem): string {
    return (i?.groupedWorkId ?? i?.['permanentId'] ?? i?.['groupedWorkPermanentId'] ?? i?.recordId ?? i?.id ?? `${_idx}`).toString();
  }

  private isLoginUnsuccessful(message?: string): boolean {
    return (message ?? '').toString().toLowerCase().includes('login unsuccessful');
  }

  private normalizeHistoryItems(items: AspenReadingHistoryItem[]): AspenReadingHistoryItem[] {
    const normalized = (items ?? [])
      .filter((i) => !this.isCurrentlyCheckedOut(i))
      .map((i) => {
        const groupedWorkId = (i?.groupedWorkId ?? i?.['permanentId'] ?? i?.['groupedWorkPermanentId'] ?? '').toString().trim();
        return groupedWorkId ? { ...i, groupedWorkId } : i;
      });

    // Aspen can return duplicate transaction rows for the same work with
    // tiny title metadata differences; collapse those to one visible row.
    const seen = new Set<string>();
    const deduped: AspenReadingHistoryItem[] = [];
    for (const i of normalized) {
      const key = this.historyDedupeKey(i);
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(i);
    }

    return deduped;
  }

  private isCurrentlyCheckedOut(i: AspenReadingHistoryItem): boolean {
    const raw = (i as any)?.checkedOut;
    if (raw === true) return true;
    const s = (raw ?? '').toString().trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes';
  }

  private pickUnixTimestamp(i: AspenReadingHistoryItem): number {
    const candidates = [
      (i as any)?.lastCheckoutTime,
      (i as any)?.checkoutTime,
      (i as any)?.lastCheckout,
      (i as any)?.checkout,
    ];

    for (const c of candidates) {
      const n = Number(c);
      if (!Number.isFinite(n) || n <= 0) continue;
      // Support both seconds (10-digit) and milliseconds (13-digit).
      if (n > 1_000_000_000_000) return Math.floor(n / 1000);
      return Math.floor(n);
    }

    return 0;
  }

  private normalizeTitle(rawTitle: string): string {
    const raw = (rawTitle ?? '').toString().trim();
    if (!raw) return 'Untitled';
    // Aspen titles are often MARC-ish: "Title : subtitle / responsibility".
    // Normalize with loose spacing so variants render consistently.
    const withoutResponsibility = raw.split(/\s*\/\s*/)[0]?.trim() ?? raw;
    const withoutSubtitle = withoutResponsibility.split(/\s*:\s*/)[0]?.trim() ?? withoutResponsibility;
    return withoutSubtitle.replace(/[\s:\/]+$/, '').trim() || raw;
  }

  private historyDedupeKey(i: AspenReadingHistoryItem): string {
    const workId = (i?.groupedWorkId ?? i?.['permanentId'] ?? i?.['groupedWorkPermanentId'] ?? '').toString().trim();
    const title = this.normalizeTitle((i?.title ?? '').toString()).toLowerCase();
    const author = (i?.author ?? '').toString().trim().toLowerCase();
    const format = (i?.format ?? '').toString().trim().toLowerCase();
    const checkoutTs = this.pickUnixTimestampFromFields((i as any)?.checkout, (i as any)?.lastCheckout);
    const checkinTs = this.pickUnixTimestampFromFields((i as any)?.checkin, (i as any)?.lastCheckin);

    // Only collapse true duplicates from Aspen payload noise.
    // Distinct transactions on the same day should remain distinct rows.
    return [
      workId || 'no-work-id',
      title,
      author,
      format,
      `co:${checkoutTs}`,
      `ci:${checkinTs}`,
    ].join('|');
  }

  private pickUnixTimestampFromFields(...values: any[]): number {
    for (const c of values) {
      const n = Number(c);
      if (!Number.isFinite(n) || n <= 0) continue;
      if (n > 1_000_000_000_000) return Math.floor(n / 1000);
      return Math.floor(n);
    }
    return 0;
  }
}
