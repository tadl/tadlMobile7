import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonicModule,
  ActionSheetController,
  ModalController,
  type ActionSheetButton,
} from '@ionic/angular';
import { forkJoin, of } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';

import { Globals } from '../../globals';
import { ToastService } from '../../services/toast.service';
import { ItemService, AspenGroupedWork } from '../../services/item.service';
import { AspenSearchHit } from '../../services/search.service';
import { HoldsService } from '../../services/holds.service';
import type { AspenHold } from '../../services/holds.service';
import { CheckoutsService } from '../../services/checkouts.service';
import type { AspenCheckout } from '../../services/checkouts.service';

@Component({
  standalone: true,
  selector: 'app-item-detail',
  templateUrl: './item-detail.component.html',
  styleUrls: ['./item-detail.component.scss'],
  imports: [CommonModule, IonicModule],
})
export class ItemDetailComponent implements OnInit {
  @Input() hit!: AspenSearchHit;

  work: AspenGroupedWork | null = null;

  /** if we got here from HoldsPage, it passes the hold as hit.raw */
  hold: AspenHold | null = null;

  /** if we got here from CheckoutsPage, it passes the checkout as hit.raw */
  checkout: AspenCheckout | null = null;

  /** format label -> holdings count */
  private holdingsCountByFormat: Record<string, number> = {};

  holdActionBusy = false;
  checkoutActionBusy = false;

  /** set to true when we mutate holds so HoldsPage can refresh on dismiss */
  private needsHoldsRefresh = false;

  /** set to true when we mutate checkouts so CheckoutsPage can refresh on dismiss */
  private needsCheckoutsRefresh = false;

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
    private modalCtrl: ModalController, // ✅ renamed from "modal"
    private actionSheet: ActionSheetController,
  ) {}

  ngOnInit() {
    // If opened from Holds/Checkouts pages, we already have the object in hit.raw
    this.hold = this.extractHoldFromHit(this.hit);
    this.checkout = this.extractCheckoutFromHit(this.hit);

    const key = (this.hit?.key ?? '').toString().trim();
    if (!key) return;

    this.items.getGroupedWork(key).subscribe({
      next: (w) => {
        this.work = w ?? null;
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

    this.modalCtrl.dismiss(Object.keys(payload).length ? payload : undefined);
    this.globals.modal_open = false;
  }

  openCatalog() {
    if (this.hit?.catalogUrl) this.globals.open_page(this.hit.catalogUrl);
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
}
