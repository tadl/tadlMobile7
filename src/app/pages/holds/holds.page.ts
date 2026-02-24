import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController, ActionSheetController, type ActionSheetButton } from '@ionic/angular';
import { finalize } from 'rxjs';

import { Globals } from '../../globals';
import { ToastService } from '../../services/toast.service';
import { AuthService } from '../../services/auth.service';
import { HoldsService, AspenHold } from '../../services/holds.service';
import { ItemDetailComponent } from '../../components/item-detail/item-detail.component';
import { AspenSearchHit } from '../../services/search.service';

@Component({
  standalone: true,
  selector: 'app-holds',
  templateUrl: './holds.page.html',
  styleUrls: ['./holds.page.scss'],
  imports: [CommonModule, IonicModule],
})
export class HoldsPage {
  loading = false;
  hydratedFromCache = false;
  private holdActionBusyKeys = new Set<string>();

  // We’re only showing ILS holds here (per your direction)
  ilsReady: AspenHold[] = [];
  ilsPending: AspenHold[] = [];

  constructor(
    public globals: Globals,
    private toast: ToastService,
    private auth: AuthService,
    private holds: HoldsService,
    private modal: ModalController,
    private actionSheet: ActionSheetController,
  ) {}

  async ionViewWillEnter() {
    await this.loadCacheThenRefresh();
  }

  async loadCacheThenRefresh() {
    const snap = this.auth.snapshot();
    if (!snap.isLoggedIn || !snap.activeAccountId) {
      this.ilsReady = [];
      this.ilsPending = [];
      return;
    }

    try {
      const cached = await this.holds.getCachedHolds(snap.activeAccountId);
      if (cached?.holds?.length) {
        this.hydratedFromCache = true;
        this.partitionIlsHolds(cached.holds);
      } else {
        this.hydratedFromCache = false;
      }
    } catch {
      this.hydratedFromCache = false;
    }

    // 2) Refresh from network
    this.refresh();
  }

  refresh(ev?: any) {
    if (this.loading) {
      ev?.target?.complete?.();
      return;
    }

    const snap = this.auth.snapshot();
    if (!snap.isLoggedIn || !snap.activeAccountId) {
      ev?.target?.complete?.();
      return;
    }

    this.loading = true;

    this.holds
      .fetchActiveHolds()
      .pipe(
        finalize(() => {
          this.loading = false;
          ev?.target?.complete?.();
        }),
      )
      .subscribe({
        next: async (allHolds) => {
          const ilsOnly = (allHolds ?? []).filter(h => (h?.type === 'ils' || h?.source === 'ils'));
          this.partitionIlsHolds(ilsOnly);

          try {
            await this.holds.setCachedHolds(snap.activeAccountId!, ilsOnly);
          } catch {
            // ignore cache write failures
          }
        },
        error: () => {
          this.toast.presentToast('Could not refresh holds.');
        },
      });
  }

  private partitionIlsHolds(holds: AspenHold[]) {
    const ready: AspenHold[] = [];
    const pending: AspenHold[] = [];

    for (const h of holds ?? []) {
      const isReady =
        h?.['available'] === true ||
        (typeof h?.status === 'string' && h.status.toLowerCase().includes('ready')) ||
        (typeof h?.statusMessage === 'string' && h.statusMessage.toLowerCase().includes('ready'));

      if (isReady) ready.push(h);
      else pending.push(h);
    }

    this.ilsReady = ready;
    this.ilsPending = pending;
  }

  holdTitle(h: AspenHold): string {
    const raw = (h?.title ?? '').toString().trim();
    if (!raw) return 'Untitled';
    return raw.replace(/\s*\/+\s*$/, '').trim() || raw;
  }

  holdAuthor(h: AspenHold): string {
    const a = (h?.author ?? '').toString().trim();
    return a.replace(/\s+$/, '');
  }

  holdStatus(h: AspenHold): string {
    const s = (h?.statusMessage ?? h?.status ?? '').toString().trim();
    if (s) return s;
    return h?.['available'] ? 'Available' : 'Pending';
  }

  holdIsFrozen(h: AspenHold): boolean {
    if ((h as any)?.frozen === true) return true;
    const status = (h?.statusMessage ?? h?.status ?? '').toString().toLowerCase();
    return status.includes('frozen') || status.includes('suspend') || status.includes('suspended');
  }

  async openHold(h: AspenHold) {
    const key = (h?.groupedWorkId ?? '').toString().trim();
    if (!key) {
      this.toast.presentToast('This hold is missing a grouped work id.');
      return;
    }

    const hit: AspenSearchHit = {
      key,
      title: this.holdTitle(h),
      author: this.holdAuthor(h) || undefined,
      coverUrl: h?.coverUrl,
      summary: undefined,
      language: undefined,
      format: h?.['format'], // TS4111-safe
      itemList: [],
      catalogUrl: `${this.globals.aspen_discovery_base}/GroupedWork/${encodeURIComponent(key)}`,
      raw: h,
    };

    const m = await this.modal.create({
      component: ItemDetailComponent,
      componentProps: { hit },
    });

    this.globals.modal_open = true;

    // IMPORTANT: react to changes from the modal
    m.onDidDismiss().then((res) => {
      const data = res?.data;
      if (data?.refreshHolds) {
        // refresh list + cache (your refresh() already writes cache)
        this.hydratedFromCache = true; // prevents spinner-jank
        this.refresh();

        // refresh badges/counts in the account menu
        this.auth.refreshActiveProfile().subscribe({
          error: () => {}, // ignore; holds refresh is the priority
        });
      }
    });

    await m.present();
  }

  async openHoldActions(h: AspenHold, ev?: Event) {
    ev?.stopPropagation();
    ev?.preventDefault();

    if (this.isHoldActionBusy(h)) return;

    const frozen = this.holdIsFrozen(h);
    const buttons: ActionSheetButton[] = [
      {
        text: frozen ? 'Activate hold' : 'Suspend hold',
        handler: () => this.toggleHoldFrozen(h),
      },
      {
        text: 'Change pickup location',
        handler: () => this.changePickupLocation(h),
      },
      {
        text: 'View details',
        handler: () => this.openHold(h),
      },
      {
        text: 'Cancel',
        role: 'cancel',
      },
    ];

    const sheet = await this.actionSheet.create({
      header: this.holdTitle(h),
      buttons,
    });

    await sheet.present();
  }

  private toggleHoldFrozen(h: AspenHold) {
    if (this.isHoldActionBusy(h)) return;

    const key = this.holdActionKey(h);
    if (!key) return;
    this.holdActionBusyKeys.add(key);

    const op$ = this.holdIsFrozen(h) ? this.holds.thawHold(h) : this.holds.freezeHold(h);
    op$
      .pipe(finalize(() => this.holdActionBusyKeys.delete(key)))
      .subscribe({
        next: (res) => {
          if (!res?.success) {
            this.toast.presentToast(res?.message || 'Could not update hold.');
            return;
          }

          (h as any).frozen = !this.holdIsFrozen(h);
          (h as any).statusMessage = (h as any).frozen ? 'Frozen' : 'Active';

          this.toast.presentToast(res?.message || ((h as any).frozen ? 'Hold suspended.' : 'Hold activated.'));
          this.refresh();
          this.auth.refreshActiveProfile().subscribe({ error: () => {} });
        },
        error: () => this.toast.presentToast('Could not update hold.'),
      });
  }

  private async changePickupLocation(h: AspenHold) {
    if (this.isHoldActionBusy(h)) return;

    const holdId = Number((h as any)?.cancelId ?? (h as any)?.id ?? 0) || 0;
    if (!holdId) {
      this.toast.presentToast('This hold is missing a hold id.');
      return;
    }

    const currentCode = ((h as any)?.currentPickupId ?? '').toString().trim();
    const currentName = ((h as any)?.pickupLocationName ?? (h as any)?.currentPickupName ?? '').toString().trim();
    const buttons: ActionSheetButton[] = this.globals.pickupLocations.map((loc) => ({
      text: loc.code === currentCode ? `${loc.name} (Current)` : loc.name,
      handler: () => this.changePickupLocationNow(h, holdId, this.globals.pickupAspenNewLocation(loc)),
    }));
    buttons.push({ text: 'Cancel', role: 'cancel' });

    const sheet = await this.actionSheet.create({
      header: 'Choose pickup location',
      subHeader: currentName ? `Currently: ${currentName}` : undefined,
      buttons,
    });

    await sheet.present();
  }

  private changePickupLocationNow(h: AspenHold, holdId: number, newLocation: string) {
    if (this.isHoldActionBusy(h)) return;

    const key = this.holdActionKey(h);
    if (!key) return;
    this.holdActionBusyKeys.add(key);

    const parsed = this.parseAspenNewLocation(newLocation);
    this.holds
      .changeHoldPickUpLocation(holdId, newLocation, null)
      .pipe(finalize(() => this.holdActionBusyKeys.delete(key)))
      .subscribe({
        next: (res) => {
          if (!res?.success) {
            this.toast.presentToast(res?.message || 'Could not change pickup location.');
            return;
          }

          if (parsed) {
            (h as any).currentPickupId = parsed.code;
            (h as any).currentPickupName = this.globals.pickupNameForCode(parsed.code) ?? (h as any).currentPickupName;
            (h as any).pickupLocationId = parsed.id;
            (h as any).pickupLocationName = this.globals.pickupNameForCode(parsed.code) ?? (h as any).pickupLocationName;
          }

          this.toast.presentToast(res?.message || 'Pickup location updated.');
          this.refresh();
        },
        error: () => this.toast.presentToast('Could not change pickup location.'),
      });
  }

  isHoldActionBusy(h: AspenHold): boolean {
    const key = this.holdActionKey(h);
    return !!key && this.holdActionBusyKeys.has(key);
  }

  trackByHold(_idx: number, h: AspenHold) {
    return (h as any)?.id ?? (h as any)?.recordId ?? (h as any)?.groupedWorkId ?? _idx;
  }

  get hasAnyData(): boolean {
    return (this.ilsReady?.length ?? 0) > 0 || (this.ilsPending?.length ?? 0) > 0;
  }

  private holdActionKey(h: AspenHold): string {
    const raw = (h as any)?.id ?? (h as any)?.cancelId ?? (h as any)?.recordId ?? (h as any)?.groupedWorkId ?? '';
    return String(raw).trim();
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
}
