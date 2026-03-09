import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController, ActionSheetController, type ActionSheetButton } from '@ionic/angular';
import { ActivatedRoute } from '@angular/router';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { lastValueFrom } from 'rxjs';
import {
  CapacitorBarcodeScanner,
  CapacitorBarcodeScannerAndroidScanningLibrary,
  CapacitorBarcodeScannerCameraDirection,
  CapacitorBarcodeScannerScanOrientation,
  CapacitorBarcodeScannerTypeHint,
} from '@capacitor/barcode-scanner';
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';

import { Globals } from '../../globals';
import { ToastService } from '../../services/toast.service';
import { SearchService, AspenSearchHit, AspenSearchIndex, AspenSearchSort } from '../../services/search.service';
import { ItemDetailComponent } from '../../components/item-detail/item-detail.component';
import { FormatFamilyService } from '../../services/format-family.service';
import { ListsService, AspenUserList } from '../../services/lists.service';
import { ListMembershipIndexService } from '../../services/list-membership-index.service';
import { ItemService } from '../../services/item.service';
import { HoldsService } from '../../services/holds.service';
import { AccountPreferencesService } from '../../services/account-preferences.service';
import { AuthService } from '../../services/auth.service';

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

interface HoldTargetOption {
  recordId: string;
  label: string;
  formatLabel: string;
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
  actionBusyByKey: Record<string, boolean> = {};

  constructor(
    public globals: Globals,
    public toast: ToastService,
    private searchService: SearchService,
    private modalController: ModalController,
    private actionSheetController: ActionSheetController,
    private formatFamily: FormatFamilyService,
    private listsService: ListsService,
    private membershipIndex: ListMembershipIndexService,
    private itemService: ItemService,
    private holds: HoldsService,
    private accountPreferences: AccountPreferencesService,
    private auth: AuthService,
    private route: ActivatedRoute,
    private router: Router,
  ) {}

  ionViewDidEnter() {
    // allow deep link: /search?lookfor=...
    const qp = this.route.snapshot.queryParamMap;
    const advanced = (qp.get('advanced') ?? '').trim();
    if (advanced === '1' || advanced.toLowerCase() === 'true') {
      this.showAdvanced = true;
    }

    const incomingSearchIndex = (qp.get('searchIndex') ?? '').trim();
    if (incomingSearchIndex) {
      this.searchIndex = incomingSearchIndex as AspenSearchIndex;
    }

    const incomingSort = this.normalizedSortValue((qp.get('sort') ?? '').trim());
    if (incomingSort) {
      this.sort = incomingSort;
    }

    const facets = (qp.get('facets') ?? '').trim();
    if (facets === '1' || facets.toLowerCase() === 'true') {
      this.facetsEnabled = true;
      this.showAdvanced = true;
    }

    const incomingFilters = qp.getAll('filter').map((x) => x.trim()).filter((x) => !!x);
    if (incomingFilters.length) {
      this.filters = Array.from(new Set(incomingFilters));
      this.facetsEnabled = true;
      this.showAdvanced = true;
    }

    const q = (qp.get('lookfor') ?? '').trim();
    if (!q) {
      this.lookfor = '';
      this.clearSearch();
      return;
    }

    if (q && q !== this.lookfor) {
      this.lookfor = q;
      this.runSearch(true);
    }
  }

  async onSubmit() {
    await this.dismissKeyboard();
    this.runSearch(true);
  }

  async searchMelcat() {
    const q = (this.lookfor ?? '').trim();
    if (!q) {
      this.toast.presentToast('To search MeLCat, please provide a search query.');
      return;
    }
    await this.globals.open_page(this.globals.melcatSearchUrl(q));
  }

  async suggestItem() {
    await this.globals.open_page(this.globals.suggest_item_url);
  }

  private async dismissKeyboard() {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await Keyboard.hide();
    } catch {
      // Ignore keyboard plugin errors and proceed with search.
    }
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
    this.syncSearchUrl('');
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
      this.syncSearchUrl('');
      return;
    }

    this.syncSearchUrl(q);
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

  async openHitActions(hit: AspenSearchHit, ev?: Event) {
    ev?.stopPropagation();

    const buttons: ActionSheetButton[] = [];
    if (this.canPlaceHoldFromHit(hit)) {
      buttons.push({
        text: 'Place Hold',
        handler: () => this.placeHoldFromHit(hit),
      });
    }
    buttons.push(
      {
        text: 'Add to List',
        handler: () => this.addHitToList(hit),
      },
      {
        text: 'View Details',
        handler: () => this.openDetail(hit),
      },
      { text: 'Close', role: 'cancel' },
    );

    const sheet = await this.actionSheetController.create({
      header: hit.title || 'Search Result',
      buttons,
    });
    await sheet.present();
  }

  trackById(_idx: number, h: AspenSearchHit) {
    return h.key;
  }

  mediaFamilySummary(hit: AspenSearchHit): string {
    return this.formatFamily.familySummaryForHit(hit);
  }

  mediaIconName(hit: AspenSearchHit): string {
    const family = this.formatFamily.primaryFamilyForHit(hit);
    if (family === 'book') return 'book-outline';
    if (family === 'music') return 'disc-outline';
    if (family === 'video') return 'videocam-outline';
    return 'albums-outline';
  }

  canPlaceHoldFromHit(hit: AspenSearchHit): boolean {
    return this.formatFamily.hasPhysicalHoldableFormat(hit);
  }

  rowActionBusy(hit: AspenSearchHit): boolean {
    const key = (hit?.key ?? '').toString().trim();
    return !!(key && this.actionBusyByKey[key]);
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

  private async addHitToList(hit: AspenSearchHit): Promise<void> {
    const recordId = (hit?.key ?? '').toString().trim();
    if (!recordId) {
      this.toast.presentToast('This record is missing an id.');
      return;
    }

    if (!this.auth.snapshot()?.isLoggedIn) {
      this.toast.presentToast('Log in to add items to lists.');
      return;
    }

    let lists: AspenUserList[] = [];
    try {
      lists = await lastValueFrom(this.listsService.fetchUserLists());
    } catch {
      this.toast.presentToast('Could not load your lists.');
      return;
    }

    if (!lists.length) {
      this.toast.presentToast('You do not have any lists yet.');
      return;
    }

    const sheet = await this.actionSheetController.create({
      header: 'Add to which list?',
      buttons: [
        ...lists.map((list): ActionSheetButton => ({
          text: this.actionListLabel(list),
          handler: () => this.addRecordToNamedList(list, hit),
        })),
        { text: 'Close', role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  private actionListLabel(list: AspenUserList): string {
    const title = (list?.title ?? '').toString().trim() || 'Untitled list';
    const n = Number((list as any)?.numTitles ?? 0);
    if (Number.isFinite(n) && n > 0) return `${title} (${n})`;
    return title;
  }

  private addRecordToNamedList(list: AspenUserList, hit: AspenSearchHit): void {
    const listId = (list?.id ?? '').toString().trim();
    const recordId = (hit?.key ?? '').toString().trim();
    if (!listId || !recordId) return;
    if (this.rowActionBusy(hit)) return;

    this.setRowBusy(hit, true);
    this.listsService.addTitlesToList(listId, [recordId])
      .pipe(finalize(() => this.setRowBusy(hit, false)))
      .subscribe({
        next: (res) => {
          if (!res?.success) {
            this.toast.presentToast(res?.message || 'Could not add to list.');
            return;
          }
          const listTitle = (list?.title ?? '').toString().trim() || 'Untitled list';
          this.membershipIndex.upsertMembership(recordId, listId, listTitle).catch(() => {});
          this.toast.presentToast(res?.message || 'Added to list.');
        },
        error: () => this.toast.presentToast('Could not add to list.'),
      });
  }

  private async placeHoldFromHit(hit: AspenSearchHit): Promise<void> {
    if (!this.auth.snapshot()?.isLoggedIn) {
      this.toast.presentToast('Log in to place holds.');
      return;
    }
    if (!this.canPlaceHoldFromHit(hit)) {
      this.toast.presentToast('No physical holdable format found for this result.');
      return;
    }
    if (this.rowActionBusy(hit)) return;

    const holdTargets = await this.resolveIlsHoldTargets(hit);
    if (!holdTargets.length) {
      this.toast.presentToast('Could not determine holdable record id. Open details to place hold.');
      return;
    }

    const heldRecordIds = await this.heldRecordIdsForGroupedWork(hit);
    let availableTargets = holdTargets.filter((x) => !heldRecordIds.has(x.recordId));

    // Fallback when hold entries do not expose recordId reliably.
    if (!availableTargets.length && heldRecordIds.size === 0) {
      const heldFormatKeys = await this.heldFormatKeysForGroupedWork(hit);
      availableTargets = holdTargets.filter(
        (x) => !heldFormatKeys.has(this.normalizeFormatKey(x.formatLabel)),
      );
    }

    if (!availableTargets.length) {
      this.toast.presentToast('You already have all holdable formats on hold.');
      return;
    }

    let selectedTarget = availableTargets[0];
    if (availableTargets.length > 1) {
      const picked = await this.pickHoldTarget(availableTargets);
      if (!picked) return;
      selectedTarget = picked;
    }

    const defaultPickup = await this.defaultPickupBranchCode();
    if (defaultPickup) {
      this.placeHoldNow(hit, selectedTarget.recordId, defaultPickup, selectedTarget.label);
      return;
    }

    const buttons: ActionSheetButton[] = this.globals.pickupLocations.map((loc) => ({
      text: loc.name,
      handler: () => this.placeHoldNow(hit, selectedTarget.recordId, loc.code, selectedTarget.label),
    }));
    buttons.push({ text: 'Close', role: 'cancel' });

    const sheet = await this.actionSheetController.create({
      header: 'Pick up where?',
      buttons,
    });
    await sheet.present();
  }

  private placeHoldNow(
    hit: AspenSearchHit,
    recordId: string,
    pickupBranch: string,
    selectedFormatLabel?: string,
  ): void {
    if (this.rowActionBusy(hit)) return;
    this.setRowBusy(hit, true);
    this.holds.placeHold(recordId, pickupBranch, null)
      .pipe(finalize(() => this.setRowBusy(hit, false)))
      .subscribe({
        next: (res) => {
          if (!res?.success) {
            this.toast.presentToast(res?.message || 'Could not place hold.');
            return;
          }
          if (selectedFormatLabel) {
            this.toast.presentToast(`Hold placed on format ${selectedFormatLabel}.`);
            return;
          }
          this.toast.presentToast(res?.message || 'Hold placed.');
        },
        error: () => this.toast.presentToast('Could not place hold.'),
      });
  }

  private async resolveIlsHoldTargets(hit: AspenSearchHit): Promise<HoldTargetOption[]> {
    const groupedKey = (hit?.key ?? '').toString().trim();
    if (!groupedKey) return [];

    try {
      const work = await lastValueFrom(this.itemService.getGroupedWork(groupedKey));
      const physicalById = new Map<string, HoldTargetOption>();
      const anyById = new Map<string, HoldTargetOption>();

      for (const [formatKey, fmt] of Object.entries(work?.formats ?? {})) {
        const cls = this.formatFamily.classifyFormatLabel(formatKey);
        const formatLabel =
          (fmt?.label ?? '').toString().trim() ||
          (formatKey ?? '').toString().trim() ||
          'Format';

        for (const action of fmt?.actions ?? []) {
          const id = this.itemService.extractIlsIdFromOnclick((action as any)?.onclick);
          if (!id) continue;
          const actionTitle = ((action as any)?.title ?? '').toString().trim();
          const isRedundantPlaceHold = actionTitle.toLowerCase() === 'place hold';
          const label = actionTitle && !isRedundantPlaceHold ? `${formatLabel} (${actionTitle})` : formatLabel;
          const target: HoldTargetOption = { recordId: id, label, formatLabel };
          if (!anyById.has(id)) anyById.set(id, target);
          if (cls.physical && !physicalById.has(id)) physicalById.set(id, target);
        }
      }

      const physical = Array.from(physicalById.values());
      if (physical.length) return physical;

      return Array.from(anyById.values());
    } catch {
      return [];
    }
  }

  private async pickHoldTarget(options: HoldTargetOption[]): Promise<HoldTargetOption | null> {
    return new Promise(async (resolve) => {
      const sheet = await this.actionSheetController.create({
        header: 'Place hold on which format?',
        buttons: [
          ...options.map((opt): ActionSheetButton => ({
            text: opt.label,
            handler: () => resolve(opt),
          })),
          {
            text: 'Close',
            role: 'cancel',
            handler: () => resolve(null),
          },
        ],
      });

      await sheet.present();
      await sheet.onDidDismiss();
      resolve(null);
    });
  }

  private async heldFormatKeysForGroupedWork(hit: AspenSearchHit): Promise<Set<string>> {
    const groupedKey = (hit?.key ?? '').toString().trim().toLowerCase();
    if (!groupedKey) return new Set<string>();

    try {
      const holds = await lastValueFrom(this.holds.fetchActiveHolds());
      const keys = new Set<string>();

      for (const hold of holds ?? []) {
        const holdGrouped = (hold?.groupedWorkId ?? '').toString().trim().toLowerCase();
        if (!holdGrouped || holdGrouped !== groupedKey) continue;

        const f = (hold as any)?.format;
        if (Array.isArray(f)) {
          for (const x of f) {
            const key = this.normalizeFormatKey((x ?? '').toString());
            if (key) keys.add(key);
          }
        } else if (typeof f === 'string') {
          const key = this.normalizeFormatKey(f);
          if (key) keys.add(key);
        }
      }

      return keys;
    } catch {
      return new Set<string>();
    }
  }

  private async heldRecordIdsForGroupedWork(hit: AspenSearchHit): Promise<Set<string>> {
    const groupedKey = (hit?.key ?? '').toString().trim().toLowerCase();
    if (!groupedKey) return new Set<string>();

    try {
      const holds = await lastValueFrom(this.holds.fetchActiveHolds());
      const ids = new Set<string>();

      for (const hold of holds ?? []) {
        const holdGrouped = (hold?.groupedWorkId ?? '').toString().trim().toLowerCase();
        if (!holdGrouped || holdGrouped !== groupedKey) continue;

        const rid = (hold?.recordId ?? '').toString().trim();
        if (rid) ids.add(rid);
      }

      return ids;
    } catch {
      return new Set<string>();
    }
  }

  private normalizeFormatKey(value: string): string {
    return (value ?? '')
      .toString()
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  private async defaultPickupBranchCode(): Promise<string | null> {
    const activeId = (this.auth.snapshot()?.activeAccountId ?? '').toString().trim();
    if (!activeId) return null;

    try {
      const prefs = await this.accountPreferences.getCachedPreferences(activeId);
      const legacyCode = (prefs?.pickup_library ?? '').toString().trim();
      if (!legacyCode) return null;
      const loc = this.globals.pickupLocationFromLegacyPreferencesCode(legacyCode);
      return loc?.code ?? null;
    } catch {
      return null;
    }
  }

  private syncSearchUrl(query: string): void {
    const lookfor = (query ?? '').trim();
    const queryParams: Record<string, any> = {
      lookfor: lookfor || null,
      advanced: this.showAdvanced ? '1' : null,
      searchIndex: this.searchIndex && this.searchIndex !== 'Keyword' ? this.searchIndex : null,
      sort: this.sort && this.sort !== 'relevance' ? this.sort : null,
      facets: this.facetsEnabled ? '1' : null,
      filter: this.filters.length ? this.filters : null,
    };

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      replaceUrl: true,
    });
  }

  private setRowBusy(hit: AspenSearchHit, busy: boolean) {
    const key = (hit?.key ?? '').toString().trim();
    if (!key) return;
    this.actionBusyByKey = {
      ...this.actionBusyByKey,
      [key]: busy,
    };
  }
}
