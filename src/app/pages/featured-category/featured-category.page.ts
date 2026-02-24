import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { IonicModule, ModalController } from '@ionic/angular';
import { finalize } from 'rxjs';

import { Globals } from '../../globals';
import { ToastService } from '../../services/toast.service';
import { FeaturedService, type FeaturedRecord } from '../../services/featured.service';
import { ItemDetailComponent } from '../../components/item-detail/item-detail.component';
import type { AspenSearchHit } from '../../services/search.service';

@Component({
  standalone: true,
  selector: 'app-featured-category',
  templateUrl: './featured-category.page.html',
  styleUrls: ['./featured-category.page.scss'],
  imports: [CommonModule, IonicModule],
})
export class FeaturedCategoryPage {
  loading = false;
  loadingMore = false;

  categoryId = '';
  categoryTitle = 'Featured';
  items: FeaturedRecord[] = [];
  page = 1;
  totalPages = 1;
  pageSize = 24;
  infiniteDisabled = true;

  constructor(
    public globals: Globals,
    private route: ActivatedRoute,
    private featured: FeaturedService,
    private toast: ToastService,
    private modalCtrl: ModalController,
  ) {}

  ionViewWillEnter() {
    this.categoryId = (this.route.snapshot.paramMap.get('id') ?? '').toString().trim();
    const label = (this.route.snapshot.queryParamMap.get('label') ?? '').toString().trim();
    if (label) this.categoryTitle = label;
    this.refresh();
  }

  refresh(ev?: any) {
    if (this.loading) {
      ev?.target?.complete?.();
      return;
    }
    if (!this.categoryId) {
      this.toast.presentToast('Invalid featured category.');
      ev?.target?.complete?.();
      return;
    }

    this.loading = true;
    this.page = 1;
    this.totalPages = 1;
    this.infiniteDisabled = true;

    this.featured.fetchBrowseCategoryPage(this.categoryId, this.page, this.pageSize)
      .pipe(finalize(() => {
        this.loading = false;
        ev?.target?.complete?.();
      }))
      .subscribe({
        next: (res) => {
          if (!res?.success) {
            this.items = [];
            this.toast.presentToast(res?.message || 'Could not load featured titles.');
            return;
          }
          this.categoryTitle = (res?.title ?? this.categoryTitle).toString().trim() || this.categoryTitle;
          this.page = Number(res.pageCurrent || 1);
          this.totalPages = Number(res.pageTotal || 1);
          this.items = Array.isArray(res.items) ? res.items : [];
          this.infiniteDisabled = !(this.page < this.totalPages);
        },
        error: () => {
          this.items = [];
          this.toast.presentToast('Could not load featured titles.');
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
    this.featured.fetchBrowseCategoryPage(this.categoryId, nextPage, this.pageSize)
      .pipe(finalize(() => {
        this.loadingMore = false;
        ev?.target?.complete?.();
      }))
      .subscribe({
        next: (res) => {
          if (!res?.success) {
            this.toast.presentToast(res?.message || 'Could not load more featured titles.');
            return;
          }
          this.page = Number(res.pageCurrent || nextPage);
          this.totalPages = Number(res.pageTotal || this.totalPages);
          this.items = [...this.items, ...(res.items ?? [])];
          this.infiniteDisabled = !(this.page < this.totalPages);
        },
        error: () => this.toast.presentToast('Could not load more featured titles.'),
      });
  }

  coverUrl(i: FeaturedRecord): string {
    return (i?.image ?? '').toString().trim();
  }

  titleText(i: FeaturedRecord): string {
    return (i?.title ?? '').toString().trim() || 'Untitled';
  }

  authorText(i: FeaturedRecord): string {
    return (i?.author ?? '').toString().trim();
  }

  async openRecord(i: FeaturedRecord) {
    const isEvent = (i?.type ?? '').toString().trim().toLowerCase() === 'event';
    const url = (i?.url ?? '').toString().trim();
    if (isEvent && url) {
      await this.globals.open_page(url);
      return;
    }

    const key = (i?.key ?? '').toString().trim();
    if (!key) {
      this.toast.presentToast('No record link available for this featured item.');
      return;
    }

    const hit: AspenSearchHit = {
      key,
      title: this.titleText(i),
      author: this.authorText(i) || undefined,
      coverUrl: this.coverUrl(i) || undefined,
      summary: (i?.summary ?? '').toString().trim() || undefined,
      language: undefined,
      format: undefined,
      itemList: Array.isArray(i?.itemList) ? i.itemList as any : [],
      catalogUrl: `${this.globals.aspen_discovery_base}/GroupedWork/${encodeURIComponent(key)}`,
      raw: i?.raw ?? i,
    };

    const modal = await this.modalCtrl.create({
      component: ItemDetailComponent,
      componentProps: { hit },
    });
    this.globals.modal_open = true;
    await modal.present();
  }

  trackByRecord(_idx: number, i: FeaturedRecord): string {
    return (i?.key ?? '').toString().trim() || `${_idx}`;
  }
}
