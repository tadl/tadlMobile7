import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController } from '@ionic/angular';
import { ActivatedRoute } from '@angular/router';
import { finalize } from 'rxjs';

import { Globals } from '../../globals';
import { ToastService } from '../../services/toast.service';
import { SearchService, AspenSearchHit, AspenSearchIndex, AspenSearchSort } from '../../services/search.service';
import { ItemDetailComponent } from '../../components/item-detail/item-detail.component';

@Component({
  standalone: true,
  selector: 'app-search',
  templateUrl: './search.page.html',
  styleUrls: ['./search.page.scss'],
  imports: [CommonModule, FormsModule, IonicModule],
})
export class SearchPage {
  lookfor = '';
  hits: AspenSearchHit[] = [];

  // advanced controls (start simple)
  showAdvanced = false;
  searchIndex: AspenSearchIndex = 'Keyword';
  sort: AspenSearchSort = 'relevance';

  // later: facet filters become strings like "format:Book"
  filters: string[] = [];

  // paging / infinite scroll
  page = 1;
  pageSize = 25;
  totalPages = 1;
  infiniteDisabled = true;

  constructor(
    public globals: Globals,
    public toast: ToastService,
    private searchService: SearchService,
    private modalController: ModalController,
    private route: ActivatedRoute,
  ) {}

  ionViewDidEnter() {
    // allow deep link: /search?lookfor=...
    const q = (this.route.snapshot.queryParamMap.get('lookfor') ?? '').trim();
    if (q && q !== this.lookfor) {
      this.lookfor = q;
      this.runSearch(true);
    }
  }

  onSubmit() {
    this.runSearch(true);
  }

  runSearch(reset: boolean) {
    const q = (this.lookfor ?? '').trim();

    if (!q) {
      this.hits = [];
      this.page = 1;
      this.totalPages = 1;
      this.infiniteDisabled = true;
      return;
    }

    // If reset, start over.
    if (reset) {
      this.page = 1;
      this.totalPages = 1;
      this.hits = [];
      this.infiniteDisabled = true;
    }

    // prevent overlapping requests
    if (this.globals.api_loading) return;

    this.globals.api_loading = true;

    this.searchService
      .getAppSearchResults({
        lookfor: q,
        page: this.page,
        pageSize: this.pageSize,
        searchIndex: this.searchIndex,
        source: 'local',
        sort: this.sort,
        filters: this.filters,
      })
      .pipe(finalize(() => (this.globals.api_loading = false)))
      .subscribe({
        next: res => {
          if (!res.success) {
            this.toast.presentToast('Search failed. Please try again.');
            this.hits = reset ? [] : this.hits;
            this.infiniteDisabled = true;
            return;
          }

          const newHits = res.hits ?? [];
          this.totalPages = res.totalPages ?? this.totalPages ?? 1;

          if (reset) {
            this.hits = newHits;
          } else {
            // append for infinite scroll
            this.hits = [...this.hits, ...newHits];
          }

          // enable infinite scroll if there are more pages
          this.infiniteDisabled = !(this.page < this.totalPages);
        },
        error: () => {
          this.toast.presentToast(this.globals.server_error_msg);
          this.infiniteDisabled = true;
        },
      });
  }

  loadMore(ev: any) {
    // if already done, just complete the UI gesture
    if (this.globals.api_loading || this.infiniteDisabled) {
      ev?.target?.complete();
      return;
    }

    if (this.page >= this.totalPages) {
      this.infiniteDisabled = true;
      ev?.target?.complete();
      return;
    }

    this.page += 1;

    this.globals.api_loading = true;
    this.searchService
      .getAppSearchResults({
        lookfor: (this.lookfor ?? '').trim(),
        page: this.page,
        pageSize: this.pageSize,
        searchIndex: this.searchIndex,
        source: 'local',
        sort: this.sort,
        filters: this.filters,
      })
      .pipe(
        finalize(() => {
          this.globals.api_loading = false;
          ev?.target?.complete();
        }),
      )
      .subscribe({
        next: res => {
          if (!res.success) {
            // roll back page if it failed
            this.page = Math.max(1, this.page - 1);
            this.toast.presentToast('Could not load more results.');
            return;
          }

          this.totalPages = res.totalPages ?? this.totalPages ?? 1;
          this.hits = [...this.hits, ...(res.hits ?? [])];
          this.infiniteDisabled = !(this.page < this.totalPages);
        },
        error: () => {
          this.page = Math.max(1, this.page - 1);
          this.toast.presentToast(this.globals.server_error_msg);
        },
      });
  }

  toggleAdvanced() {
    this.showAdvanced = !this.showAdvanced;
  }

  async openDetail(hit: AspenSearchHit) {
    const modal = await this.modalController.create({
      component: ItemDetailComponent,
      componentProps: { hit },
    });
    this.globals.modal_open = true;
    return await modal.present();
  }

  trackById(_idx: number, h: AspenSearchHit) {
    return h.key;
  }

  listCountLabel(hit: AspenSearchHit): string {
    const count = hit.appearsOnLists?.length ?? 0;
    return count === 1 ? 'In list' : 'In lists';
  }

  listTitles(hit: AspenSearchHit): string {
    return (hit.appearsOnLists ?? [])
      .map(x => x.title)
      .filter(Boolean)
      .join(', ');
  }

  formatLastCheckOut(value?: string | number | null): string {
    if (value === null || value === undefined || value === '') return '';
    let dateValue: number | string = value;
    if (typeof value === 'number') {
      dateValue = value < 1e12 ? value * 1000 : value;
    } else {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        dateValue = numeric < 1e12 ? numeric * 1000 : numeric;
      }
    }
    const parsed = new Date(dateValue);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toLocaleDateString();
  }
}
