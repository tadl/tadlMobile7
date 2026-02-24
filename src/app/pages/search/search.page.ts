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

interface SearchFacetOption {
  filter: string;
  field: string;
  value: string;
  display: string;
  count: number;
  isApplied: boolean;
}

interface SearchFacetGroup {
  key: string;
  label: string;
  multiSelect: boolean;
  options: SearchFacetOption[];
}

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
  lastExecutedQuery = '';

  // advanced controls (start simple)
  showAdvanced = false;
  searchIndex: AspenSearchIndex = 'Keyword';
  sort: AspenSearchSort = 'relevance';

  filters: string[] = [];
  facetGroups: SearchFacetGroup[] = [];
  private facetDisplayByFilter = new Map<string, string>();

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

  clearSearch() {
    this.lastExecutedQuery = '';
    this.hits = [];
    this.page = 1;
    this.totalPages = 1;
    this.infiniteDisabled = true;
  }

  runSearch(reset: boolean) {
    const q = (this.lookfor ?? '').trim();

    if (!q) {
      this.lastExecutedQuery = '';
      this.hits = [];
      this.page = 1;
      this.totalPages = 1;
      this.infiniteDisabled = true;
      this.facetGroups = [];
      this.facetDisplayByFilter.clear();
      return;
    }

    this.lastExecutedQuery = q;

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
          this.facetGroups = this.buildFacetGroups(res.facets);
          this.rebuildFacetDisplayMap();

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

  onFacetToggled(group: SearchFacetGroup, option: SearchFacetOption, checked: boolean) {
    let next = [...this.filters];

    if (checked) {
      if (!group.multiSelect) {
        next = next.filter(f => this.filterField(f) !== option.field);
      }
      if (!next.includes(option.filter)) {
        next.push(option.filter);
      }
    } else {
      next = next.filter(f => f !== option.filter);
    }

    this.filters = next;
    this.runSearch(true);
  }

  isFacetSelected(filter: string): boolean {
    return this.filters.includes(filter);
  }

  clearAllFilters() {
    if (!this.filters.length) return;
    this.filters = [];
    this.runSearch(true);
  }

  removeFilter(filter: string) {
    if (!this.filters.includes(filter)) return;
    this.filters = this.filters.filter(f => f !== filter);
    this.runSearch(true);
  }

  filterChipLabel(filter: string): string {
    return this.facetDisplayByFilter.get(filter) || filter;
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

  trackFacetGroup(_idx: number, g: SearchFacetGroup) {
    return g.key;
  }

  trackFacetOption(_idx: number, o: SearchFacetOption) {
    return o.filter;
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

  private buildFacetGroups(rawFacets?: Record<string, any>): SearchFacetGroup[] {
    if (!rawFacets || typeof rawFacets !== 'object') return [];

    const groups: SearchFacetGroup[] = [];

    for (const [facetKey, facetInfo] of Object.entries(rawFacets)) {
      const label = this.decodeLabel((facetInfo as any)?.label) || facetKey;
      const multiSelect = !!(facetInfo as any)?.multiSelect;
      const list = (facetInfo as any)?.list;
      const listValues = Array.isArray(list) ? list : (list && typeof list === 'object' ? Object.values(list) : []);
      const options: SearchFacetOption[] = [];

      for (const rawOption of listValues as any[]) {
        const value = (rawOption?.value ?? '').toString().trim();
        if (!value) continue;

        const field = this.inferFacetField(facetKey, rawOption);
        const filter = `${field}:${value}`;
        options.push({
          filter,
          field,
          value,
          display: this.decodeLabel(rawOption?.display) || value,
          count: Number(rawOption?.count ?? 0) || 0,
          isApplied: !!rawOption?.isApplied,
        });
      }

      if (!options.length) continue;
      groups.push({ key: facetKey, label, multiSelect, options });
    }

    return groups;
  }

  private inferFacetField(facetKey: string, rawOption: any): string {
    const explicitField = (rawOption?.field ?? '').toString().trim();
    if (explicitField) return explicitField;
    return (facetKey ?? '').toString().trim() || 'unknown';
  }

  private filterField(filter: string): string {
    const idx = filter.indexOf(':');
    if (idx <= 0) return filter;
    return filter.slice(0, idx);
  }

  private rebuildFacetDisplayMap() {
    this.facetDisplayByFilter.clear();
    for (const group of this.facetGroups) {
      for (const option of group.options) {
        this.facetDisplayByFilter.set(option.filter, `${group.label}: ${option.display}`);
      }
    }
  }

  private decodeLabel(input: any): string {
    if (typeof input !== 'string') return '';
    let s = input.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    try {
      const txt = document.createElement('textarea');
      txt.innerHTML = s;
      s = txt.value;
    } catch {
      // ignore
    }
    return s;
  }
}
