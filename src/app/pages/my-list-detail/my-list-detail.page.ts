import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { IonicModule, ModalController, ActionSheetController, AlertController, type ActionSheetButton } from '@ionic/angular';
import { finalize } from 'rxjs';
import { lastValueFrom } from 'rxjs';

import { Globals } from '../../globals';
import { ToastService } from '../../services/toast.service';
import { ListsService, type AspenListTitle } from '../../services/lists.service';
import { ItemDetailComponent } from '../../components/item-detail/item-detail.component';
import { AspenSearchHit } from '../../services/search.service';
import { AuthService } from '../../services/auth.service';
import { ItemService } from '../../services/item.service';
import { HoldsService } from '../../services/holds.service';
import { AccountPreferencesService } from '../../services/account-preferences.service';
import { FormatFamilyService } from '../../services/format-family.service';
import { ListLookupService } from '../../services/list-lookup.service';

interface HoldTargetOption {
  recordId: string;
  label: string;
  formatLabel: string;
  isOnHold?: boolean;
}

@Component({
  standalone: true,
  selector: 'app-my-list-detail',
  templateUrl: './my-list-detail.page.html',
  styleUrls: ['./my-list-detail.page.scss'],
  imports: [CommonModule, IonicModule],
})
export class MyListDetailPage {
  loading = false;
  loadingMore = false;
  listId = '';
  listTitle = 'List';
  listDescription = '';
  titles: AspenListTitle[] = [];
  page = 1;
  pageSize = 50;
  totalPages = 1;
  infiniteDisabled = true;
  removingRecordId = '';
  actionRecordId = '';
  canEditList = false;
  mutatingList = false;

  constructor(
    public globals: Globals,
    private route: ActivatedRoute,
    private listsService: ListsService,
    private toast: ToastService,
    private modalController: ModalController,
    private actionSheetCtrl: ActionSheetController,
    private alertCtrl: AlertController,
    private router: Router,
    private listLookup: ListLookupService,
    private auth: AuthService,
    private itemService: ItemService,
    private holds: HoldsService,
    private accountPreferences: AccountPreferencesService,
    private formatFamily: FormatFamilyService,
  ) {}

  ionViewWillEnter() {
    this.listId = (this.route.snapshot.paramMap.get('id') ?? '').trim();
    const hint = (this.route.snapshot.queryParamMap.get('title') ?? '').trim();
    if (hint) this.listTitle = hint;
    void this.refreshOwnership();
    this.refresh();
  }

  refresh(ev?: any) {
    if (this.loading || this.loadingMore) {
      ev?.target?.complete?.();
      return;
    }
    if (!this.listId) {
      this.toast.presentToast('Invalid list id.');
      ev?.target?.complete?.();
      return;
    }

    this.page = 1;
    this.totalPages = 1;
    this.infiniteDisabled = true;
    this.loading = true;
    this.listsService.fetchListTitles(this.listId, this.page, this.pageSize).pipe(
      finalize(() => {
        this.loading = false;
        ev?.target?.complete?.();
      }),
    ).subscribe({
      next: (res) => {
        if (!res?.success) {
          this.titles = [];
          this.toast.presentToast(res?.message || 'Could not load this list.');
          return;
        }

        this.listTitle = (res?.listTitle ?? '').toString().trim() || this.listTitle;
        this.listDescription = (res?.listDescription ?? '').toString().trim();
        this.titles = Array.isArray(res?.titles) ? res.titles : [];
        this.listLookup.observeListPage(this.listId, this.listTitle, this.titles);
        this.page = Number(res?.page_current ?? 1) || 1;
        this.totalPages = Number(res?.page_total ?? 1) || 1;
        this.infiniteDisabled = !(this.page < this.totalPages);
      },
      error: () => {
        this.titles = [];
        this.infiniteDisabled = true;
        this.toast.presentToast('Could not load this list.');
      },
    });
  }

  loadMore(ev: any) {
    if (this.loading || this.loadingMore || this.infiniteDisabled) {
      ev?.target?.complete?.();
      return;
    }
    if (!this.listId) {
      this.infiniteDisabled = true;
      ev?.target?.complete?.();
      return;
    }
    if (this.page >= this.totalPages) {
      this.infiniteDisabled = true;
      ev?.target?.complete?.();
      return;
    }

    const nextPage = this.page + 1;
    this.loadingMore = true;
    this.listsService.fetchListTitles(this.listId, nextPage, this.pageSize).pipe(
      finalize(() => {
        this.loadingMore = false;
        ev?.target?.complete?.();
      }),
    ).subscribe({
      next: (res) => {
        if (!res?.success) {
          this.toast.presentToast(res?.message || 'Could not load more list titles.');
          return;
        }

        const nextTitles = Array.isArray(res?.titles) ? res.titles : [];
        if (nextTitles.length) {
          const seen = new Set(this.titles.map((x) => this.recordIdForEntry(x)));
          const deduped = nextTitles.filter((x) => {
            const id = this.recordIdForEntry(x);
            if (!id || seen.has(id)) return false;
            seen.add(id);
            return true;
          });
          this.titles = [...this.titles, ...deduped];
          this.listLookup.observeListPage(this.listId, this.listTitle, deduped);
        }

        this.page = Number(res?.page_current ?? nextPage) || nextPage;
        this.totalPages = Number(res?.page_total ?? this.totalPages) || this.totalPages;
        this.infiniteDisabled = !(this.page < this.totalPages);
      },
      error: () => this.toast.presentToast('Could not load more list titles.'),
    });
  }

  titleText(t: AspenListTitle): string {
    return (t?.title ?? '').toString().trim() || 'Untitled';
  }

  authorText(t: AspenListTitle): string {
    return (t?.author ?? '').toString().trim();
  }

  coverUrl(t: AspenListTitle): string {
    const raw = (t?.image ?? t?.small_image ?? '').toString().trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith('//')) return `https:${raw}`;
    if (raw.startsWith('/')) return `${this.globals.aspen_discovery_base}${raw}`;
    return `${this.globals.aspen_discovery_base}/${raw}`;
  }

  async openTitle(t: AspenListTitle) {
    const recordType = (t?.recordType ?? '').toString().trim().toLowerCase();
    const url = (t?.['url'] ?? t?.titleURL ?? '').toString().trim();
    if (recordType === 'event' && url) {
      await this.globals.open_page(url);
      return;
    }

    const key = (t?.id ?? '').toString().trim();
    if (!key) {
      this.toast.presentToast('This list entry cannot be opened in-app yet.');
      return;
    }

    const hit: AspenSearchHit = {
      key,
      title: this.titleText(t),
      author: this.authorText(t) || undefined,
      coverUrl: (t?.image ?? '').toString().trim() || undefined,
      summary: (t?.description ?? '').toString().trim() || undefined,
      language: (t?.language ?? '').toString().trim() || undefined,
      format: t?.format,
      itemList: [],
      catalogUrl: `${this.globals.aspen_discovery_base}/GroupedWork/${encodeURIComponent(key)}`,
      raw: t,
    };

    const modal = await this.modalController.create({
      component: ItemDetailComponent,
      componentProps: {
        hit,
        listContext: {
          listId: this.listId,
          listTitle: this.listTitle,
          recordId: key,
          canEdit: this.canEditList,
        },
      },
    });
    this.globals.modal_open = true;
    modal.onDidDismiss().then((res) => {
      if (res?.data?.refreshList) this.refresh();
    });
    await modal.present();
  }

  async openTitleActions(t: AspenListTitle, ev?: Event) {
    ev?.stopPropagation();

    const buttons: ActionSheetButton[] = [];
    if (this.auth.snapshot()?.isLoggedIn && this.canPlaceHoldFromTitle(t)) {
      const groupedKey = this.recordIdForEntry(t);
      const hasCachedHold = await this.hasCachedHoldForGroupedKey(groupedKey);
      if (hasCachedHold) {
        buttons.push({
          text: 'On hold',
          cssClass: 'action-sheet-disabled-option',
          handler: () => false,
        });
      } else {
        buttons.push({
          text: 'Place Hold',
          handler: () => this.placeHoldFromTitle(t),
        });
      }
    }
    buttons.push({
      text: 'Open Details',
      handler: () => this.openTitle(t),
    });
    if (this.canEditList) {
      buttons.push({
        text: 'Remove from List',
        role: 'destructive',
        handler: () => this.confirmRemoveFromList(t),
      });
    }
    buttons.push({ text: 'Close', role: 'cancel' });

    const sheet = await this.actionSheetCtrl.create({
      header: this.titleText(t),
      buttons,
    });

    await sheet.present();
  }

  removeBusyFor(t: AspenListTitle): boolean {
    return this.removingRecordId !== '' && this.removingRecordId === this.recordIdForEntry(t);
  }

  rowActionBusyFor(t: AspenListTitle): boolean {
    const id = this.recordIdForEntry(t);
    if (!id) return false;
    return this.removingRecordId === id || this.actionRecordId === id;
  }

  private recordIdForEntry(t: AspenListTitle): string {
    const id = (t?.id ?? t?.shortId ?? '').toString().trim();
    return id;
  }

  private canPlaceHoldFromTitle(t: AspenListTitle): boolean {
    const recordType = (t?.recordType ?? '').toString().trim().toLowerCase();
    if (recordType === 'event') return false;
    const groupedKey = this.recordIdForEntry(t);
    return !!groupedKey;
  }

  mediaIconNameForTitle(t: AspenListTitle): string {
    const hit: AspenSearchHit = {
      key: this.recordIdForEntry(t),
      title: this.titleText(t),
      author: this.authorText(t) || undefined,
      format: t?.format,
      itemList: [],
      catalogUrl: '',
      raw: t,
    };

    const family = this.formatFamily.primaryFamilyForHit(hit);
    if (family === 'book') return 'book-outline';
    if (family === 'music') return 'disc-outline';
    if (family === 'video') return 'videocam-outline';
    return 'albums-outline';
  }

  private async placeHoldFromTitle(t: AspenListTitle, precomputedTargets?: HoldTargetOption[]): Promise<void> {
    const groupedKey = this.recordIdForEntry(t);
    if (!groupedKey) {
      this.toast.presentToast('Could not determine holdable record id. Open details to place hold.');
      return;
    }
    if (!this.auth.snapshot()?.isLoggedIn) {
      this.toast.presentToast('Log in to place holds.');
      return;
    }
    if (this.rowActionBusyFor(t)) return;

    const holdTargets = precomputedTargets ?? await this.holdTargetsWithStatusForTitle(t);
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
      this.placeHoldNowForTitle(t, selectedTarget.recordId, defaultPickup, selectedTarget.formatLabel || selectedTarget.label);
      return;
    }

    const buttons: ActionSheetButton[] = this.globals.pickupLocations.map((loc) => ({
      text: loc.name,
      handler: () => this.placeHoldNowForTitle(t, selectedTarget.recordId, loc.code, selectedTarget.formatLabel || selectedTarget.label),
    }));
    buttons.push({ text: 'Close', role: 'cancel' });

    const sheet = await this.actionSheetCtrl.create({
      header: 'Pick up where?',
      buttons,
    });
    await sheet.present();
  }

  private placeHoldNowForTitle(
    t: AspenListTitle,
    recordId: string,
    pickupBranch: string,
    selectedFormatLabel?: string,
  ): void {
    const groupedKey = this.recordIdForEntry(t);
    if (!groupedKey || this.rowActionBusyFor(t)) return;

    this.actionRecordId = groupedKey;
    this.holds.placeHold(recordId, pickupBranch, null)
      .pipe(finalize(() => { this.actionRecordId = ''; }))
      .subscribe({
        next: (res) => {
          if (!res?.success) {
            this.toast.presentToast(res?.message || 'Could not place hold.');
            return;
          }
          this.auth.adjustActiveProfileCounts({ holds: 1, holdsRequested: 1 });
          this.cacheOptimisticPlacedHoldForTitle(t, recordId, selectedFormatLabel);
          if (selectedFormatLabel) {
            this.toast.presentToast(`Hold placed on format ${selectedFormatLabel}.`);
            return;
          }
          this.toast.presentToast(res?.message || 'Hold placed.');
        },
        error: () => this.toast.presentToast('Could not place hold.'),
      });
  }

  private async holdTargetsWithStatusForTitle(t: AspenListTitle): Promise<HoldTargetOption[]> {
    if (!this.canPlaceHoldFromTitle(t)) return [];

    const groupedKey = this.recordIdForEntry(t);
    if (!groupedKey) return [];

    const holdTargets = await this.resolveIlsHoldTargetsForTitle(t);
    if (!holdTargets.length) return [];
    if (!this.auth.snapshot()?.isLoggedIn) return holdTargets;

    const heldRecordIds = await this.heldRecordIdsForGroupedKey(groupedKey);
    const heldFormatKeys = await this.heldFormatKeysForGroupedKey(groupedKey);

    return holdTargets.map((target) => {
      const isOnHold =
        heldRecordIds.has(target.recordId) ||
        heldFormatKeys.has(this.normalizeFormatKey(target.formatLabel));
      return { ...target, isOnHold };
    });
  }

  private async resolveIlsHoldTargetsForTitle(t: AspenListTitle): Promise<HoldTargetOption[]> {
    const groupedKey = this.recordIdForEntry(t);
    if (!groupedKey) return [];

    try {
      const work = await lastValueFrom(this.itemService.getGroupedWork(groupedKey));
      const physicalById = new Map<string, HoldTargetOption>();
      const anyById = new Map<string, HoldTargetOption>();

      for (const [formatKey, fmt] of Object.entries(work?.formats ?? {})) {
        const formatLabel =
          (fmt?.label ?? '').toString().trim() ||
          (formatKey ?? '').toString().trim() ||
          'Format';

        for (const action of fmt?.actions ?? []) {
          const id = this.itemService.extractIlsIdFromOnclick((action as any)?.onclick);
          if (!id) continue;

          const actionTitle = ((action as any)?.title ?? '').toString().trim();
          const isPlaceHold = actionTitle.toLowerCase() === 'place hold';
          const label = actionTitle && !isPlaceHold ? `${formatLabel} (${actionTitle})` : formatLabel;
          const target: HoldTargetOption = { recordId: id, label, formatLabel };

          if (!anyById.has(id)) anyById.set(id, target);
          if (isPlaceHold && !physicalById.has(id)) physicalById.set(id, target);
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
      const sorted = [...options].sort((a, b) => {
        const aHeld = !!a.isOnHold;
        const bHeld = !!b.isOnHold;
        if (aHeld !== bHeld) return aHeld ? -1 : 1;
        return (a.label || '').localeCompare((b.label || ''), undefined, { sensitivity: 'base' });
      });
      const sheet = await this.actionSheetCtrl.create({
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

  private async heldRecordIdsForGroupedKey(groupedKey: string): Promise<Set<string>> {
    const normalized = (groupedKey ?? '').toString().trim().toLowerCase();
    if (!normalized) return new Set<string>();

    try {
      const holds = await this.cachedHoldsForLookup();
      const ids = new Set<string>();
      for (const hold of holds ?? []) {
        const holdGrouped = (hold?.groupedWorkId ?? '').toString().trim().toLowerCase();
        if (!holdGrouped || holdGrouped !== normalized) continue;
        const rid = (hold?.recordId ?? '').toString().trim();
        if (rid) ids.add(rid);
      }
      return ids;
    } catch {
      return new Set<string>();
    }
  }

  private async hasCachedHoldForGroupedKey(groupedKey: string): Promise<boolean> {
    const normalized = (groupedKey ?? '').toString().trim().toLowerCase();
    if (!normalized) return false;

    try {
      const holds = await this.cachedHoldsForLookup();
      return (holds ?? []).some((hold) => {
        const holdGrouped = (hold?.groupedWorkId ?? '').toString().trim().toLowerCase();
        return !!holdGrouped && holdGrouped === normalized;
      });
    } catch {
      return false;
    }
  }

  private async heldFormatKeysForGroupedKey(groupedKey: string): Promise<Set<string>> {
    const normalized = (groupedKey ?? '').toString().trim().toLowerCase();
    if (!normalized) return new Set<string>();

    try {
      const holds = await this.cachedHoldsForLookup();
      const keys = new Set<string>();
      for (const hold of holds ?? []) {
        const holdGrouped = (hold?.groupedWorkId ?? '').toString().trim().toLowerCase();
        if (!holdGrouped || holdGrouped !== normalized) continue;

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

  private cacheOptimisticPlacedHoldForTitle(
    t: AspenListTitle,
    recordId: string,
    selectedFormatLabel?: string,
  ): void {
    const groupedKey = this.recordIdForEntry(t);
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

  private async confirmRemoveFromList(t: AspenListTitle) {
    if (!this.canEditList) {
      this.toast.presentToast('You can only edit lists that you own.');
      return;
    }
    if (this.mutatingBlockedForRemove(t)) return;

    const confirmSheet = await this.actionSheetCtrl.create({
      header: 'Remove from list?',
      subHeader: this.titleText(t),
      buttons: [
        {
          text: 'Remove',
          role: 'destructive',
          handler: () => this.removeFromListNow(t),
        },
        {
          text: 'Close', role: 'cancel',
        },
      ],
    });

    await confirmSheet.present();
  }

  private mutatingBlockedForRemove(t: AspenListTitle): boolean {
    return this.removeBusyFor(t);
  }

  private removeFromListNow(t: AspenListTitle) {
    if (!this.canEditList) {
      this.toast.presentToast('You can only edit lists that you own.');
      return;
    }
    const recordId = this.recordIdForEntry(t);
    if (!recordId) {
      this.toast.presentToast('This title cannot be removed (missing record id).');
      return;
    }
    if (!this.listId) {
      this.toast.presentToast('This list is missing an id.');
      return;
    }

    this.removingRecordId = recordId;
    this.listsService.removeTitlesFromList(this.listId, [recordId])
      .pipe(finalize(() => { this.removingRecordId = ''; }))
      .subscribe({
        next: (res) => {
          if (!res?.success) {
            this.toast.presentToast(res?.message || 'Could not remove title from list.');
            return;
          }

          this.titles = this.titles.filter(x => this.recordIdForEntry(x) !== recordId);
          this.listLookup.removeMembership(recordId, this.listId);
          this.toast.presentToast(res?.message || 'Removed from list.');
        },
        error: () => this.toast.presentToast('Could not remove title from list.'),
      });
  }

  trackByTitle(_idx: number, t: AspenListTitle): string {
    const id = (t?.id ?? '').toString().trim();
    return id || `${_idx}`;
  }

  async editListMeta() {
    if (!this.canEditList || this.mutatingList || !this.listId) return;

    const alert = await this.alertCtrl.create({
      header: 'Edit List',
      inputs: [
        {
          name: 'title',
          type: 'text',
          placeholder: 'List name',
          value: this.listTitle,
          attributes: {
            autocapitalize: 'sentences',
            autocorrect: 'on',
            autocomplete: 'off',
            maxlength: 120,
          },
        },
        {
          name: 'description',
          type: 'textarea',
          placeholder: 'Description (optional)',
          value: this.listDescription,
          attributes: {
            autocapitalize: 'sentences',
            autocorrect: 'on',
            autocomplete: 'off',
            maxlength: 1000,
          },
        },
      ],
      buttons: [
        { text: 'Close', role: 'cancel' },
        {
          text: 'Save',
          role: 'confirm',
          handler: (v) => {
            const title = (v?.title ?? '').toString().trim();
            const description = (v?.description ?? '').toString().trim();
            if (!title) {
              this.toast.presentToast('List name is required.');
              return false;
            }
            this.saveListMeta(title, description);
            return true;
          },
        },
      ],
    });

    await alert.present();
  }

  async confirmDeleteList() {
    if (!this.canEditList || this.mutatingList || !this.listId) return;

    const count = this.titles.length;
    const itemText = `${count} item${count === 1 ? '' : 's'}`;
    const alert = await this.alertCtrl.create({
      header: 'Delete list?',
      subHeader: this.listTitle || 'List',
      message: count > 0
        ? `THIS LIST HAS ${itemText.toUpperCase()} IN IT. ARE YOU SURE?\n\nThis cannot be undone.`
        : 'This cannot be undone.',
      buttons: [
        { text: 'Close', role: 'cancel' },
        {
          text: 'Delete List',
          role: 'destructive',
          handler: () => this.deleteListNow(),
        },
      ],
    });

    await alert.present();
  }

  private saveListMeta(title: string, description: string) {
    if (!this.listId || this.mutatingList) return;

    this.mutatingList = true;
    this.listsService.editList(this.listId, { title, description })
      .pipe(finalize(() => { this.mutatingList = false; }))
      .subscribe({
        next: (res) => {
          if (!res?.success) {
            this.toast.presentToast(res?.message || 'Could not update list.');
            return;
          }

          this.listTitle = title;
          this.listDescription = description;
          this.listLookup.renameList(this.listId, title);
          this.toast.presentToast(res?.message || 'List updated.');
        },
        error: () => this.toast.presentToast('Could not update list.'),
      });
  }

  private deleteListNow() {
    if (!this.listId || this.mutatingList) return;

    const listId = this.listId;
    this.mutatingList = true;
    this.listsService.deleteList(listId)
      .pipe(finalize(() => { this.mutatingList = false; }))
      .subscribe({
        next: (res) => {
          if (!res?.success) {
            this.toast.presentToast(res?.message || 'Could not delete list.');
            return;
          }

          this.listLookup.removeList(listId);
          this.toast.presentToast(res?.message || 'List deleted.');
          this.router.navigate(['/my-lists']);
        },
        error: () => this.toast.presentToast('Could not delete list.'),
      });
  }

  private async refreshOwnership(): Promise<void> {
    if (!this.listId) {
      this.canEditList = false;
      return;
    }

    try {
      const userLists = await lastValueFrom(this.listsService.fetchUserLists());
      const ownedIds = new Set(
        (userLists ?? [])
          .map((x) => (x?.id ?? '').toString().trim())
          .filter((x) => !!x),
      );
      this.canEditList = ownedIds.has(this.listId);
    } catch {
      this.canEditList = false;
    }
  }
}
