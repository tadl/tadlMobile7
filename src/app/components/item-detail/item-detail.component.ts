import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { CommonModule, KeyValue } from '@angular/common';
import {
  IonicModule,
  ActionSheetController,
  AlertController,
  ModalController,
  type ActionSheetButton,
} from '@ionic/angular';
import { Router } from '@angular/router';
import { Subscription, forkJoin, of } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';
import { lastValueFrom } from 'rxjs';

import { Globals } from '../../globals';
import { ToastService } from '../../services/toast.service';
import {
  ItemService,
  AspenGroupedWork,
  AspenFormatVariationsResult,
} from '../../services/item.service';
import { AspenSearchHit } from '../../services/search.service';
import { HoldsService } from '../../services/holds.service';
import type { AspenHold } from '../../services/holds.service';
import { CheckoutsService } from '../../services/checkouts.service';
import type { AspenCheckout } from '../../services/checkouts.service';
import { ListsService, type AspenUserList } from '../../services/lists.service';
import { AuthService } from '../../services/auth.service';
import { CopyDetailsPopoverComponent } from '../copy-details-popover/copy-details-popover.component';
import { AccountPreferencesService } from '../../services/account-preferences.service';
import { ListLookupService } from '../../services/list-lookup.service';
import { SwitchUserModalComponent } from '../switch-user-modal/switch-user-modal.component';

interface ItemDetailListContext {
  listId: string;
  listTitle?: string;
  recordId?: string;
  canEdit?: boolean;
}

interface KnownListMembership {
  listId: string;
  listTitle: string;
}

interface FormatProviderStatus {
  providerLabel: string;
  source: string;
  groupedStatus: string;
  numCopiesMessage: string;
  isAvailable: boolean;
}

interface FormatProviderAction {
  title: string;
  url: string;
  source: string;
}

interface FormatShelfDetail {
  location: string;
  callNumber: string;
  status: string;
  availability: boolean | null;
}

interface DetailFact {
  label: string;
  value: string;
}

@Component({
  standalone: true,
  selector: 'app-item-detail',
  templateUrl: './item-detail.component.html',
  styleUrls: ['./item-detail.component.scss'],
  imports: [CommonModule, IonicModule],
})
export class ItemDetailComponent implements OnInit, OnDestroy {
  @Input() hit!: AspenSearchHit;
  @Input() listContext: ItemDetailListContext | null = null;

  work: AspenGroupedWork | null = null;
  displayCoverUrl = '';

  /** if we got here from HoldsPage, it passes the hold as hit.raw */
  hold: AspenHold | null = null;
  holdsForItem: AspenHold[] = [];

  /** if we got here from CheckoutsPage, it passes the checkout as hit.raw */
  checkout: AspenCheckout | null = null;
  knownListMemberships: KnownListMembership[] = [];

  /** format label -> holdings count */
  private holdingsCountByFormat: Record<string, number> = {};
  private holdingsDetailsByFormat: Record<string, FormatShelfDetail[]> = {};
  private providerStatusesByFormat: Record<string, FormatProviderStatus[]> = {};
  private providerActionsByFormat: Record<string, FormatProviderAction[]> = {};
  private loadedWorkId: string | null = null;
  private requestedHoldings = new Set<string>();
  private requestedVariations = new Set<string>();
  private copyDetailsModalOpen = false;
  private readonly descriptionPreviewChars = 320;
  descriptionExpanded = false;
  private authStateSub?: Subscription;
  private listsHydrated = false;
  private listsAccountId: string | null = null;

  holdActionBusy = false;
  checkoutActionBusy = false;
  listActionBusy = false;
  availableLists: AspenUserList[] = [];
  private ownedListIds = new Set<string>();
  private ownedListIdsLoaded = false;

  /** set to true when we mutate holds so HoldsPage can refresh on dismiss */
  private needsHoldsRefresh = false;

  /** set to true when we mutate checkouts so CheckoutsPage can refresh on dismiss */
  private needsCheckoutsRefresh = false;
  /** set to true when we mutate list membership so MyListDetail can refresh on dismiss */
  private needsListRefresh = false;

  /** prevents overlapping hold-refresh calls */
  private holdRefreshBusy = false;

  /** prevents overlapping checkout-refresh calls */
  private checkoutRefreshBusy = false;

  constructor(
    public globals: Globals,
    private toast: ToastService,
    private auth: AuthService,
    private items: ItemService,
    private holds: HoldsService,
    private checkouts: CheckoutsService,
    private lists: ListsService,
    private listLookup: ListLookupService,
    private accountPreferences: AccountPreferencesService,
    private router: Router,
    private modalCtrl: ModalController, // ✅ renamed from "modal"
    private actionSheet: ActionSheetController,
    private alertCtrl: AlertController,
  ) {}

  ngOnInit() {
    // If opened from Holds/Checkouts pages, we already have the object in hit.raw
    this.hold = this.extractHoldFromHit(this.hit);
    this.holdsForItem = this.hold ? [this.hold] : [];
    this.checkout = this.extractCheckoutFromHit(this.hit);
    void this.refreshAvailableLists();
    void this.seedKnownListMemberships();
    this.authStateSub = this.auth.authState().subscribe((state) => {
      const accountId = state?.isLoggedIn ? (state?.activeAccountId ?? '').toString().trim() || null : null;
      if (!accountId) {
        this.availableLists = [];
        this.listsHydrated = false;
        this.listsAccountId = null;
        return;
      }

      if (accountId !== this.listsAccountId || !this.listsHydrated) {
        this.listsAccountId = accountId;
        void this.refreshAvailableLists();
      }
    });

    const key = (this.hit?.key ?? '').toString().trim();
    this.displayCoverUrl = this.normalizeCoverUrl(this.hit?.coverUrl);
    if (!key) return;

    this.items.getGroupedWork(key).subscribe({
      next: (w) => {
        this.work = w ?? null;
        if (!this.displayCoverUrl) {
          this.displayCoverUrl = this.normalizeCoverUrl(this.work?.cover);
        }
        this.descriptionExpanded = false;
        this.prepareWorkLoadState(this.work);
        this.loadHoldingsCountsForWork(this.work);
        this.loadProviderStatusesForWork(this.work);

        // Attach hold/checkout for this grouped work so cards appear even when opened from Search
        this.refreshHoldForThisItem();
        this.refreshCheckoutForThisItem();
      },
      error: () => this.toast.presentToast('Could not load item details.'),
    });
  }

  ngOnDestroy() {
    this.authStateSub?.unsubscribe();
  }

  close() {
    this.copyDetailsModalOpen = false;
    this.modalCtrl.dismiss(this.dismissPayload());
    this.globals.modal_open = false;
  }

  openCatalog() {
    if (this.hit?.catalogUrl) this.globals.open_page(this.hit.catalogUrl);
  }

  itemDisplayTitle(): string {
    const title =
      this.cleanTitlePart(this.work?.title) ||
      this.cleanTitlePart(this.hit?.title) ||
      'Untitled';

    const subtitle =
      this.cleanTitlePart((this.work as any)?.subtitle) ||
      this.cleanTitlePart((this.hit as any)?.subtitle) ||
      this.cleanTitlePart((this.hit?.raw as any)?.subtitle);

    if (!subtitle) return title;
    return `${title}: ${subtitle}`;
  }

  detailFacts(): DetailFact[] {
    const facts: DetailFact[] = [];

    const year = this.publicationYearText();
    if (year) facts.push({ label: 'Published', value: year });

    const language = this.languageText();
    if (language) facts.push({ label: 'Language', value: language });

    const series = this.seriesText();
    if (series) facts.push({ label: 'Series', value: series });

    return facts;
  }

  itemDescriptionText(): string {
    const raw =
      this.work?.description ??
      (this.work as any)?.abstract ??
      (this.work as any)?.contents ??
      this.hit?.summary ??
      '';

    return this.normalizeDescriptionText(raw);
  }

  descriptionCanExpand(text: string): boolean {
    return text.length > this.descriptionPreviewChars;
  }

  itemDescriptionPreview(text: string): string {
    if (!this.descriptionCanExpand(text)) return text;

    const cut = text.slice(0, this.descriptionPreviewChars);
    const lastSpace = cut.lastIndexOf(' ');
    if (lastSpace >= this.descriptionPreviewChars * 0.65) {
      return cut.slice(0, lastSpace).trim();
    }
    return cut.trim();
  }

  toggleDescription() {
    this.descriptionExpanded = !this.descriptionExpanded;
  }

  // ----------------------------
  // List context helpers/actions
  // ----------------------------

  canManageLists(): boolean {
    return !!this.listRecordId() && this.auth.snapshot()?.isLoggedIn === true;
  }

  listPrimaryActionLabel(): string {
    return this.availableLists.length === 0 ? 'New list' : 'Add to list';
  }

  hasKnownListMembership(): boolean {
    return this.knownListMemberships.length > 0;
  }

  listMembershipLabel(): string {
    return this.knownListMemberships.length > 1 ? 'In lists:' : 'In list:';
  }

  async openKnownList(listId: string, listTitle: string) {
    if (!listId) return;

    await this.modalCtrl.dismiss();
    this.globals.modal_open = false;
    this.router.navigate(['/my-lists', listId], {
      queryParams: { title: listTitle },
    });
  }

  async openHoldsPage() {
    await this.modalCtrl.dismiss(this.dismissPayload());
    this.globals.modal_open = false;
    await this.router.navigate(['/holds']);
  }

  async addToAnyList() {
    if (this.listActionBusy || !this.canManageLists()) return;
    const recordId = this.listRecordId();
    if (!recordId) return;

    const lists = await this.getListsForAction();
    if (!lists.length) {
      await this.createListAndAddRecord(recordId);
      return;
    }

    if (lists.length === 1) {
      this.addRecordToList(lists[0], recordId);
      return;
    }

    const sheet = await this.actionSheet.create({
      header: 'Add to which list?',
      buttons: [
        ...lists.map((list): ActionSheetButton => ({
          text: this.actionListLabel(list),
          handler: () => this.addRecordToList(list, recordId),
        })),
        { text: 'Close', role: 'cancel' },
      ],
    });

    await sheet.present();
  }

  async removeFromAnyList() {
    if (this.listActionBusy || !this.canManageLists()) return;
    const recordId = this.listRecordId();
    if (!recordId) return;

    const lists = await this.getListsForAction();
    if (!lists.length) return;

    const pickSheet = await this.actionSheet.create({
      header: 'Remove from which list?',
      buttons: [
        ...lists.map((list): ActionSheetButton => ({
          text: this.actionListLabel(list),
          role: 'destructive',
          handler: () => this.confirmRemoveFromNamedList(list, recordId),
        })),
        { text: 'Close', role: 'cancel' },
      ],
    });

    await pickSheet.present();
  }

  private listRecordId(): string {
    const fromCtx = (this.listContext?.recordId ?? '').toString().trim();
    if (fromCtx) return fromCtx;
    return (this.hit?.key ?? '').toString().trim();
  }

  private async getListsForAction(): Promise<AspenUserList[]> {
    const loggedIn = await this.ensureLoggedInForInteractiveAction('Log in to manage lists');
    if (!loggedIn) return [];

    try {
      const lookup = await this.listLookup.lookup([]);
      if (!lookup) return [];
      const lists = this.orderListsForAction(lookup.lists, lookup.lastListUsed);
      if (!lists?.length) {
        return [];
      }
      this.availableLists = lists.slice();
      return lists;
    } catch {
      this.toast.presentToast('Could not load your lists.');
      return [];
    }
  }

  private actionListLabel(list: AspenUserList): string {
    const title = (list?.title ?? '').toString().trim() || 'Untitled list';
    const n = Number((list as any)?.numTitles ?? 0);
    const base = Number.isFinite(n) && n > 0 ? `${title} (${n})` : title;
    return base;
  }

  private addRecordToList(list: AspenUserList, recordId: string) {
    const listId = (list?.id ?? '').toString().trim();
    if (!listId || !recordId) return;
    if (this.listActionBusy) return;
    if (this.listLookup.cachedMembershipsForRecord(recordId).some((m) => m.listId === listId)) {
      this.toast.presentToast('Already on this list.');
      return;
    }

    this.listActionBusy = true;
    this.lists.addTitlesToList(listId, [recordId])
      .pipe(finalize(() => (this.listActionBusy = false)))
      .subscribe({
        next: (res) => {
          if (!res?.success) {
            this.toast.presentToast(res?.message || 'Could not add to list.');
            return;
          }
          this.upsertKnownListMembership(listId, (list?.title ?? '').toString().trim() || 'Untitled list');
          this.listLookup.upsertMembership(recordId, listId, (list?.title ?? '').toString().trim() || 'Untitled list');
          this.needsListRefresh = true;
          this.toast.presentToast(res?.message || 'Added to list.');
        },
        error: () => this.toast.presentToast('Could not add to list.'),
      });
  }

  private async confirmRemoveFromNamedList(list: AspenUserList, recordId: string) {
    const listId = (list?.id ?? '').toString().trim();
    const title = (list?.title ?? '').toString().trim() || 'This list';
    if (!listId || !recordId) return;

    const confirmSheet = await this.actionSheet.create({
      header: 'Remove from list?',
      subHeader: title,
      buttons: [
        {
          text: 'Remove',
          role: 'destructive',
          handler: () => this.removeRecordFromList(listId, recordId),
        },
        { text: 'Close', role: 'cancel' },
      ],
    });

    await confirmSheet.present();
  }

  private removeRecordFromList(listId: string, recordId: string) {
    if (this.listActionBusy) return;

    this.listActionBusy = true;
    this.lists.removeTitlesFromList(listId, [recordId])
      .pipe(finalize(() => (this.listActionBusy = false)))
      .subscribe({
        next: (res) => {
          if (!res?.success) {
            this.toast.presentToast(res?.message || 'Could not remove from list.');
            return;
          }

          this.needsListRefresh = true;
          this.removeKnownListMembership(listId);
          this.listLookup.removeMembership(recordId, listId);
          this.toast.presentToast(res?.message || 'Removed from list.');
        },
        error: () => this.toast.presentToast('Could not remove from list.'),
      });
  }

  private async seedKnownListMemberships() {
    const listId = (this.listContext?.listId ?? '').toString().trim();
    if (listId) {
      const listTitle = (this.listContext?.listTitle ?? '').toString().trim() || 'This list';
      this.mergeKnownListMemberships([{ listId, listTitle }]);
    }

    try {
      const recordId = this.listRecordId();
      if (!recordId) return;
      const indexed = await this.listLookup.membershipsForRecord(recordId);
      if (!indexed.length) return;
      this.mergeKnownListMemberships(
        indexed
          .map((x) => ({
            listId: (x?.listId ?? '').toString().trim(),
            listTitle: (x?.listTitle ?? '').toString().trim() || 'List',
          }))
          .filter((x) => !!x.listId),
      );
    } catch {
      // Best-effort session cache only.
    }
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

  private upsertKnownListMembership(listId: string, listTitle: string) {
    const id = (listId ?? '').toString().trim();
    if (!id) return;

    const existing = this.knownListMemberships.find(x => x.listId === id);
    if (existing) {
      existing.listTitle = listTitle || existing.listTitle;
      return;
    }

    this.knownListMemberships = [...this.knownListMemberships, { listId: id, listTitle: listTitle || 'List' }];
  }

  private removeKnownListMembership(listId: string) {
    const id = (listId ?? '').toString().trim();
    if (!id) return;
    this.knownListMemberships = this.knownListMemberships.filter(x => x.listId !== id);
  }

  private mergeKnownListMemberships(entries: KnownListMembership[]) {
    const byId = new Map<string, KnownListMembership>();
    for (const entry of this.knownListMemberships) {
      const listId = (entry?.listId ?? '').toString().trim();
      if (!listId) continue;
      byId.set(listId, { listId, listTitle: entry.listTitle || 'List' });
    }
    for (const entry of entries ?? []) {
      const listId = (entry?.listId ?? '').toString().trim();
      if (!listId) continue;
      byId.set(listId, { listId, listTitle: (entry?.listTitle ?? '').toString().trim() || 'List' });
    }
    this.knownListMemberships = Array.from(byId.values());
  }

  async openListMembershipActions(m: KnownListMembership, ev?: Event) {
    ev?.stopPropagation?.();
    if (!m?.listId) return;

    await this.ensureOwnedListIdsLoaded();
    const canEdit = this.canEditKnownListMembership(m.listId);
    const buttons: ActionSheetButton[] = [
      {
        text: 'View list',
        handler: () => this.openKnownList(m.listId, m.listTitle),
      },
    ];
    if (canEdit) {
      buttons.push({
        text: 'Remove from this list',
        role: 'destructive',
        handler: () =>
          this.confirmRemoveFromNamedList(
            { id: m.listId, title: m.listTitle } as AspenUserList,
            this.listRecordId(),
          ),
      });
    }
    buttons.push({ text: 'Close', role: 'cancel' });

    const sheet = await this.actionSheet.create({
      header: m.listTitle || 'List actions',
      buttons,
    });

    await sheet.present();
  }

  private canEditKnownListMembership(listId: string): boolean {
    const id = (listId ?? '').toString().trim();
    if (!id) return false;
    const contextListId = (this.listContext?.listId ?? '').toString().trim();
    if (contextListId && contextListId === id) {
      return this.listContext?.canEdit !== false;
    }
    return this.ownedListIds.has(id);
  }

  private async refreshOwnedListIds(): Promise<void> {
    try {
      const lists = await lastValueFrom(this.lists.fetchUserLists());
      this.ownedListIds = new Set(
        (lists ?? [])
          .map((x) => (x?.id ?? '').toString().trim())
          .filter((x) => !!x),
      );
      this.ownedListIdsLoaded = true;
    } catch {
      this.ownedListIds = new Set<string>();
      this.ownedListIdsLoaded = false;
    }
  }

  private async ensureOwnedListIdsLoaded(): Promise<void> {
    if (this.ownedListIdsLoaded) return;
    await this.refreshOwnedListIds();
  }

  private async refreshAvailableLists(): Promise<void> {
    try {
      const lookup = await this.listLookup.lookup([]);
      this.availableLists = this.orderListsForAction(lookup.lists, lookup.lastListUsed);
      this.listsHydrated = true;
      this.listsAccountId = (this.auth.snapshot()?.activeAccountId ?? '').toString().trim() || null;
    } catch {
      this.availableLists = [];
      this.listsHydrated = false;
    }
  }

  private async createListAndAddRecord(recordId: string): Promise<void> {
    const basics = await this.promptListBasics('Create List');
    if (!basics) return;

    const isPublic = await this.promptVisibility(false);
    if (isPublic === null) return;

    if (this.listActionBusy) return;
    this.listActionBusy = true;
    this.lists.createList(basics.title, basics.description, isPublic)
      .pipe(finalize(() => (this.listActionBusy = false)))
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
          this.availableLists = this.orderListsForAction([createdList, ...this.availableLists], res.listId);
          this.listLookup.replaceLists(this.availableLists);
          this.addRecordToList(createdList, recordId);
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

  // ----------------------------
  // Checkout card helpers/actions
  // ----------------------------

  checkoutDueText(): string {
    const c: any = this.checkout;
    if (!c) return '';
    const due = Number(c?.dueDate ?? 0);
    if (!Number.isFinite(due) || due <= 0) return '';
    const dt = new Date(due * 1000); // Aspen dueDate is epoch seconds
    return dt.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  checkoutRenewInfoText(): string {
    const c: any = this.checkout;
    if (!c) return '';
    const used = c?.renewCount;
    const max = c?.maxRenewals;
    if (used == null && max == null) return '';
    if (used == null) return `Max renewals: ${max}`;
    if (max == null) return `Renewals: ${used}`;
    return `Renewals: ${used} / ${max}`;
  }

  checkoutCanRenew(): boolean {
    const c: any = this.checkout;
    if (!c) return false;
    return c?.canRenew === true || c?.canrenew === true;
  }

  renewCheckout() {
    if (!this.checkout || this.checkoutActionBusy) return;

    if (!this.checkoutCanRenew()) {
      this.toast.presentToast('This item cannot be renewed.');
      return;
    }

    this.checkoutActionBusy = true;

    this.checkouts
      .renewCheckout(this.checkout)
      .pipe(finalize(() => (this.checkoutActionBusy = false)))
      .subscribe({
        next: (res) => {
          if (!res?.success) {
            this.toast.presentToast(res?.message || 'Could not renew.');
            return;
          }

          this.needsCheckoutsRefresh = true;
          this.toast.presentToast(res?.message || 'Renewed.');
          this.applyRenewMutationToCheckout(this.checkout, res?.raw);
        },
        error: () => this.toast.presentToast('Could not renew.'),
      });
  }

  // ----------------------------
  // Hold card helpers
  // ----------------------------

  hasAnyHoldForItem(): boolean {
    return this.holdsForItem.length > 0;
  }

  hasMultipleHoldsForItem(): boolean {
    return this.holdsForItem.length > 1;
  }

  holdCardTitle(): string {
    if (this.holdsForItem.length > 1) {
      return `You have ${this.holdsForItem.length} holds on this item`;
    }
    return 'You have this item on hold';
  }

  holdFormatText(hold?: AspenHold | null): string {
    const h: any = hold ?? this.hold;
    if (!h) return 'Format';
    const f = h?.format;
    if (Array.isArray(f) && f.length) {
      return f.map((x: any) => (x ?? '').toString().trim()).filter(Boolean).join(', ');
    }
    if (typeof f === 'string' && f.trim()) return f.trim();
    return 'Format';
  }

  holdIsFrozen(hold?: AspenHold | null): boolean {
    const h: any = hold ?? this.hold;
    if (!h) return false;
    if (h?.frozen === true) return true;
    const status = (h?.statusMessage ?? h?.status ?? '').toString().toLowerCase();
    return status.includes('frozen') || status.includes('suspend') || status.includes('suspended');
  }

  holdIsReady(hold?: AspenHold | null): boolean {
    const h: any = hold ?? this.hold;
    if (!h) return false;
    if (h?.available === true) return true;
    const status = (h?.statusMessage ?? h?.status ?? '').toString().toLowerCase();
    return status.includes('ready to pickup') || status.includes('ready for pickup') || status.includes('ready');
  }

  holdCanFreeze(hold?: AspenHold | null): boolean {
    const h: any = hold ?? this.hold;
    if (!h || this.holdIsReady(h)) return false;
    if (h?.canFreeze === true) return true;
    if (h?.freezable === true) return true;
    return (h?.allowFreezeHolds ?? '').toString().trim() === '1';
  }

  private holdHasManageableIdentity(hold?: AspenHold | null): boolean {
    const h: any = hold ?? this.hold;
    if (!h) return false;
    const holdId = Number(h?.cancelId ?? h?.id ?? 0);
    const recordId = Number(h?.recordId ?? 0);
    return Number.isFinite(holdId) && holdId > 0 && Number.isFinite(recordId) && recordId > 0;
  }

  holdStatusText(hold?: AspenHold | null): string {
    const h: any = hold ?? this.hold;
    if (!h) return '';
    const raw = (h?.statusMessage ?? h?.status ?? '').toString().trim();
    if (raw && /ready/i.test(raw)) return this.readyHoldPickupText(h) || raw;
    return this.holdIsFrozen(h) ? 'Suspended' : 'Active';
  }

  holdStatusLabel(hold?: AspenHold | null): string {
    return this.holdIsReady(hold ?? this.hold) ? 'Ready' : 'Status';
  }

  holdStatusClass(hold?: AspenHold | null): string {
    const txt = this.holdStatusText(hold).toLowerCase();
    if (txt.includes('ready')) return 'status-ready';
    if (txt.includes('suspend')) return 'status-suspended';
    return 'status-active';
  }

  holdPickupText(hold?: AspenHold | null): string {
    const h: any = hold ?? this.hold;
    if (!h) return '';
    const name = (h?.pickupLocationName ?? h?.currentPickupName ?? '').toString().trim();
    return name ? `Pickup: ${name}` : '';
  }

  holdPositionText(hold?: AspenHold | null): string {
    const h: any = hold ?? this.hold;
    if (!h) return '';
    const pos = Number(h?.position);
    const q = Number(h?.holdQueueLength);

    if (Number.isFinite(pos) && pos > 0) {
      if (Number.isFinite(q) && q > 0) return `Position ${pos} in queue (queue length ${q})`;
      return `Position ${pos} in queue`;
    }
    if (Number.isFinite(q) && q > 0) return `Queue length ${q}`;
    return '';
  }

  private readyHoldPickupText(hold?: AspenHold | null): string {
    const h: any = hold ?? this.hold;
    if (!h || !this.holdIsReady(h)) return '';

    const raw = Number(h?.expirationDate ?? h?.expire ?? 0);
    if (!Number.isFinite(raw) || raw <= 0) return '';

    const date = new Date(raw > 1e12 ? raw : raw * 1000);
    if (Number.isNaN(date.getTime())) return '';

    return `Pick up by ${this.formatDeadlineDate(date)}`;
  }

  private formatDeadlineDate(date: Date): string {
    const month = new Intl.DateTimeFormat(undefined, { month: 'long' }).format(date);
    const day = date.getDate();
    return `${month} ${day}${this.ordinalSuffix(day)}`;
  }

  private ordinalSuffix(day: number): string {
    const mod100 = day % 100;
    if (mod100 >= 11 && mod100 <= 13) return 'th';
    switch (day % 10) {
      case 1:
        return 'st';
      case 2:
        return 'nd';
      case 3:
        return 'rd';
      default:
        return 'th';
    }
  }

  freezeHold() {
    if (!this.hold || this.holdActionBusy) return;
    if (this.holdIsReady()) return;
    if (!this.holdCanFreeze(this.hold)) return;
    if (!this.holdHasManageableIdentity(this.hold)) return;

    this.holdActionBusy = true;
    this.holds
      .freezeHold(this.hold)
      .pipe(finalize(() => (this.holdActionBusy = false)))
      .subscribe({
        next: (res) => {
          if (!res?.success) {
            this.toast.presentToast('Could not suspend hold.');
            return;
          }

          this.needsHoldsRefresh = true;

          // optimistic UI update
          (this.hold as any).frozen = true;
          (this.hold as any).statusMessage = 'Suspended';
          this.syncHoldAcrossItemState(this.hold);
          this.holds.upsertCachedHold(this.hold!).catch(() => {});

          this.toast.presentToast('Hold suspended.');
        },
        error: () => this.toast.presentToast('Could not suspend hold.'),
      });
  }

  thawHold() {
    if (!this.hold || this.holdActionBusy) return;
    if (this.holdIsReady()) return;
    if (!this.holdHasManageableIdentity(this.hold)) return;

    this.holdActionBusy = true;
    this.holds
      .thawHold(this.hold)
      .pipe(finalize(() => (this.holdActionBusy = false)))
      .subscribe({
        next: (res) => {
          if (!res?.success) {
            this.toast.presentToast('Could not activate hold.');
            return;
          }

          this.needsHoldsRefresh = true;

          // optimistic UI update
          (this.hold as any).frozen = false;
          (this.hold as any).statusMessage = 'Active';
          this.syncHoldAcrossItemState(this.hold);
          this.holds.upsertCachedHold(this.hold!).catch(() => {});

          this.toast.presentToast('Hold activated.');
        },
        error: () => this.toast.presentToast('Could not activate hold.'),
      });
  }

  async confirmCancelHold() {
    if (!this.hold || this.holdActionBusy) return;

    const sheet = await this.actionSheet.create({
      header: 'Cancel hold?',
      buttons: [
        {
          text: 'Cancel Hold',
          role: 'destructive',
          handler: () => this.cancelHoldNow(),
        },
        { text: 'Keep Hold', role: 'cancel' },
      ],
    });

    await sheet.present();
  }

  private cancelHoldNow() {
    if (!this.hold || this.holdActionBusy) return;
    if (!this.holdHasManageableIdentity(this.hold)) return;

    const selected = this.hold;
    const canceledHoldId = Number((selected as any)?.cancelId ?? (selected as any)?.id ?? 0) || 0;
    const canceledRecordId = ((selected as any)?.recordId ?? '').toString().trim();

    this.holdActionBusy = true;
    this.holds
      .cancelHold(this.hold)
      .pipe(finalize(() => (this.holdActionBusy = false)))
      .subscribe({
        next: (res) => {
          if (!res?.success) {
            this.toast.presentToast(res?.message || 'Could not cancel hold.');
            return;
          }

          this.needsHoldsRefresh = true;
          const wasReady = this.holdIsReady(selected);
          this.auth.adjustActiveProfileCounts({
            holds: -1,
            holdsReady: wasReady ? -1 : 0,
            holdsRequested: wasReady ? 0 : -1,
          });

          this.toast.presentToast(res?.message || 'Hold cancelled.');
          this.holds.removeCachedHold(selected).catch(() => {});

          // Keep modal open and update local state without re-fetching.
          this.holdsForItem = this.holdsForItem.filter((h) => {
            const id = Number((h as any)?.cancelId ?? (h as any)?.id ?? 0) || 0;
            if (canceledHoldId && id === canceledHoldId) return false;
            if (!canceledHoldId && canceledRecordId) {
              const rid = ((h as any)?.recordId ?? '').toString().trim();
              if (rid && rid === canceledRecordId) return false;
            }
            return true;
          });
          this.hold = this.holdsForItem[0] ?? null;
        },
        error: () => this.toast.presentToast('Could not cancel hold.'),
      });
  }

  async changePickupLocation() {
    if (!this.hold || this.holdActionBusy) return;
    if (this.holdIsReady()) return;
    if (!this.holdHasManageableIdentity(this.hold)) return;

    const holdId = Number((this.hold as any)?.cancelId ?? (this.hold as any)?.id ?? 0) || 0;
    if (!holdId) {
      this.toast.presentToast('This hold is missing a hold id.');
      return;
    }

    const currentCode = ((this.hold as any)?.currentPickupId ?? '').toString().trim();

    const buttons: ActionSheetButton[] = this.globals.pickupLocations.map((loc) => ({
      text: loc.code === currentCode ? `${loc.name} (Current)` : loc.name,
      handler: () => this.changePickupLocationNow(holdId, this.globals.pickupAspenNewLocation(loc)),
    }));

    buttons.push({ text: 'Close', role: 'cancel' });

    const sheet = await this.actionSheet.create({
      header: 'Choose pickup location',
      buttons,
    });

    await sheet.present();
  }

  private changePickupLocationNow(holdId: number, newLocation: string) {
    if (!this.hold || this.holdActionBusy) return;

    const parsed = this.parseAspenNewLocation(newLocation);

    this.holdActionBusy = true;
    this.holds
      .changeHoldPickUpLocation(holdId, newLocation, null)
      .pipe(finalize(() => (this.holdActionBusy = false)))
      .subscribe({
        next: (res) => {
          if (!res?.success) {
            this.toast.presentToast(res?.message || 'Could not change pickup location.');
            return;
          }

          this.needsHoldsRefresh = true;

          // optimistic UI update (correct field shapes)
          if (parsed) {
            (this.hold as any).currentPickupId = parsed.code;
            (this.hold as any).currentPickupName =
              this.globals.pickupNameForCode(parsed.code) ?? (this.hold as any).currentPickupName;

            (this.hold as any).pickupLocationId = parsed.id;
            (this.hold as any).pickupLocationName =
              this.globals.pickupNameForCode(parsed.code) ?? (this.hold as any).pickupLocationName;
          }
          this.syncHoldAcrossItemState(this.hold);
          this.holds.upsertCachedHold(this.hold!).catch(() => {});

          this.toast.presentToast(res?.message || 'Pickup location updated.');
        },
        error: () => this.toast.presentToast('Could not change pickup location.'),
      });
  }

  async openHoldManager() {
    if (!this.holdsForItem.length || this.holdActionBusy) return;

    if (this.holdsForItem.length === 1) {
      this.hold = this.holdsForItem[0];
      await this.openActionsForCurrentHold();
      return;
    }

    const picker = await this.actionSheet.create({
      header: 'Choose hold to manage',
      buttons: [
        ...this.holdsForItem.map((h): ActionSheetButton => ({
          text: `${this.holdFormatText(h)} • ${this.holdStatusText(h)}`,
          handler: () => {
            this.hold = h;
            void this.openActionsForCurrentHold();
          },
        })),
        { text: 'Close', role: 'cancel' },
      ],
    });
    await picker.present();
  }

  private async openActionsForCurrentHold() {
    if (!this.hold) return;
    if (!this.holdHasManageableIdentity(this.hold)) {
      const refreshed = await this.refreshHoldForThisItemFromFreshFetch();
      if (!refreshed || !this.hold || !this.holdHasManageableIdentity(this.hold)) {
        this.toast.presentToast('Refreshing hold details. Please try again in a moment.');
        return;
      }
    }
    const isReady = this.holdIsReady(this.hold);
    const isFrozen = this.holdIsFrozen(this.hold);

    const buttons: ActionSheetButton[] = [];
    if (!isReady && isFrozen) {
      buttons.push({ text: 'Activate', handler: () => this.thawHold() });
    }
    if (!isReady && !isFrozen && this.holdCanFreeze(this.hold)) {
      buttons.push({ text: 'Suspend', handler: () => this.freezeHold() });
    }
    if (!isReady) {
      buttons.push({ text: 'Change pickup location', handler: () => this.changePickupLocation() });
    }
    buttons.push({ text: 'Cancel Hold', role: 'destructive', handler: () => this.confirmCancelHold() });
    buttons.push({ text: 'Close', role: 'cancel' });

    const actions = await this.actionSheet.create({
      header: this.holdFormatText(this.hold),
      buttons,
    });
    await actions.present();
  }

  private parseAspenNewLocation(s: string): { id: string; code: string } | null {
    const raw = (s ?? '').trim();
    if (!raw) return null;
    const parts = raw.split('_');
    if (parts.length < 2) return null;
    const id = parts[0].trim();
    const code = parts.slice(1).join('_').trim();
    if (!id || !code) return null;
    return { id, code };
  }

  // ----------------------------
  // Formats / actions / holdings
  // ----------------------------

  formatHoldingsCount(formatLabel: string): number {
    const k = (formatLabel ?? '').toString();
    return this.holdingsCountByFormat[k] ?? 0;
  }

  formatHoldingsText(formatLabel: string): string {
    const count = this.formatHoldingsCount(formatLabel);
    if (count <= 0) return '';
    return `${count} ${count === 1 ? 'copy' : 'copies'}`;
  }

  formatShelfDetails(formatLabel: string): FormatShelfDetail[] {
    const k = (formatLabel ?? '').toString();
    return this.holdingsDetailsByFormat[k] ?? [];
  }

  hasFormatShelfDetails(formatLabel: string): boolean {
    return this.formatShelfDetails(formatLabel).length > 0;
  }

  visibleFormatShelfDetails(formatLabel: string): FormatShelfDetail[] {
    return this.formatShelfDetails(formatLabel).slice(0, 3);
  }

  formatShelfDetailsRemaining(formatLabel: string): number {
    const total = this.formatShelfDetails(formatLabel).length;
    return total > 3 ? total - 3 : 0;
  }

  formatShelfDetailText(detail: FormatShelfDetail): string {
    const parts: string[] = [];
    if (detail.location) parts.push(detail.location);
    if (detail.callNumber) parts.push(detail.callNumber);
    if (detail.status) parts.push(detail.status);
    return parts.join(' • ');
  }

  async openCopyDetails(formatKey: string, ev: Event) {
    ev?.stopPropagation?.();
    if (this.copyDetailsModalOpen) return;

    const details = this.formatShelfDetails(formatKey);
    if (!details.length) return;

    const label =
      (this.work?.formats as any)?.[formatKey]?.label?.toString?.().trim?.() ||
      formatKey ||
      'Copy details';

    this.copyDetailsModalOpen = true;
    try {
      const modal = await this.modalCtrl.create({
        component: CopyDetailsPopoverComponent,
        componentProps: {
          formatLabel: label,
          title: (this.work?.title ?? this.hit?.title ?? 'Untitled').toString().trim() || 'Untitled',
          author: (this.work?.author ?? this.hit?.author ?? '').toString().trim(),
          coverUrl: this.displayCoverUrl,
          details,
        },
      });

      this.globals.modal_open = true;
      modal.onDidDismiss().then(() => {
        this.copyDetailsModalOpen = false;
        // Parent item-detail modal remains open, so keep global flag true.
        this.globals.modal_open = true;
      });
      await modal.present();
    } catch {
      this.copyDetailsModalOpen = false;
      this.toast.presentToast('Could not open copy details.');
    }
  }

  providerStatusesForFormat(formatLabel: string): FormatProviderStatus[] {
    const k = (formatLabel ?? '').toString();
    return this.providerStatusesByFormat[k] ?? [];
  }

  providerStatusSummary(status: FormatProviderStatus): string {
    const raw = (status?.groupedStatus ?? '').toString().trim();
    if (raw) return raw;
    return status?.isAvailable ? 'Available' : 'Not available';
  }

  hasProviderStatuses(formatLabel: string): boolean {
    return this.providerStatusesForFormat(formatLabel).length > 0;
  }

  providerActionsForFormat(formatLabel: string): FormatProviderAction[] {
    const k = (formatLabel ?? '').toString();
    return this.providerActionsByFormat[k] ?? [];
  }

  hasProviderDetails(formatLabel: string): boolean {
    return this.hasProviderStatuses(formatLabel) || this.providerActionsForFormat(formatLabel).length > 0;
  }

  showBaseFormatMeta(formatLabel: string): boolean {
    return !this.hasProviderDetails(formatLabel);
  }

  showBaseFormatSubMeta(formatLabel: string): boolean {
    return !this.hasProviderDetails(formatLabel);
  }

  showShelfDetails(formatLabel: string): boolean {
    return !this.hasProviderDetails(formatLabel);
  }

  effectiveFormatActions(formatKey: string, actions: any[]): any[] {
    const base = this.visibleFormatActions(actions);
    const providerActions = this.providerActionsForFormat(formatKey);
    if (!providerActions.length) return base;

    const filteredBase = base.filter((a) => !this.isGenericAccessAction(a));
    const merged: any[] = [...filteredBase, ...providerActions];
    const seen = new Set<string>();
    const deduped: any[] = [];

    for (const a of merged) {
      const key = `${(a?.url ?? '').toString().trim()}|${(a?.title ?? '').toString().trim().toLowerCase()}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      deduped.push(a);
    }

    return deduped;
  }

  visibleFormatActions(actions: any[]): any[] {
    if (!Array.isArray(actions) || !actions.length) return [];
    return actions.filter((a) => !this.isPreviewAction(a));
  }

  hasHoldForFormat(formatKey: string): boolean {
    const wanted = (formatKey ?? '').toString().trim();
    if (!wanted || !this.holdsForItem.length) return false;

    const idsForFormat = this.holdableRecordIdsForFormat(wanted);
    if (idsForFormat.length) {
      const heldIds = new Set(
        this.holdsForItem
          .map((h) => (h?.recordId ?? '').toString().trim())
          .filter((id) => !!id),
      );
      if (idsForFormat.some((id) => heldIds.has(id))) return true;
    }

    const wantedNorm = this.normalizeFormatValue(wanted);
    if (!wantedNorm) return false;
    return this.holdsForItem.some((h: any) => {
      const f = h?.format;
      if (Array.isArray(f)) {
        return f.some((x: any) => this.normalizeFormatValue((x ?? '').toString()) === wantedNorm);
      }
      if (typeof f === 'string') {
        return this.normalizeFormatValue(f) === wantedNorm;
      }
      return false;
    });
  }

  private holdableRecordIdsForFormat(formatKey: string): string[] {
    const fmt = (this.work?.formats as any)?.[formatKey];
    const actions = Array.isArray(fmt?.actions) ? fmt.actions : [];
    const ids = new Set<string>();
    for (const action of actions) {
      if (!this.isIlsHoldAction(action)) continue;
      const recordId = this.items.extractIlsIdFromOnclick((action?.onclick ?? '').toString());
      if (!recordId) continue;
      ids.add(recordId);
    }
    return Array.from(ids);
  }

  private normalizeFormatValue(value: string): string {
    return (value ?? '')
      .toString()
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  private syncHoldAcrossItemState(hold: AspenHold | null) {
    if (!hold) return;
    const holdId = Number((hold as any)?.cancelId ?? (hold as any)?.id ?? 0) || 0;
    const recordId = ((hold as any)?.recordId ?? '').toString().trim();

    this.holdsForItem = (this.holdsForItem ?? []).map((h) => {
      const hId = Number((h as any)?.cancelId ?? (h as any)?.id ?? 0) || 0;
      const hRecordId = ((h as any)?.recordId ?? '').toString().trim();
      if (holdId && hId === holdId) return { ...(h as any), ...(hold as any) } as AspenHold;
      if (!holdId && recordId && hRecordId === recordId) return { ...(h as any), ...(hold as any) } as AspenHold;
      return h;
    });

    if (this.hold) {
      const currentId = Number((this.hold as any)?.cancelId ?? (this.hold as any)?.id ?? 0) || 0;
      const currentRecordId = ((this.hold as any)?.recordId ?? '').toString().trim();
      if ((holdId && currentId === holdId) || (!holdId && recordId && currentRecordId === recordId)) {
        this.hold = { ...(this.hold as any), ...(hold as any) } as AspenHold;
      }
    }
  }

  private insertOptimisticPlacedHold(recordId: string, pickupBranch: string) {
    const groupedWorkId = (this.hit?.key ?? '').toString().trim();
    if (!groupedWorkId) return;

    const pickupName = this.globals.pickupNameForCode(pickupBranch) ?? '';
    const optimistic: AspenHold = {
      id: -Date.now(),
      type: 'ils',
      source: 'ils',
      groupedWorkId,
      recordId: Number(recordId),
      format: this.selectedFormatForRecordId(recordId),
      statusMessage: 'Active',
      status: 'Pending',
      available: false,
      currentPickupId: pickupBranch,
      currentPickupName: pickupName,
      pickupLocationName: pickupName,
      title: this.itemDisplayTitle(),
      author: this.work?.author ?? this.hit?.author,
      coverUrl: this.displayCoverUrl,
      position: 0,
      holdQueueLength: 0,
    } as AspenHold;

    this.holdsForItem = [optimistic, ...(this.holdsForItem ?? [])];
    this.hold = optimistic;
  }

  private selectedFormatForRecordId(recordId: string): string {
    const recId = (recordId ?? '').toString().trim();
    if (!recId || !this.work?.formats) return '';

    for (const [formatKey, fmt] of Object.entries(this.work.formats)) {
      const actions = Array.isArray((fmt as any)?.actions) ? (fmt as any).actions : [];
      for (const action of actions) {
        if (!this.isIlsHoldAction(action)) continue;
        const actionRecId = this.items.extractIlsIdFromOnclick((action?.onclick ?? '').toString());
        if (actionRecId !== recId) continue;
        return (fmt as any)?.label?.toString?.().trim?.() || formatKey;
      }
    }

    return '';
  }

  isIlsHoldAction(action: any): boolean {
    const t = (action?.type ?? '').toString().toLowerCase();
    if (t === 'ils_hold') return true;
    const onclick = (action?.onclick ?? '').toString();
    return onclick.includes('showPlaceHold');
  }

  isPreviewAction(action: any): boolean {
    const type = (action?.type ?? '').toString().toLowerCase();
    const title = (action?.title ?? '').toString().toLowerCase();
    return type === 'overdrive_sample' || title.includes('preview');
  }

  isGenericAccessAction(action: any): boolean {
    const title = (action?.title ?? '').toString().trim().toLowerCase();
    return title === 'access online' || title === 'open online';
  }

  formatSortComparator = (a: KeyValue<string, any>, b: KeyValue<string, any>): number => {
    const aDigital = this.isLikelyDigitalFormat(a.key, a.value);
    const bDigital = this.isLikelyDigitalFormat(b.key, b.value);
    if (aDigital !== bDigital) return aDigital ? 1 : -1;

    const aLabel = ((a.value?.label ?? a.key) as string).toString().toLowerCase();
    const bLabel = ((b.value?.label ?? b.key) as string).toString().toLowerCase();
    return aLabel.localeCompare(bLabel);
  };

  async handleFormatAction(action: any, formatKey: string) {
    const url = (action?.url ?? '').toString().trim();
    if (url) {
      const preferredUrl = this.preferredExternalUrlForAction(action, url);
      await this.globals.open_external_page(preferredUrl);
      return;
    }

    if (this.isIlsHoldAction(action)) {
      if (this.hasHoldForFormat(formatKey)) {
        this.toast.presentToast('You already have this format on hold.');
        return;
      }

      const recordId = this.items.extractIlsIdFromOnclick((action?.onclick ?? '').toString());
      if (!recordId) {
        this.toast.presentToast('Could not determine record id for this hold.');
        return;
      }

      await this.promptAndPlaceHold(recordId);
      return;
    }

    if (action?.onclick) {
      this.toast.presentToast('This action requires the web catalog UI (wiring later).');
      return;
    }

    this.toast.presentToast('Action not supported yet.');
  }

  private preferredExternalUrlForAction(action: any, url: string): string {
    const type = (action?.type ?? '').toString().toLowerCase();
    const title = (action?.title ?? '').toString().toLowerCase();
    const lowerUrl = (url ?? '').toString().toLowerCase();

    const isLibbyLike =
      type.includes('overdrive') ||
      title.includes('libby') ||
      lowerUrl.includes('overdrive.com');

    if (!isLibbyLike) return url;

    return this.libbyUniversalUrlForOverdrive(url) ?? url;
  }

  private libbyUniversalUrlForOverdrive(rawUrl: string): string | null {
    try {
      const parsed = new URL(rawUrl);
      const host = parsed.hostname.toLowerCase();
      if (!host.endsWith('overdrive.com')) return null;

      // Typical Aspen OverDrive access links are:
      //   https://{library}.overdrive.com/media/{mediaId}
      // Libby universal link equivalent:
      //   https://libbyapp.com/library/{library}/media/{mediaId}
      const mediaMatch = parsed.pathname.match(/^\/media\/([^/?#]+)/i);
      if (!mediaMatch?.[1]) return null;

      const library = host.split('.')[0]?.trim();
      const mediaId = mediaMatch[1].trim();
      if (!library || !mediaId) return null;

      return `https://libbyapp.com/library/${encodeURIComponent(library)}/media/${encodeURIComponent(mediaId)}`;
    } catch {
      return null;
    }
  }

  private async promptAndPlaceHold(recordId: string) {
    if (this.holdActionBusy) return;
    const loggedIn = await this.ensureLoggedInForInteractiveAction('Log in to place hold');
    if (!loggedIn) return;

    const defaultPickupBranch = await this.defaultPickupBranchCode();
    if (defaultPickupBranch) {
      this.placeHoldNow(recordId, defaultPickupBranch);
      return;
    }

    // Fallback to picker only if no default preference is available.
    const buttons: ActionSheetButton[] = this.globals.pickupLocations.map((loc) => ({
      text: loc.name,
      handler: () => this.placeHoldNow(recordId, loc.code),
    }));
    buttons.push({ text: 'Close', role: 'cancel' });

    const sheet = await this.actionSheet.create({
      header: 'Pick up where?',
      buttons,
    });

    await sheet.present();
  }

  private placeHoldNow(recordId: string, pickupBranch: string) {
    if (this.holdActionBusy) return;

    this.holdActionBusy = true;
    this.holds
      .placeHold(recordId, pickupBranch, null)
      .pipe(finalize(() => (this.holdActionBusy = false)))
      .subscribe({
        next: (res) => {
          if (!res?.success) {
            this.toast.presentToast(res?.message || 'Could not place hold.');
            return;
          }

          this.needsHoldsRefresh = true;
          this.auth.adjustActiveProfileCounts({ holds: 1, holdsRequested: 1 });
          void this.toast.presentHoldPlacedToast(res?.message || 'Hold placed.', () =>
            this.openHoldsPage(),
          );
          this.insertOptimisticPlacedHold(recordId, pickupBranch);
          void this.refreshHoldForThisItemFromFreshFetch();
        },
        error: (err) => {
          const msg = (err?.message ?? '').toString().trim();
          if (msg === 'not_logged_in' || msg === 'missing_password') {
            void this.retryPlaceHoldAfterLogin(recordId, pickupBranch);
            return;
          }
          this.toast.presentToast('Could not place hold.');
        },
      });
  }

  private async retryPlaceHoldAfterLogin(recordId: string, pickupBranch: string): Promise<void> {
    const ok = await this.ensureLoggedInForInteractiveAction('Log in to place hold');
    if (!ok) return;
    this.placeHoldNow(recordId, pickupBranch);
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

  private async ensureLoggedInForInteractiveAction(header: string): Promise<boolean> {
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

  private loadHoldingsCountsForWork(work: AspenGroupedWork | null) {
    if (!work?.formats) return;
    const workId = (work.id ?? '').toString().trim();
    if (!workId) return;

    const requests: Array<{ formatKey: string; ilsId: string }> = [];

    for (const [formatKey, fmt] of Object.entries(work.formats)) {
      const actions = (fmt as any)?.actions ?? [];
      let ilsId: string | null = null;

      for (const a of actions) {
        const onclick = (a as any)?.onclick as string | undefined;
        const extracted = this.items.extractIlsIdFromOnclick(onclick);
        if (extracted) {
          ilsId = extracted;
          break;
        }
      }

      if (ilsId) {
        const requestKey = `${workId}:${formatKey}:${ilsId}`;
        if (this.requestedHoldings.has(requestKey)) continue;
        this.requestedHoldings.add(requestKey);
        requests.push({ formatKey, ilsId });
      }
    }

    if (!requests.length) return;

    const calls = requests.map((r) =>
      this.items.getIlsItemAvailability(r.ilsId).pipe(catchError(() => of(null))),
    );

    forkJoin(calls).subscribe({
      next: (results) => {
        const byFormat: Record<string, number> = {};
        const detailsByFormat: Record<string, FormatShelfDetail[]> = {};

        for (let i = 0; i < results.length; i++) {
          const res: any = results[i];
          const fmtKey = requests[i].formatKey;

          let total = 0;
          const details: FormatShelfDetail[] = [];
          const holdings = res?.holdings;
          if (holdings && typeof holdings === 'object') {
            for (const k of Object.keys(holdings)) {
              const arr = holdings[k];
              if (!Array.isArray(arr)) continue;
              total += arr.length;

              for (const raw of arr) {
                const location = (raw?.libraryDisplayName ?? raw?.location ?? '').toString().trim();
                const callNumber = (raw?.callnumber ?? '').toString().trim();
                const status = (raw?.statusFull ?? raw?.statusfull ?? raw?.status ?? '').toString().trim();
                const availabilityRaw = raw?.availability;
                const availability = availabilityRaw === true
                  ? true
                  : availabilityRaw === false
                    ? false
                    : null;
                if (!location && !callNumber && !status) continue;
                details.push({ location, callNumber, status, availability });
              }
            }
          }

          byFormat[fmtKey] = total;
          detailsByFormat[fmtKey] = this.dedupeShelfDetails(details);
        }

        this.holdingsCountByFormat = {
          ...this.holdingsCountByFormat,
          ...byFormat,
        };
        this.holdingsDetailsByFormat = {
          ...this.holdingsDetailsByFormat,
          ...detailsByFormat,
        };
      },
      error: () => {},
    });
  }

  private loadProviderStatusesForWork(work: AspenGroupedWork | null) {
    if (!work?.id || !work?.formats) return;

    const groupedWorkId = (work.id ?? '').toString().trim();
    if (!groupedWorkId) return;

    for (const [formatKey, fmt] of Object.entries(work.formats)) {
      if (!this.shouldFetchVariationDetails(formatKey, fmt)) continue;
      const requestKey = `${groupedWorkId}:${formatKey}`;
      if (this.requestedVariations.has(requestKey)) continue;
      this.requestedVariations.add(requestKey);

      this.items.getFormatVariations(groupedWorkId, formatKey)
        .pipe(catchError(() => of(null)))
        .subscribe({
          next: (res) => {
            const statuses = this.extractDigitalProviderStatuses(res);
            if (statuses.length) {
              this.providerStatusesByFormat = {
                ...this.providerStatusesByFormat,
                [formatKey]: statuses,
              };
            }

            const actions = this.extractDigitalProviderActions(res);
            if (actions.length) {
              this.providerActionsByFormat = {
                ...this.providerActionsByFormat,
                [formatKey]: actions,
              };
            }
          },
          error: () => {},
        });
    }
  }

  private extractDigitalProviderStatuses(result: AspenFormatVariationsResult | null): FormatProviderStatus[] {
    if (!result?.variations || typeof result.variations !== 'object') return [];

    const out: FormatProviderStatus[] = [];
    for (const [label, variation] of Object.entries(result.variations)) {
      const source = (variation?.source ?? '').toString().trim().toLowerCase();
      const providerLabel = (label ?? '').toString().trim();
      const status = variation?.statusIndicator;
      const hasOnlineAvailability = !!status?.isAvailableOnline;
      const isEContent = !!status?.isEContent;
      const hasProviderActions = Array.isArray(variation?.actions) && variation.actions.some((action: any) => {
        const url = (action?.url ?? action?.redirectUrl ?? '').toString().trim();
        return !!url && !this.isPreviewAction(action);
      });
      const isDigitalProvider =
        !!source ||
        !!providerLabel ||
        hasOnlineAvailability ||
        isEContent ||
        hasProviderActions;

      if (!isDigitalProvider) continue;

      out.push({
        providerLabel: providerLabel || (variation?.source ?? '').toString().trim() || 'Provider',
        source,
        groupedStatus: (status?.groupedStatus ?? '').toString().trim(),
        numCopiesMessage: this.normalizeCopiesMessage((status?.numCopiesMessage ?? '').toString().trim()),
        isAvailable: !!(status?.isAvailableOnline ?? status?.isAvailable),
      });
    }

    return out;
  }

  private normalizeCopiesMessage(value: string): string {
    const raw = (value ?? '').toString().trim();
    if (!raw) return '';

    return raw.replace(/\b1\s+copies\b\.?/i, '1 copy');
  }

  private prepareWorkLoadState(work: AspenGroupedWork | null) {
    const workId = (work?.id ?? '').toString().trim();
    if (!workId || workId === this.loadedWorkId) return;

    this.loadedWorkId = workId;
    this.requestedHoldings.clear();
    this.requestedVariations.clear();
    this.holdingsCountByFormat = {};
    this.holdingsDetailsByFormat = {};
    this.providerStatusesByFormat = {};
    this.providerActionsByFormat = {};
  }

  private shouldFetchVariationDetails(formatKey: string, fmt: any): boolean {
    return this.isLikelyDigitalFormat(formatKey, fmt);
  }

  private isLikelyDigitalFormat(formatKey: string, fmt: any): boolean {
    const key = (formatKey ?? '').toString().toLowerCase();
    const category = ((fmt as any)?.category ?? '').toString().toLowerCase();
    const actions: any[] = Array.isArray((fmt as any)?.actions) ? (fmt as any).actions : [];

    if (key.startsWith('e')) return true;
    if (key.includes('kindle') || key.includes('ebook') || key.includes('eaudiobook')) return true;
    if (category.startsWith('e') || category.includes('ebook') || category.includes('stream')) return true;

    for (const a of actions) {
      const title = (a?.title ?? '').toString().toLowerCase();
      const type = (a?.type ?? '').toString().toLowerCase();
      const url = (a?.url ?? a?.redirectUrl ?? '').toString().toLowerCase();
      if (title.includes('libby') || title.includes('hoopla')) return true;
      if (type.includes('overdrive') || type.includes('hoopla')) return true;
      if (url.includes('overdrive.com') || url.includes('hoopladigital.com')) return true;
      if ((title === 'access online' || title === 'open online') && !!url) return true;
    }

    return false;
  }

  private extractDigitalProviderActions(result: AspenFormatVariationsResult | null): FormatProviderAction[] {
    if (!result?.variations || typeof result.variations !== 'object') return [];

    const out: FormatProviderAction[] = [];
    for (const [label, variation] of Object.entries(result.variations)) {
      const source = (variation?.source ?? '').toString().trim().toLowerCase();
      const providerLabel = (label ?? '').toString().trim() || (variation?.source ?? '').toString().trim() || 'Provider';
      const status = variation?.statusIndicator;
      const isDigitalProvider =
        !!source ||
        !!status?.isEContent ||
        !!status?.isAvailableOnline ||
        (Array.isArray(variation?.actions) && variation.actions.length > 0);
      if (!isDigitalProvider) continue;

      for (const action of variation?.actions ?? []) {
        if (this.isPreviewAction(action)) continue;
        const url = (action?.url ?? action?.redirectUrl ?? '').toString().trim();
        if (!url) continue;

        let title = (action?.title ?? '').toString().trim() || 'Open';
        if (this.isGenericAccessAction(action)) {
          if (source === 'overdrive') title = 'Access in Libby';
          else if (source === 'hoopla') title = 'Access in Hoopla';
          else title = `Open in ${providerLabel}`;
        }

        out.push({ title, url, source });
      }
    }
    return out;
  }

  private refreshHoldForThisItem(force = false) {
    const key = (this.hit?.key ?? '').toString().trim();
    if (!key) return;

    if (!force && (
      this.holdsForItem.length > 0 &&
      this.holdsForItem.every((h) => String((h as any)?.groupedWorkId ?? '').trim() === key)
    )) return;

    if (this.holdRefreshBusy) return;
    this.holdRefreshBusy = true;

    this.holds.fetchActiveHolds()
      .pipe(finalize(() => (this.holdRefreshBusy = false)))
      .subscribe({
        next: (list) => {
          const matches = (list ?? []).filter(
            (h) => String((h as any)?.groupedWorkId ?? '').trim() === key,
          );
          this.holdsForItem = matches;

          if (!matches.length) {
            this.hold = null;
            return;
          }

          const currentId = Number((this.hold as any)?.id ?? 0) || 0;
          const keepCurrent = currentId
            ? matches.find((h) => (Number((h as any)?.id ?? 0) || 0) === currentId) ?? null
            : null;
          this.hold = keepCurrent ?? matches[0];
        },
        error: () => {},
      });
  }

  private async refreshHoldForThisItemFromFreshFetch(): Promise<boolean> {
    const key = (this.hit?.key ?? '').toString().trim();
    if (!key || this.holdRefreshBusy) return false;

    this.holdRefreshBusy = true;
    try {
      const list = await lastValueFrom(this.holds.fetchFreshActiveHolds());
      const matches = (list ?? []).filter(
        (h) => String((h as any)?.groupedWorkId ?? '').trim() === key,
      );
      this.holdsForItem = matches;

      if (!matches.length) {
        this.hold = null;
        return false;
      }

      const currentId = Number((this.hold as any)?.cancelId ?? (this.hold as any)?.id ?? 0) || 0;
      const keepCurrent = currentId
        ? matches.find((h) => (Number((h as any)?.cancelId ?? (h as any)?.id ?? 0) || 0) === currentId) ?? null
        : null;
      this.hold = keepCurrent ?? matches[0];
      return true;
    } catch {
      return false;
    } finally {
      this.holdRefreshBusy = false;
    }
  }

  private refreshCheckoutForThisItem(force = false) {
    const key = (this.hit?.key ?? '').toString().trim();
    if (!key) return;

    if (!force && this.checkout && String((this.checkout as any)?.groupedWorkId ?? '').trim() === key) return;

    if (this.checkoutRefreshBusy) return;
    this.checkoutRefreshBusy = true;

    this.checkouts.fetchActiveCheckouts()
      .pipe(finalize(() => (this.checkoutRefreshBusy = false)))
      .subscribe({
        next: (list) => {
          const found =
            (list ?? []).find(c => String((c as any)?.groupedWorkId ?? '').trim() === key) ?? null;

          if (found) this.checkout = found;
          else if (force) this.checkout = null;
        },
        error: () => {},
      });
  }

  private applyRenewMutationToCheckout(checkout: AspenCheckout | null, raw: any) {
    if (!checkout) return;

    const parseEpochSeconds = (v: any): number | null => {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) return null;
      return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
    };

    const rawDue =
      raw?.dueDate ??
      raw?.due_date ??
      raw?.newDueDate ??
      raw?.new_due_date ??
      raw?.dueDateTs ??
      raw?.duedate;

    const rawRenewalDate =
      raw?.renewalDate ??
      raw?.renewal_date ??
      raw?.newRenewalDate ??
      raw?.new_renewal_date;

    const dueEpoch = parseEpochSeconds(rawDue);
    if (dueEpoch) {
      (checkout as any).dueDate = dueEpoch;
      (checkout as any).overdue = false;
    }

    if (rawRenewalDate != null) {
      (checkout as any).renewalDate = String(rawRenewalDate);
    }

    const used = Number((checkout as any)?.renewCount ?? 0);
    (checkout as any).renewCount = Number.isFinite(used) ? used + 1 : 1;

    const max = Number((checkout as any)?.maxRenewals);
    if (Number.isFinite(max) && max >= 0) {
      (checkout as any).canRenew = Number((checkout as any).renewCount ?? 0) < max;
    }

    this.checkout = { ...(checkout as any) } as AspenCheckout;
  }

  private extractHoldFromHit(hit: AspenSearchHit | null | undefined): AspenHold | null {
    const raw: any = hit?.raw;
    if (!raw || typeof raw !== 'object') return null;

    const hasIds = raw?.groupedWorkId && (raw?.recordId || raw?.id);
    const isIls = raw?.type === 'ils' || raw?.source === 'ils';
    const hasCancel = raw?.cancelable === true || raw?.cancelId;

    if (hasIds && isIls && hasCancel) return raw as AspenHold;
    return null;
  }

  private extractCheckoutFromHit(hit: AspenSearchHit | null | undefined): AspenCheckout | null {
    const raw: any = hit?.raw;
    if (!raw || typeof raw !== 'object') return null;

    const isIls = raw?.type === 'ils' || raw?.source === 'ils';
    const hasBarcode = !!(raw?.barcode);
    const hasDue = raw?.dueDate != null;
    const hasRecord = raw?.recordId != null;

    if (isIls && hasBarcode && hasDue && hasRecord) return raw as AspenCheckout;
    return null;
  }

  lastBorrowedText(): string {
    const value = this.hit?.lastCheckOut;
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

  private normalizeDescriptionText(value: any): string {
    if (value === null || value === undefined) return '';
    return String(value).replace(/\s+/g, ' ').trim();
  }

  private languageText(): string {
    const raw = (this.work?.language ?? this.hit?.language ?? '').toString().trim();
    if (!raw) return '';
    return raw.split(',')[0].trim();
  }

  private seriesText(): string {
    const list = (this.work?.series ?? []) as Array<{ seriesTitle?: string; volume?: string }>;
    if (!Array.isArray(list) || !list.length) return '';
    const first = list[0] ?? {};
    const title = (first?.seriesTitle ?? '').toString().trim();
    const volume = (first?.volume ?? '').toString().trim();
    if (!title) return '';
    if (!volume) return title;
    return `${title} · Vol ${volume}`;
  }

  private publicationYearText(): string {
    const candidates: any[] = [
      (this.work as any)?.publishYear,
      (this.work as any)?.year,
      (this.work as any)?.publishDate,
      (this.work as any)?.publishDateSort,
      (this.work as any)?.publicationDate,
      (this.hit?.raw as any)?.publishYear,
      (this.hit?.raw as any)?.year,
      (this.hit?.raw as any)?.publishDate,
      (this.hit?.raw as any)?.publishDateSort,
      (this.hit?.raw as any)?.publicationDate,
    ];

    for (const candidate of candidates) {
      const year = this.extractYear(candidate);
      if (year) return String(year);
    }
    return '';
  }

  private extractYear(input: unknown): number | null {
    if (input === null || input === undefined) return null;
    const raw = String(input).trim();
    if (!raw) return null;

    const match = raw.match(/\b(18|19|20)\d{2}\b/);
    if (!match) return null;
    const year = Number(match[0]);
    if (!Number.isFinite(year)) return null;
    return year;
  }

  private normalizeCoverUrl(value: unknown): string {
    return (value ?? '').toString().trim();
  }

  private dedupeShelfDetails(details: FormatShelfDetail[]): FormatShelfDetail[] {
    const out: FormatShelfDetail[] = [];
    const seen = new Set<string>();

    for (const d of details) {
      const key = `${d.location}|${d.callNumber}|${d.status}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(d);
    }

    return out;
  }

  private cleanTitlePart(value: any): string {
    const text = (value ?? '').toString().trim();
    if (!text) return '';
    return text
      .replace(/\s*\/+\s*$/, '')
      .replace(/\s+:\s+/g, ': ')
      .trim();
  }

  private dismissPayload(): any {
    const payload: any = {};
    if (this.needsHoldsRefresh) {
      payload.refreshHolds = true;
      payload.groupedWorkId = (this.hit?.key ?? '').toString().trim();
      payload.holdsForItem = [...(this.holdsForItem ?? [])];
    }
    if (this.needsCheckoutsRefresh) payload.refreshCheckouts = true;
    if (this.needsListRefresh) payload.refreshList = true;
    return Object.keys(payload).length ? payload : undefined;
  }
}
