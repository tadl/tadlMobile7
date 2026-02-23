import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonicModule,
  ActionSheetController,
  ModalController,
  type ActionSheetButton,
} from '@ionic/angular';
import { Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';
import { firstValueFrom } from 'rxjs';

import { Globals } from '../../globals';
import { ToastService } from '../../services/toast.service';
import { ItemService, AspenGroupedWork } from '../../services/item.service';
import { AspenSearchHit } from '../../services/search.service';
import { HoldsService } from '../../services/holds.service';
import type { AspenHold } from '../../services/holds.service';
import { CheckoutsService } from '../../services/checkouts.service';
import type { AspenCheckout } from '../../services/checkouts.service';
import { ListsService, type AspenUserList } from '../../services/lists.service';

interface ItemDetailListContext {
  listId: string;
  listTitle?: string;
  recordId?: string;
}

interface KnownListMembership {
  listId: string;
  listTitle: string;
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
    private items: ItemService,
    private holds: HoldsService,
    private checkouts: CheckoutsService,
    private lists: ListsService,
    private router: Router,
    private modalCtrl: ModalController, // ✅ renamed from "modal"
    private actionSheet: ActionSheetController,
  ) {}

  ngOnInit() {
    // If opened from Holds/Checkouts pages, we already have the object in hit.raw
    this.hold = this.extractHoldFromHit(this.hit);
    this.checkout = this.extractCheckoutFromHit(this.hit);
    this.seedKnownListMemberships();
    this.refreshKnownListMembershipsFromServer();

    const key = (this.hit?.key ?? '').toString().trim();
    if (!key) return;

    this.items.getGroupedWork(key).subscribe({
      next: (w) => {
        this.work = w ?? null;
        this.descriptionExpanded = false;
        this.loadHoldingsCountsForWork(this.work);

        // Attach hold/checkout for this grouped work so cards appear even when opened from Search
        this.refreshHoldForThisItem();
        this.refreshCheckoutForThisItem();
      },
      error: () => this.toast.presentToast('Could not load item details.'),
    });
  }

  close() {
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
    try {
      const lists = await firstValueFrom(this.lists.fetchUserLists());
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
          this.toast.presentToast(res?.message || 'Removed from list.');
        },
        error: () => this.toast.presentToast('Could not remove from list.'),
      });
  }

  private seedKnownListMemberships() {
    const listId = (this.listContext?.listId ?? '').toString().trim();
    if (!listId) return;

    const listTitle = (this.listContext?.listTitle ?? '').toString().trim() || 'This list';
    this.knownListMemberships = [{ listId, listTitle }];
  }

  private async refreshKnownListMembershipsFromServer() {
    const recordId = this.listRecordId();
    if (!recordId) return;

    try {
      const lists = await firstValueFrom(this.lists.fetchUserLists());
      if (!lists?.length) return;

      const candidates = lists.filter((l) => Number((l as any)?.numTitles ?? 0) > 0);
      if (!candidates.length) {
        if (!this.knownListMemberships.length) this.knownListMemberships = [];
        return;
      }

      const checks = await Promise.all(
        candidates.map(async (list) => {
          const listId = (list?.id ?? '').toString().trim();
          if (!listId) return null;
          try {
            const res = await firstValueFrom(this.lists.fetchListTitles(listId, 1, 500));
            if (!res?.success || !Array.isArray(res?.titles)) return null;
            const found = res.titles.some((t) => ((t?.id ?? t?.shortId ?? '') as any).toString().trim() === recordId);
            if (!found) return null;
            return {
              listId,
              listTitle: (list?.title ?? '').toString().trim() || 'List',
            } as KnownListMembership;
          } catch {
            return null;
          }
        }),
      );

      const found = checks.filter((x): x is KnownListMembership => !!x);
      if (found.length) {
        this.knownListMemberships = found;
      }
    } catch {
      // Keep local optimistic memberships if API probing fails.
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
    if (raw) return raw;
    return this.holdIsFrozen() ? 'Frozen' : 'Active';
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
            this.toast.presentToast(res?.message || 'Could not suspend hold.');
            return;
          }

          this.needsHoldsRefresh = true;

          // optimistic UI update
          (this.hold as any).frozen = true;
          (this.hold as any).statusMessage = 'Frozen';

          this.toast.presentToast(res?.message || 'Hold suspended.');

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
            this.toast.presentToast(res?.message || 'Could not activate hold.');
            return;
          }

          this.needsHoldsRefresh = true;

          // optimistic UI update
          (this.hold as any).frozen = false;
          (this.hold as any).statusMessage = 'Active';

          this.toast.presentToast(res?.message || 'Hold activated.');

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
    return `${count} ${count === 1 ? 'holding' : 'holdings'}`;
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

  async handleFormatAction(action: any, formatKey: string) {
    const url = (action?.url ?? '').toString().trim();
    if (url) {
      this.globals.open_page(url);
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
        error: () => this.toast.presentToast('Could not place hold.'),
      });
  }

  private loadHoldingsCountsForWork(work: AspenGroupedWork | null) {
    if (!work?.formats) return;

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

      if (ilsId) requests.push({ formatKey, ilsId });
    }

    if (!requests.length) return;

    const calls = requests.map((r) =>
      this.items.getIlsItemAvailability(r.ilsId).pipe(catchError(() => of(null))),
    );

    forkJoin(calls).subscribe({
      next: (results) => {
        const byFormat: Record<string, number> = {};

        for (let i = 0; i < results.length; i++) {
          const res: any = results[i];
          const fmtKey = requests[i].formatKey;

          let total = 0;
          const holdings = res?.holdings;
          if (holdings && typeof holdings === 'object') {
            for (const k of Object.keys(holdings)) {
              const arr = holdings[k];
              if (Array.isArray(arr)) total += arr.length;
            }
          }

          byFormat[fmtKey] = total;
        }

        this.holdingsCountByFormat = byFormat;
      },
      error: () => {},
    });
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
}
