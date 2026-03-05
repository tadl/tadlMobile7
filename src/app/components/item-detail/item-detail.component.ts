import { Component, Input, OnInit } from '@angular/core';
import { CommonModule, KeyValue } from '@angular/common';
import {
  IonicModule,
  ActionSheetController,
  AlertController,
  ModalController,
  type ActionSheetButton,
} from '@ionic/angular';
import { Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
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
import { ListMembershipIndexService } from '../../services/list-membership-index.service';
import { AccountPreferencesService } from '../../services/account-preferences.service';

interface ItemDetailListContext {
  listId: string;
  listTitle?: string;
  recordId?: string;
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

@Component({
  standalone: true,
  selector: 'app-item-detail',
  templateUrl: './item-detail.component.html',
  styleUrls: ['./item-detail.component.scss'],
  imports: [CommonModule, IonicModule],
})
export class ItemDetailComponent implements OnInit {
  @Input() hit!: AspenSearchHit;
  @Input() listContext: ItemDetailListContext | null = null;

  work: AspenGroupedWork | null = null;

  /** if we got here from HoldsPage, it passes the hold as hit.raw */
  hold: AspenHold | null = null;

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

  holdActionBusy = false;
  checkoutActionBusy = false;
  listActionBusy = false;

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
    private membershipIndex: ListMembershipIndexService,
    private accountPreferences: AccountPreferencesService,
    private router: Router,
    private modalCtrl: ModalController, // ✅ renamed from "modal"
    private actionSheet: ActionSheetController,
    private alertCtrl: AlertController,
  ) {}

  ngOnInit() {
    // If opened from Holds/Checkouts pages, we already have the object in hit.raw
    this.hold = this.extractHoldFromHit(this.hit);
    this.checkout = this.extractCheckoutFromHit(this.hit);
    void this.seedKnownListMemberships();

    const key = (this.hit?.key ?? '').toString().trim();
    if (!key) return;

    this.items.getGroupedWork(key).subscribe({
      next: (w) => {
        this.work = w ?? null;
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

  close() {
    this.copyDetailsModalOpen = false;
    const payload: any = {};
    if (this.needsHoldsRefresh) payload.refreshHolds = true;
    if (this.needsCheckoutsRefresh) payload.refreshCheckouts = true;
    if (this.needsListRefresh) payload.refreshList = true;

    this.modalCtrl.dismiss(Object.keys(payload).length ? payload : undefined);
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
    return !!this.listRecordId();
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

  async addToAnyList() {
    if (this.listActionBusy || !this.canManageLists()) return;
    const recordId = this.listRecordId();
    if (!recordId) return;

    const lists = await this.getListsForAction();
    if (!lists.length) return;

    const sheet = await this.actionSheet.create({
      header: 'Add to which list?',
      buttons: [
        ...lists.map((list): ActionSheetButton => ({
          text: this.actionListLabel(list),
          handler: () => this.addRecordToList(list, recordId),
        })),
        { text: 'Cancel', role: 'cancel' },
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
        { text: 'Cancel', role: 'cancel' },
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
      const lists = await lastValueFrom(this.lists.fetchUserLists());
      if (!lists?.length) {
        this.toast.presentToast('You do not have any lists yet.');
        return [];
      }
      return lists;
    } catch {
      this.toast.presentToast('Could not load your lists.');
      return [];
    }
  }

  private actionListLabel(list: AspenUserList): string {
    const title = (list?.title ?? '').toString().trim() || 'Untitled list';
    const n = Number((list as any)?.numTitles ?? 0);
    if (Number.isFinite(n) && n > 0) return `${title} (${n})`;
    return title;
  }

  private addRecordToList(list: AspenUserList, recordId: string) {
    const listId = (list?.id ?? '').toString().trim();
    if (!listId || !recordId) return;
    if (this.listActionBusy) return;

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
          this.membershipIndex
            .upsertMembership(recordId, listId, (list?.title ?? '').toString().trim() || 'Untitled list')
            .catch(() => {});
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
        { text: 'Cancel', role: 'cancel' },
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
          this.membershipIndex.removeMembership(recordId, listId).catch(() => {});
          this.toast.presentToast(res?.message || 'Removed from list.');
        },
        error: () => this.toast.presentToast('Could not remove from list.'),
      });
  }

  private async seedKnownListMemberships() {
    const fromHit = (this.hit?.appearsOnLists ?? [])
      .map((x) => {
        const listId = (x?.id ?? '').toString().trim();
        const listTitle = (x?.title ?? '').toString().trim() || 'List';
        if (!listId) return null;
        return { listId, listTitle } as KnownListMembership;
      })
      .filter((x): x is KnownListMembership => !!x);

    if (fromHit.length) {
      this.knownListMemberships = fromHit;
      return;
    }

    const listId = (this.listContext?.listId ?? '').toString().trim();
    if (listId) {
      const listTitle = (this.listContext?.listTitle ?? '').toString().trim() || 'This list';
      this.knownListMemberships = [{ listId, listTitle }];
      return;
    }

    try {
      const recordId = this.listRecordId();
      if (!recordId) return;
      const indexed = await this.membershipIndex.membershipsForRecord(recordId);
      if (indexed.length) {
        this.knownListMemberships = indexed
          .map((x) => ({
            listId: (x?.listId ?? '').toString().trim(),
            listTitle: (x?.listTitle ?? '').toString().trim() || 'List',
          }))
          .filter((x) => !!x.listId);
      }
    } catch {
      // Keep UI stable if index read fails/unavailable.
    }
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

  async openListMembershipActions(m: KnownListMembership, ev?: Event) {
    ev?.stopPropagation?.();
    if (!m?.listId) return;

    const sheet = await this.actionSheet.create({
      header: m.listTitle || 'List actions',
      buttons: [
        {
          text: 'View list',
          handler: () => this.openKnownList(m.listId, m.listTitle),
        },
        {
          text: 'Remove from this list',
          role: 'destructive',
          handler: () =>
            this.confirmRemoveFromNamedList(
              { id: m.listId, title: m.listTitle } as AspenUserList,
              this.listRecordId(),
            ),
        },
        { text: 'Cancel', role: 'cancel' },
      ],
    });

    await sheet.present();
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

          // Authoritative refresh so due date / canRenew updates
          this.refreshCheckoutForThisItem(true);
        },
        error: () => this.toast.presentToast('Could not renew.'),
      });
  }

  // ----------------------------
  // Hold card helpers
  // ----------------------------

  holdIsFrozen(): boolean {
    const h: any = this.hold;
    if (!h) return false;
    if (h?.frozen === true) return true;
    const status = (h?.statusMessage ?? h?.status ?? '').toString().toLowerCase();
    return status.includes('frozen') || status.includes('suspend') || status.includes('suspended');
  }

  holdStatusText(): string {
    const h: any = this.hold;
    if (!h) return '';
    const raw = (h?.statusMessage ?? h?.status ?? '').toString().trim();
    if (raw && /ready/i.test(raw)) return raw;
    return this.holdIsFrozen() ? 'Suspended' : 'Active';
  }

  holdStatusClass(): string {
    const txt = this.holdStatusText().toLowerCase();
    if (txt.includes('ready')) return 'status-ready';
    if (txt.includes('suspend')) return 'status-suspended';
    return 'status-active';
  }

  holdPickupText(): string {
    const h: any = this.hold;
    if (!h) return '';
    const name = (h?.pickupLocationName ?? h?.currentPickupName ?? '').toString().trim();
    return name ? `Pickup: ${name}` : '';
  }

  holdPositionText(): string {
    const h: any = this.hold;
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

  freezeHold() {
    if (!this.hold || this.holdActionBusy) return;

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

          this.toast.presentToast('Hold suspended.');

          // authoritative refresh (ensures pickup/status/etc stays correct)
          this.refreshHoldForThisItem();
        },
        error: () => this.toast.presentToast('Could not suspend hold.'),
      });
  }

  thawHold() {
    if (!this.hold || this.holdActionBusy) return;

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

          this.toast.presentToast('Hold activated.');

          // authoritative refresh
          this.refreshHoldForThisItem();
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

          this.toast.presentToast(res?.message || 'Hold cancelled.');
          const canceledId = Number(this.hold?.cancelId ?? this.hold?.id ?? 0) || null;
          this.modalCtrl.dismiss({ refreshHolds: true, canceledHoldId: canceledId });
          this.globals.modal_open = false;
        },
        error: () => this.toast.presentToast('Could not cancel hold.'),
      });
  }

  async changePickupLocation() {
    if (!this.hold || this.holdActionBusy) return;

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

    buttons.push({ text: 'Cancel', role: 'cancel' });

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

          this.toast.presentToast(res?.message || 'Pickup location updated.');

          // authoritative refresh so the UI reflects server truth
          this.refreshHoldForThisItem();
        },
        error: () => this.toast.presentToast('Could not change pickup location.'),
      });
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
          coverUrl: (this.work?.cover ?? this.hit?.coverUrl ?? '').toString().trim(),
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
    const h: any = this.hold;
    if (!h) return false;

    const f = h?.['format'];
    const wanted = (formatKey ?? '').toString().trim().toLowerCase();
    if (!wanted) return false;

    if (Array.isArray(f)) {
      return f.some((x: any) => (x ?? '').toString().trim().toLowerCase() === wanted);
    }
    if (typeof f === 'string') {
      return f.trim().toLowerCase() === wanted;
    }

    return false;
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
      await this.globals.open_external_page(url);
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
    buttons.push({ text: 'Cancel', role: 'cancel' });

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
          this.toast.presentToast(res?.message || 'Hold placed.');

          // fetch holds and attach the hold for this grouped work so the card appears
          this.refreshHoldForThisItem();
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

    const alert = await this.alertCtrl.create({
      header,
      message: 'Enter your library card / username and password.',
      inputs: [
        {
          name: 'username',
          type: 'text',
          value: (snap?.activeAccountMeta?.username ?? '').toString(),
          placeholder: 'Library card / username',
          attributes: {
            autocapitalize: 'off',
            autocorrect: 'off',
            autocomplete: 'off',
            spellcheck: 'false',
          },
        },
        {
          name: 'password',
          type: 'password',
          placeholder: 'PIN / password',
          attributes: {
            autocapitalize: 'off',
            autocorrect: 'off',
            autocomplete: 'off',
            spellcheck: 'false',
          },
        },
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Log in',
          role: 'confirm',
          handler: (v) => ({
            username: (v?.username ?? '').toString().trim(),
            password: (v?.password ?? '').toString(),
          }),
        },
      ],
    });

    await alert.present();
    const { role, data } = await alert.onDidDismiss<{
      username: string;
      password: string;
    }>();
    if (role !== 'confirm') return false;

    const username = (data?.username ?? '').toString().trim();
    const password = (data?.password ?? '').toString();
    if (!username || !password) {
      this.toast.presentToast('Username and password are required.');
      return false;
    }

    try {
      await lastValueFrom(this.auth.login(username, password));
      return true;
    } catch (e: any) {
      const msg = (e?.message ?? '').toString();
      if (msg === 'invalid_login') {
        this.toast.presentToast('Login failed. Check your username/password and try again.');
      } else {
        this.toast.presentToast('Login failed. Please try again.');
      }
      return false;
    }
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
      const isDigitalProvider =
        source === 'overdrive' ||
        source === 'hoopla' ||
        providerLabel.toLowerCase().includes('libby') ||
        providerLabel.toLowerCase().includes('hoopla');

      if (!isDigitalProvider) continue;

      out.push({
        providerLabel: providerLabel || source || 'Provider',
        source,
        groupedStatus: (variation?.statusIndicator?.groupedStatus ?? '').toString().trim(),
        numCopiesMessage: (variation?.statusIndicator?.numCopiesMessage ?? '').toString().trim(),
        isAvailable: !!variation?.statusIndicator?.isAvailable,
      });
    }

    return out;
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

    if (key.includes('kindle') || key.includes('ebook') || key.includes('eaudiobook')) return true;
    if (category.includes('ebook')) return true;

    for (const a of actions) {
      const title = (a?.title ?? '').toString().toLowerCase();
      const type = (a?.type ?? '').toString().toLowerCase();
      const url = (a?.url ?? '').toString().toLowerCase();
      if (title.includes('libby') || title.includes('hoopla')) return true;
      if (type.includes('overdrive') || type.includes('hoopla')) return true;
      if (url.includes('overdrive.com') || url.includes('hoopladigital.com')) return true;
    }

    return false;
  }

  private extractDigitalProviderActions(result: AspenFormatVariationsResult | null): FormatProviderAction[] {
    if (!result?.variations || typeof result.variations !== 'object') return [];

    const out: FormatProviderAction[] = [];
    for (const variation of Object.values(result.variations)) {
      const source = (variation?.source ?? '').toString().trim().toLowerCase();
      if (source !== 'overdrive' && source !== 'hoopla') continue;

      for (const action of variation?.actions ?? []) {
        if (this.isPreviewAction(action)) continue;
        const url = (action?.url ?? '').toString().trim();
        if (!url) continue;

        let title = (action?.title ?? '').toString().trim() || 'Open';
        if (this.isGenericAccessAction(action)) {
          title = source === 'overdrive' ? 'Access in Libby' : 'Access in Hoopla';
        }

        out.push({ title, url, source });
      }
    }
    return out;
  }

  private refreshHoldForThisItem() {
    const key = (this.hit?.key ?? '').toString().trim();
    if (!key) return;

    if (this.hold && String((this.hold as any)?.groupedWorkId ?? '').trim() === key) return;

    if (this.holdRefreshBusy) return;
    this.holdRefreshBusy = true;

    this.holds.fetchActiveHolds()
      .pipe(finalize(() => (this.holdRefreshBusy = false)))
      .subscribe({
        next: (list) => {
          const found =
            (list ?? []).find(h => String((h as any)?.groupedWorkId ?? '').trim() === key) ?? null;
          if (found) this.hold = found;
        },
        error: () => {},
      });
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
}
