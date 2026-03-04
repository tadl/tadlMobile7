import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController } from '@ionic/angular';
import { ActivatedRoute } from '@angular/router';
import { finalize } from 'rxjs';
import {
  CapacitorBarcodeScanner,
  CapacitorBarcodeScannerAndroidScanningLibrary,
  CapacitorBarcodeScannerCameraDirection,
  CapacitorBarcodeScannerScanOrientation,
  CapacitorBarcodeScannerTypeHint,
} from '@capacitor/barcode-scanner';
import { Capacitor } from '@capacitor/core';

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
  field: string;
  label: string;
  multiSelect: boolean;
  options: SearchFacetOption[];
}

interface SearchSortOption {
  value: AspenSearchSort;
  label: string;
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
  facetsEnabled = false;
  searchIndex: AspenSearchIndex = 'Keyword';
  sort: AspenSearchSort = 'relevance';
  sortOptions: SearchSortOption[] = [
    { value: 'relevance', label: 'Best Match' },
    { value: 'year desc,title asc', label: 'Publication Year Desc' },
    { value: 'year asc,title asc', label: 'Publication Year Asc' },
    { value: 'author asc,title asc', label: 'Author' },
    { value: 'title', label: 'Title' },
    { value: 'days_since_added asc', label: 'Date Purchased Desc' },
    { value: 'callnumber_sort', label: 'Call Number' },
    { value: 'popularity desc', label: 'Total Checkouts' },
    { value: 'rating desc', label: 'User Rating' },
    { value: 'total_holds desc', label: 'Number of Holds' },
  ];

  filters: string[] = [];
  facetGroups: SearchFacetGroup[] = [];
  collapsedFacetGroups: Record<string, boolean> = {};
  private facetDisplayByFilter = new Map<string, string>();

  // paging / infinite scroll
  page = 1;
  pageSize = 25;
  totalPages = 1;
  infiniteDisabled = true;
  scanningIsbn = false;

  constructor(
    public globals: Globals,
    public toast: ToastService,
    private searchService: SearchService,
    private modalController: ModalController,
    private route: ActivatedRoute,
  ) {}

  ionViewDidEnter() {
    // allow deep link: /search?lookfor=...
    const advanced = (this.route.snapshot.queryParamMap.get('advanced') ?? '').trim();
    if (advanced === '1' || advanced.toLowerCase() === 'true') {
      this.showAdvanced = true;
    }

    const q = (this.route.snapshot.queryParamMap.get('lookfor') ?? '').trim();
    if (q && q !== this.lookfor) {
      this.lookfor = q;
      this.runSearch(true);
    }
  }

  onSubmit() {
    this.runSearch(true);
  }

  async searchMelcat() {
    const q = (this.lookfor ?? '').trim();
    await this.globals.open_page(this.globals.melcatSearchUrl(q));
  }

  async suggestItem() {
    await this.globals.open_page(this.globals.suggest_item_url);
  }

  async scanIsbn() {
    if (!Capacitor.isNativePlatform()) {
      this.showAdvanced = true;
      this.searchIndex = 'ISBN';
      this.toast.presentToast('ISBN scanning is available in iOS/Android app builds.');
      return;
    }

    if (this.scanningIsbn) return;
    this.scanningIsbn = true;

    try {
      const res = await CapacitorBarcodeScanner.scanBarcode({
        hint: CapacitorBarcodeScannerTypeHint.EAN_13,
        scanInstructions: 'Scan the ISBN barcode',
        cameraDirection: CapacitorBarcodeScannerCameraDirection.BACK,
        scanOrientation: CapacitorBarcodeScannerScanOrientation.ADAPTIVE,
        android: { scanningLibrary: CapacitorBarcodeScannerAndroidScanningLibrary.MLKIT },
      });

      const raw = (res?.ScanResult ?? '').toString().trim();
      if (!raw) return;

      const isbn = this.normalizeScannedIsbn(raw);
      if (!isbn) {
        this.toast.presentToast('Scanned code was not a valid ISBN.');
        return;
      }

      this.lookfor = isbn;
      this.searchIndex = 'ISBN';
      this.showAdvanced = true;
      this.runSearch(true);
    } catch (err: any) {
      const msg = (err?.message ?? err ?? '').toString().toLowerCase();
      const canceled =
        msg.includes('cancel') ||
        msg.includes('dismiss') ||
        msg.includes('close') ||
        msg.includes('back');
      if (!canceled) this.toast.presentToast('Could not scan barcode.');
    } finally {
      this.scanningIsbn = false;
    }
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
    this.filters = this.filters.filter(f => this.filterField(f) !== 'sort_by');
    const sortValue = this.normalizedSortValue(this.sort);
    if (sortValue !== this.sort) this.sort = sortValue;

    if (!q) {
      this.lastExecutedQuery = '';
      this.hits = [];
      this.page = 1;
      this.totalPages = 1;
      this.infiniteDisabled = true;
      this.facetGroups = [];
      this.collapsedFacetGroups = {};
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
        sort: sortValue,
        includeSortList: true,
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
          const allGroups = this.buildFacetGroups(res.facets);
          this.applySortOptionsFromGroups(allGroups);
          if (this.facetsEnabled) {
            this.facetGroups = allGroups.filter(g => g.field !== 'sort_by');
            this.reconcileCollapsedFacetGroups();
            this.rebuildFacetDisplayMap();
          } else {
            this.facetGroups = [];
            this.collapsedFacetGroups = {};
            this.facetDisplayByFilter.clear();
          }

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
    const sortValue = this.normalizedSortValue(this.sort);
    if (sortValue !== this.sort) this.sort = sortValue;

    this.globals.api_loading = true;
    this.searchService
      .getAppSearchResults({
        lookfor: (this.lookfor ?? '').trim(),
        page: this.page,
        pageSize: this.pageSize,
        searchIndex: this.searchIndex,
        source: 'local',
        sort: sortValue,
        includeSortList: true,
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
          const allGroups = this.buildFacetGroups(res.facets);
          this.applySortOptionsFromGroups(allGroups);
          this.hits = [...this.hits, ...(res.hits ?? [])];
          this.infiniteDisabled = !(this.page < this.totalPages);
        },
        error: () => {
          this.page = Math.max(1, this.page - 1);
          this.toast.presentToast(this.globals.server_error_msg);
        },
      });
  }

  onFacetsEnabledChanged(enabled: boolean) {
    this.facetsEnabled = !!enabled;

    if (!this.facetsEnabled) {
      const hadFilters = this.filters.length > 0;
      this.filters = [];
      this.facetGroups = [];
      this.collapsedFacetGroups = {};
      this.facetDisplayByFilter.clear();
      if (hadFilters && this.lookfor.trim()) this.runSearch(true);
      return;
    }

    if (this.lookfor.trim()) this.runSearch(true);
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

  toggleFacetGroup(groupKey: string) {
    const current = !!this.collapsedFacetGroups[groupKey];
    this.collapsedFacetGroups = {
      ...this.collapsedFacetGroups,
      [groupKey]: !current,
    };
  }

  isFacetGroupCollapsed(groupKey: string): boolean {
    return !!this.collapsedFacetGroups[groupKey];
  }

  selectedOptionsForGroup(group: SearchFacetGroup): SearchFacetOption[] {
    return group.options.filter(opt => this.isFacetSelected(opt.filter));
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
      const groupField = (facetInfo as any)?.field?.toString?.().trim?.() || '';
      const list = (facetInfo as any)?.list ?? (facetInfo as any)?.facets;
      const listValues = Array.isArray(list) ? list : (list && typeof list === 'object' ? Object.values(list) : []);
      const options: SearchFacetOption[] = [];

      for (const rawOption of listValues as any[]) {
        const value = (rawOption?.value ?? '').toString().trim();
        if (!value) continue;

        const field = this.inferFacetField(facetKey, rawOption, groupField);
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
      groups.push({ key: facetKey, field: groupField || facetKey, label, multiSelect, options });
    }

    return groups;
  }

  private inferFacetField(facetKey: string, rawOption: any, groupField?: string): string {
    if (groupField) return groupField;
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

  private reconcileCollapsedFacetGroups() {
    const next: Record<string, boolean> = {};
    for (const group of this.facetGroups) {
      next[group.key] = this.collapsedFacetGroups[group.key] ?? true;
    }
    this.collapsedFacetGroups = next;
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

  private normalizedSortValue(input: AspenSearchSort): AspenSearchSort {
    const raw = (input ?? '').toString().trim();
    if (!raw) return 'relevance';

    const legacyMap: Record<string, AspenSearchSort> = {
      newest_to_oldest: 'year desc,title asc',
      oldest_to_newest: 'year asc,title asc',
      author: 'author asc,title asc',
      datePurchased: 'days_since_added asc',
      'datePurchased desc': 'days_since_added asc',
      'total_checkouts desc': 'popularity desc',
      'rating_summary desc': 'rating desc',
      'num_holds desc': 'total_holds desc',
    };

    return legacyMap[raw] ?? raw;
  }

  private applySortOptionsFromGroups(groups: SearchFacetGroup[]) {
    const sortGroup = groups.find(g => g.field === 'sort_by');
    if (!sortGroup?.options?.length) return;

    const options: SearchSortOption[] = sortGroup.options.map(o => ({
      value: o.value,
      label: o.display || o.value,
    }));
    this.sortOptions = options;

    const applied = sortGroup.options.find(o => o.isApplied);
    if (applied?.value) {
      this.sort = applied.value;
      return;
    }

    if (!options.some(o => o.value === this.sort)) {
      this.sort = options[0].value;
    }
  }

  private normalizeScannedIsbn(raw: string): string {
    const cleaned = (raw ?? '').replace(/[^0-9Xx]/g, '').toUpperCase();
    if (cleaned.length === 13) return cleaned;
    if (cleaned.length === 10) return cleaned;
    return '';
  }
}
