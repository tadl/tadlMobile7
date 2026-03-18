import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { IonicModule, ModalController, ActionSheetController, type ActionSheetButton } from '@ionic/angular';
import { finalize, lastValueFrom } from 'rxjs';

import { Globals } from '../../globals';
import { ToastService } from '../../services/toast.service';
import { FeaturedService, type FeaturedRecord } from '../../services/featured.service';
import { ItemDetailComponent } from '../../components/item-detail/item-detail.component';
import type { AspenSearchHit } from '../../services/search.service';
import { ListsService, type AspenUserList } from '../../services/lists.service';
import { ListMembershipIndexService } from '../../services/list-membership-index.service';
import { ItemService } from '../../services/item.service';
import { HoldsService } from '../../services/holds.service';
import { AccountPreferencesService } from '../../services/account-preferences.service';
import { AuthService } from '../../services/auth.service';
import { FormatFamilyService } from '../../services/format-family.service';

interface HoldTargetOption {
  recordId: string;
  label: string;
  formatLabel: string;
  isOnHold?: boolean;
}

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
  actionBusyByKey: Record<string, boolean> = {};

  constructor(
    public globals: Globals,
    private route: ActivatedRoute,
    private featured: FeaturedService,
    private toast: ToastService,
    private modalCtrl: ModalController,
    private actionSheetController: ActionSheetController,
    private listsService: ListsService,
    private membershipIndex: ListMembershipIndexService,
    private itemService: ItemService,
    private holds: HoldsService,
    private accountPreferences: AccountPreferencesService,
    private auth: AuthService,
    private formatFamily: FormatFamilyService,
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

    const hit = this.asSearchHit(i);
    if (!hit) {
      this.toast.presentToast('No record link available for this featured item.');
      return;
    }

    await this.openRecordDetails(hit);
  }

  async openRecordActions(i: FeaturedRecord, ev?: Event) {
    ev?.stopPropagation();

    const isEvent = (i?.type ?? '').toString().trim().toLowerCase() === 'event';
    const eventUrl = (i?.url ?? '').toString().trim();
    if (isEvent && eventUrl) {
      const sheet = await this.actionSheetController.create({
        header: this.titleText(i),
        buttons: [
          { text: 'Open Event', handler: () => this.globals.open_page(eventUrl) },
          { text: 'Close', role: 'cancel' },
        ],
      });
      await sheet.present();
      return;
    }

    const hit = this.asSearchHit(i);
    if (!hit) {
      this.toast.presentToast('No record link available for this featured item.');
      return;
    }

    const buttons: ActionSheetButton[] = [];
    if (this.auth.snapshot()?.isLoggedIn && this.canPlaceHoldFromHit(hit)) {
      const hasCachedHold = await this.hasCachedHoldForGroupedWork(hit);
      if (hasCachedHold) {
        buttons.push({
          text: 'On hold',
          cssClass: 'action-sheet-disabled-option',
          handler: () => false,
        });
      } else {
        buttons.push({
          text: 'Place Hold',
          handler: () => this.placeHoldFromHit(hit),
        });
      }
    }

    buttons.push(
      {
        text: 'Add to List',
        handler: () => this.addHitToList(hit),
      },
      {
        text: 'View Details',
        handler: () => this.openRecordDetails(hit),
      },
      { text: 'Close', role: 'cancel' },
    );

    const sheet = await this.actionSheetController.create({
      header: hit.title || 'Featured Item',
      buttons,
    });
    await sheet.present();
  }

  rowActionBusy(i: FeaturedRecord): boolean {
    const key = (i?.key ?? '').toString().trim();
    return this.rowActionBusyForKey(key);
  }

  trackByRecord(_idx: number, i: FeaturedRecord): string {
    return (i?.key ?? '').toString().trim() || `${_idx}`;
  }

  canPlaceHoldFromHit(hit: AspenSearchHit): boolean {
    return this.formatFamily.hasPhysicalHoldableFormat(hit);
  }

  mediaIconName(hit: AspenSearchHit): string {
    const family = this.formatFamily.primaryFamilyForHit(hit);
    if (family === 'book') return 'book-outline';
    if (family === 'music') return 'disc-outline';
    if (family === 'video') return 'videocam-outline';
    return 'albums-outline';
  }

  mediaIconNameForRecord(i: FeaturedRecord): string {
    const hit = this.asSearchHit(i);
    if (!hit) return 'albums-outline';
    return this.mediaIconName(hit);
  }

  private asSearchHit(i: FeaturedRecord): AspenSearchHit | null {
    const key = (i?.key ?? '').toString().trim();
    if (!key) return null;

    return {
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
  }

  private async openRecordDetails(hit: AspenSearchHit): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: ItemDetailComponent,
      componentProps: { hit },
    });
    this.globals.modal_open = true;
    await modal.present();
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
    const existingListIds = new Set(
      (await this.membershipIndex.membershipsForRecord(recordId))
        .map((m) => (m?.listId ?? '').toString().trim())
        .filter((id) => !!id),
    );

    const sheet = await this.actionSheetController.create({
      header: 'Add to which list?',
      buttons: [
        ...lists.map((list): ActionSheetButton => ({
          text: this.actionListLabel(list, existingListIds),
          handler: () => this.addRecordToNamedList(list, hit),
        })),
        { text: 'Close', role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  private actionListLabel(list: AspenUserList, existingListIds?: Set<string>): string {
    const title = (list?.title ?? '').toString().trim() || 'Untitled list';
    const n = Number((list as any)?.numTitles ?? 0);
    const listId = (list?.id ?? '').toString().trim();
    const base = Number.isFinite(n) && n > 0 ? `${title} (${n})` : title;
    return existingListIds?.has(listId) ? `${base} - already added` : base;
  }

  private addRecordToNamedList(list: AspenUserList, hit: AspenSearchHit): void {
    const listId = (list?.id ?? '').toString().trim();
    const recordId = (hit?.key ?? '').toString().trim();
    if (!listId || !recordId) return;
    if (this.rowActionBusyForKey(recordId)) return;

    this.setRowBusy(recordId, true);
    this.listsService.addTitlesToList(listId, [recordId])
      .pipe(finalize(() => this.setRowBusy(recordId, false)))
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

  private async placeHoldFromHit(hit: AspenSearchHit, precomputedTargets?: HoldTargetOption[]): Promise<void> {
    if (!this.auth.snapshot()?.isLoggedIn) {
      this.toast.presentToast('Log in to place holds.');
      return;
    }
    const groupedKey = (hit?.key ?? '').toString().trim();
    if (this.rowActionBusyForKey(groupedKey)) return;

    const holdTargets = precomputedTargets ?? await this.holdTargetsWithStatusForHit(hit);
    const availableTargets = holdTargets.filter((x) => !x.isOnHold);

    if (!availableTargets.length) {
      this.toast.presentToast('You already have all holdable formats on hold.');
      return;
    }

    let selectedTarget = availableTargets[0];
    if (holdTargets.length > 1) {
      const picked = await this.pickHoldTarget(holdTargets);
      if (!picked) return;
      selectedTarget = picked;
    }

    const defaultPickup = await this.defaultPickupBranchCode();
    if (defaultPickup) {
      this.placeHoldNow(hit, selectedTarget.recordId, defaultPickup, selectedTarget.formatLabel || selectedTarget.label);
      return;
    }

    const buttons: ActionSheetButton[] = this.globals.pickupLocations.map((loc) => ({
      text: loc.name,
      handler: () => this.placeHoldNow(hit, selectedTarget.recordId, loc.code, selectedTarget.formatLabel || selectedTarget.label),
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
    const key = (hit?.key ?? '').toString().trim();
    if (!key) return;
    if (this.rowActionBusyForKey(key)) return;

    this.setRowBusy(key, true);
    this.holds.placeHold(recordId, pickupBranch, null)
      .pipe(finalize(() => this.setRowBusy(key, false)))
      .subscribe({
        next: (res) => {
          if (!res?.success) {
            this.toast.presentToast(res?.message || 'Could not place hold.');
            return;
          }
          this.auth.adjustActiveProfileCounts({ holds: 1, holdsRequested: 1 });
          this.cacheOptimisticPlacedHold(hit, recordId, selectedFormatLabel);
          if (selectedFormatLabel) {
            this.toast.presentToast(`Hold placed on format ${selectedFormatLabel}.`);
            return;
          }
          this.toast.presentToast(res?.message || 'Hold placed.');
        },
        error: () => this.toast.presentToast('Could not place hold.'),
      });
  }

  private async holdTargetsWithStatusForHit(hit: AspenSearchHit): Promise<HoldTargetOption[]> {
    const holdTargets = await this.resolveIlsHoldTargets(hit);
    if (!holdTargets.length) return [];
    if (!this.auth.snapshot()?.isLoggedIn) return holdTargets;

    const heldRecordIds = await this.heldRecordIdsForGroupedWork(hit);
    const heldFormatKeys = await this.heldFormatKeysForGroupedWork(hit);

    return holdTargets.map((target) => {
      const isOnHold =
        heldRecordIds.has(target.recordId) ||
        heldFormatKeys.has(this.normalizeFormatKey(target.formatLabel));
      return { ...target, isOnHold };
    });
  }

  private async resolveIlsHoldTargets(hit: AspenSearchHit): Promise<HoldTargetOption[]> {
    const groupedKey = (hit?.key ?? '').toString().trim();
    if (!groupedKey) return [];

    const fromHit = this.resolveIlsHoldTargetsFromItemList(hit);
    if (fromHit.length) return fromHit;

    try {
      const work = await lastValueFrom(this.itemService.getGroupedWork(groupedKey));
      const physicalById = new Map<string, HoldTargetOption>();

      for (const [formatKey, fmt] of Object.entries(work?.formats ?? {})) {
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
          if (!physicalById.has(id)) physicalById.set(id, { recordId: id, label, formatLabel });
        }
      }

      return Array.from(physicalById.values());
    } catch {
      return [];
    }
  }

  private resolveIlsHoldTargetsFromItemList(hit: AspenSearchHit): HoldTargetOption[] {
    const physicalById = new Map<string, HoldTargetOption>();
    const anyById = new Map<string, HoldTargetOption>();

    const sourceItems = this.rawItemListEntries(hit);
    for (const item of sourceItems) {
      const source = (item?.source ?? item?.type ?? '').toString().trim().toLowerCase();
      if (source && source !== 'ils') continue;

      const recordId = this.extractIlsRecordIdFromItemLike(item);
      if (!recordId) continue;

      const formatLabel = (
        item?.name ??
        item?.label ??
        item?.format ??
        item?.title ??
        ''
      ).toString().trim() || 'Format';
      const cls = this.formatFamily.classifyFormatLabel(formatLabel);
      const target: HoldTargetOption = {
        recordId,
        label: formatLabel,
        formatLabel,
      };

      if (!anyById.has(recordId)) anyById.set(recordId, target);
      if (cls.physical && !physicalById.has(recordId)) physicalById.set(recordId, target);
    }

    const physical = Array.from(physicalById.values());
    if (physical.length) return physical;
    return Array.from(anyById.values());
  }

  private rawItemListEntries(hit: AspenSearchHit): any[] {
    const rawInput = (hit?.raw as any)?.itemList;
    const rawValues = Array.isArray(rawInput)
      ? rawInput
      : rawInput && typeof rawInput === 'object'
        ? Object.values(rawInput)
        : [];
    const normalized = Array.isArray(hit?.itemList) ? hit.itemList : [];
    return [...rawValues, ...normalized];
  }

  private extractIlsRecordIdFromItemLike(item: any): string {
    const directId = this.extractIlsRecordIdFromValue(item?.id ?? item?.recordId ?? item?.itemId);
    if (directId) return directId;

    const onclickId = this.itemService.extractIlsIdFromOnclick((item?.onclick ?? '').toString());
    if (onclickId) return onclickId;

    return '';
  }

  private extractIlsRecordIdFromValue(raw: any): string {
    const value = (raw ?? '').toString().trim();
    if (!value) return '';

    const stripped = this.itemService.stripIlsPrefix(value);
    if (/^\d+$/.test(stripped)) return stripped;

    const prefixedMatch = value.match(/(?:^|:)ils:(\d+)(?:$|:)/i);
    if (prefixedMatch?.[1]) return prefixedMatch[1];

    const digitsMatch = value.match(/\b(\d{5,})\b/);
    if (digitsMatch?.[1]) return digitsMatch[1];

    return '';
  }

  private async pickHoldTarget(options: HoldTargetOption[]): Promise<HoldTargetOption | null> {
    return new Promise(async (resolve) => {
      const sorted = [...options].sort((a, b) => {
        const aHeld = !!a.isOnHold;
        const bHeld = !!b.isOnHold;
        if (aHeld !== bHeld) return aHeld ? -1 : 1;
        return (a.label || '').localeCompare((b.label || ''), undefined, { sensitivity: 'base' });
      });
      const sheet = await this.actionSheetController.create({
        header: 'Place hold on which format?',
        buttons: [
          ...sorted.map((opt): ActionSheetButton => {
            if (opt.isOnHold) {
              return {
                text: `${opt.formatLabel || opt.label} On hold`,
                cssClass: 'action-sheet-disabled-option',
                handler: () => false,
              };
            }
            return {
              text: opt.label,
              handler: () => resolve(opt),
            };
          }),
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

  private async heldRecordIdsForGroupedWork(hit: AspenSearchHit): Promise<Set<string>> {
    const groupedKey = (hit?.key ?? '').toString().trim().toLowerCase();
    if (!groupedKey) return new Set<string>();

    try {
      const holds = await this.cachedHoldsForLookup();
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

  private async hasCachedHoldForGroupedWork(hit: AspenSearchHit): Promise<boolean> {
    const groupedKey = (hit?.key ?? '').toString().trim().toLowerCase();
    if (!groupedKey) return false;

    try {
      const holds = await this.cachedHoldsForLookup();
      return (holds ?? []).some((hold) => {
        const holdGrouped = (hold?.groupedWorkId ?? '').toString().trim().toLowerCase();
        return !!holdGrouped && holdGrouped === groupedKey;
      });
    } catch {
      return false;
    }
  }

  private async heldFormatKeysForGroupedWork(hit: AspenSearchHit): Promise<Set<string>> {
    const groupedKey = (hit?.key ?? '').toString().trim().toLowerCase();
    if (!groupedKey) return new Set<string>();

    try {
      const holds = await this.cachedHoldsForLookup();
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

  private normalizeFormatKey(value: string): string {
    return (value ?? '')
      .toString()
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  private async cachedHoldsForLookup(): Promise<any[]> {
    const snap = this.auth.snapshot();
    const activeId = (snap?.activeAccountId ?? '').toString().trim();
    if (!activeId) return [];

    try {
      const cached = await this.holds.getCachedHolds(activeId);
      return Array.isArray(cached?.holds) ? cached!.holds : [];
    } catch {
      return [];
    }
  }

  private cacheOptimisticPlacedHold(hit: AspenSearchHit, recordId: string, selectedFormatLabel?: string): void {
    const groupedKey = (hit?.key ?? '').toString().trim();
    if (!groupedKey) return;
    const snap = this.auth.snapshot();
    const activeId = (snap?.activeAccountId ?? '').toString().trim();
    if (!activeId) return;

    void (async () => {
      try {
        const cached = await this.holds.getCachedHolds(activeId);
        const current = Array.isArray(cached?.holds) ? cached!.holds : [];
        current.push({
          source: 'ils',
          type: 'ils',
          groupedWorkId: groupedKey,
          recordId: Number(recordId),
          format: selectedFormatLabel ? [selectedFormatLabel] : undefined,
        } as any);
        await this.holds.setCachedHolds(activeId, current);
      } catch {
        // ignore cache failures
      }
    })();
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

  private setRowBusy(recordKey: string, busy: boolean): void {
    const key = (recordKey ?? '').toString().trim();
    if (!key) return;
    this.actionBusyByKey = {
      ...this.actionBusyByKey,
      [key]: busy,
    };
  }

  private rowActionBusyForKey(recordKey: string): boolean {
    const key = (recordKey ?? '').toString().trim();
    return !!(key && this.actionBusyByKey[key]);
  }
}
