import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { IonicModule, ModalController, ActionSheetController, AlertController, type ActionSheetButton } from '@ionic/angular';
import { finalize } from 'rxjs';

import { Globals } from '../../globals';
import { ToastService } from '../../services/toast.service';
import { FeaturedService, type FeaturedRecord } from '../../services/featured.service';
import { ItemDetailComponent } from '../../components/item-detail/item-detail.component';
import type { AspenSearchHit } from '../../services/search.service';
import { ListsService, type AspenUserList } from '../../services/lists.service';
import { HoldsService } from '../../services/holds.service';
import { AuthService } from '../../services/auth.service';
import { FormatFamilyService } from '../../services/format-family.service';
import { ListLookupService } from '../../services/list-lookup.service';
import { SwitchUserModalComponent } from '../../components/switch-user-modal/switch-user-modal.component';
import { HoldSupportService, HoldTargetOption } from '../../services/hold-support.service';

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
    private alertCtrl: AlertController,
    private listsService: ListsService,
    private listLookup: ListLookupService,
    private holds: HoldsService,
    private auth: AuthService,
    private formatFamily: FormatFamilyService,
    private holdSupport: HoldSupportService,
    private router: Router,
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
        text: 'View Details',
        handler: () => this.openRecordDetails(hit),
      },
      { text: 'Close', role: 'cancel' },
    );

    if (this.auth.snapshot()?.isLoggedIn) {
      const hasLists = await this.canAddToList();
      buttons.splice(buttons.length - 2, 0, {
        text: hasLists ? 'Add to List' : 'New List',
        handler: () => this.addHitToList(hit),
      });
    }

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
    return this.formatFamily.iconNameForHit(hit);
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
    let lastListUsed: string | null = null;
    try {
      const lookup = await this.listLookup.lookup([]);
      lists = this.orderListsForAction(lookup.lists, lookup.lastListUsed);
      lastListUsed = lookup.lastListUsed;
    } catch {
      this.toast.presentToast('Could not load your lists.');
      return;
    }

    if (!lists.length) {
      await this.createListAndAddHit(hit);
      return;
    }

    if (lists.length === 1) {
      this.addRecordToNamedList(lists[0], hit);
      return;
    }

    const sheet = await this.actionSheetController.create({
      header: 'Add to which list?',
      subHeader: lastListUsed ? 'Most recently used list is shown first.' : undefined,
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
    const base = Number.isFinite(n) && n > 0 ? `${title} (${n})` : title;
    return base;
  }

  private addRecordToNamedList(list: AspenUserList, hit: AspenSearchHit): void {
    const listId = (list?.id ?? '').toString().trim();
    const recordId = (hit?.key ?? '').toString().trim();
    if (!listId || !recordId) return;
    if (this.rowActionBusyForKey(recordId)) return;
    if (this.listLookup.cachedMembershipsForRecord(recordId).some((m) => m.listId === listId)) {
      this.toast.presentToast('Already on this list.');
      return;
    }

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
          this.listLookup.upsertMembership(recordId, listId, listTitle);
          this.toast.presentToast(res?.message || 'Added to list.');
        },
        error: () => this.toast.presentToast('Could not add to list.'),
      });
  }

  private orderListsForAction(lists: AspenUserList[], lastListUsed: string | null): AspenUserList[] {
    const preferred = (lastListUsed ?? '').toString().trim();
    if (!preferred) return (lists ?? []).slice();

    return (lists ?? []).slice().sort((a, b) => {
      const aId = (a?.id ?? '').toString().trim();
      const bId = (b?.id ?? '').toString().trim();
      if (aId === preferred && bId !== preferred) return -1;
      if (bId === preferred && aId !== preferred) return 1;
      return 0;
    });
  }

  private async canAddToList(): Promise<boolean> {
    try {
      return await this.listLookup.hasLists();
    } catch {
      return false;
    }
  }

  private async createListAndAddHit(hit: AspenSearchHit): Promise<void> {
    const basics = await this.promptListBasics('Create List');
    if (!basics) return;

    const isPublic = await this.promptVisibility(false);
    if (isPublic === null) return;

    const key = (hit?.key ?? '').toString().trim();
    if (this.rowActionBusyForKey(key)) return;

    this.setRowBusy(key, true);
    this.listsService.createList(basics.title, basics.description, isPublic)
      .pipe(finalize(() => this.setRowBusy(key, false)))
      .subscribe({
        next: (res) => {
          if (!res?.success || !res?.listId) {
            this.toast.presentToast(res?.message || 'Could not create list.');
            return;
          }

          const createdList: AspenUserList = {
            id: res.listId,
            title: res.listTitle || basics.title,
            description: basics.description,
            public: isPublic,
            numTitles: 0,
          };
          this.listLookup.replaceLists([createdList]);
          this.addRecordToNamedList(createdList, hit);
        },
        error: () => this.toast.presentToast('Could not create list.'),
      });
  }

  private async promptListBasics(
    header: string,
    initialTitle = '',
    initialDescription = '',
  ): Promise<{ title: string; description: string } | null> {
    return new Promise(async (resolve) => {
      const alert = await this.alertCtrl.create({
        header,
        inputs: [
          {
            name: 'title',
            type: 'text',
            placeholder: 'List title',
            value: initialTitle,
          },
          {
            name: 'description',
            type: 'textarea',
            placeholder: 'Description (optional)',
            value: initialDescription,
          },
        ],
        buttons: [
          { text: 'Cancel', role: 'cancel', handler: () => resolve(null) },
          {
            text: 'Continue',
            handler: (data) => {
              const title = (data?.title ?? '').toString().trim();
              const description = (data?.description ?? '').toString().trim();
              if (!title) {
                this.toast.presentToast('List title is required.');
                return false;
              }
              resolve({ title, description });
              return true;
            },
          },
        ],
      });
      await alert.present();
    });
  }

  private async promptVisibility(initialPublic: boolean): Promise<boolean | null> {
    return new Promise(async (resolve) => {
      const alert = await this.alertCtrl.create({
        header: 'List Visibility',
        message: 'Choose whether this list is private or public.',
        inputs: [
          {
            type: 'radio',
            label: 'Private',
            value: 'private',
            checked: !initialPublic,
          },
          {
            type: 'radio',
            label: 'Public',
            value: 'public',
            checked: initialPublic,
          },
        ],
        buttons: [
          { text: 'Cancel', role: 'cancel', handler: () => resolve(null) },
          {
            text: 'Save',
            handler: (value) => {
              resolve((value ?? 'private').toString() === 'public');
              return true;
            },
          },
        ],
      });
      await alert.present();
    });
  }

  private async placeHoldFromHit(hit: AspenSearchHit, precomputedTargets?: HoldTargetOption[]): Promise<void> {
    const loggedIn = await this.ensureLoggedInForHoldAction();
    if (!loggedIn) return;
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

    const defaultPickup = await this.holdSupport.defaultPickupBranchCode();
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

  private async ensureLoggedInForHoldAction(): Promise<boolean> {
    const snap = this.auth.snapshot();
    if (snap?.isLoggedIn && snap?.activeAccountId && snap?.activeAccountMeta) return true;

    const priorModalState = this.globals.modal_open;
    const modal = await this.modalCtrl.create({
      component: SwitchUserModalComponent,
    });
    this.globals.modal_open = true;
    await modal.present();
    await modal.onDidDismiss();
    this.globals.modal_open = priorModalState || this.globals.modal_open;

    const next = this.auth.snapshot();
    return !!(next?.isLoggedIn && next?.activeAccountId && next?.activeAccountMeta);
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
          void this.holdSupport.cacheOptimisticPlacedHold({
            groupedKey: hit.key,
            itemList: hit.itemList,
            rawItemList: (hit.raw as any)?.itemList,
            title: hit.title,
            author: hit.author,
            coverUrl: hit.coverUrl,
          }, recordId, selectedFormatLabel);
          if (selectedFormatLabel) {
            void this.toast.presentHoldPlacedToast(`Hold placed on format ${selectedFormatLabel}.`, () => {
              void this.router.navigate(['/holds']);
            });
            return;
          }
          void this.toast.presentHoldPlacedToast(res?.message || 'Hold placed.', () => {
            void this.router.navigate(['/holds']);
          });
        },
        error: () => this.toast.presentToast('Could not place hold.'),
      });
  }

  private async holdTargetsWithStatusForHit(hit: AspenSearchHit): Promise<HoldTargetOption[]> {
    if (!this.canPlaceHoldFromHit(hit)) return [];
    return this.holdSupport.holdTargetsWithStatus({
      groupedKey: hit.key,
      itemList: hit.itemList,
      rawItemList: (hit.raw as any)?.itemList,
      title: hit.title,
      author: hit.author,
      coverUrl: hit.coverUrl,
    });
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

  private async hasCachedHoldForGroupedWork(hit: AspenSearchHit): Promise<boolean> {
    return this.holdSupport.hasCachedHoldForGroupedKey(hit.key);
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
