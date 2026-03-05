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
  ilsNotReady: AspenHold[] = [];

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
      this.ilsNotReady = [];
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

  refresh(ev?: any, opts?: { suppressErrorToast?: boolean }) {
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
          if (!opts?.suppressErrorToast) {
            this.toast.presentToast('Could not refresh holds.');
          }
        },
      });
  }

  private partitionIlsHolds(holds: AspenHold[]) {
    const ready: AspenHold[] = [];
    const notReady: AspenHold[] = [];

    for (const h of holds ?? []) {
      if (this.holdDisplayState(h) === 'ready') ready.push(h);
      else notReady.push(h);
    }

    notReady.sort((a, b) => {
      const aFrozen = this.holdDisplayState(a) === 'frozen';
      const bFrozen = this.holdDisplayState(b) === 'frozen';
      if (aFrozen !== bFrozen) return aFrozen ? 1 : -1;

      const aPos = Number(a?.position ?? Number.MAX_SAFE_INTEGER);
      const bPos = Number(b?.position ?? Number.MAX_SAFE_INTEGER);
      return aPos - bPos;
    });

    this.ilsReady = ready;
    this.ilsNotReady = notReady;
  }

  holdTitle(h: AspenHold): string {
    const raw = (h?.title ?? '').toString().trim();
    if (!raw) return 'Untitled';
    return (
      raw
        .replace(/\s*\/+\s*$/, '')
        .replace(/\s+:\s+/g, ': ')
        .trim() || raw
    );
  }

  holdAuthor(h: AspenHold): string {
    const a = (h?.author ?? '').toString().trim();
    return a.replace(/\s+$/, '');
  }

  holdStatus(h: AspenHold): string {
    switch (this.holdDisplayState(h)) {
      case 'ready':
        return 'Ready for pickup';
      case 'frozen':
        return 'Suspended';
      default:
        return 'Active';
    }
  }

  holdStatusClass(h: AspenHold): string {
    switch (this.holdDisplayState(h)) {
      case 'ready':
        return 'status-ready';
      case 'frozen':
        return 'status-suspended';
      default:
        return 'status-active';
    }
  }

  holdIsFrozen(h: AspenHold): boolean {
    return this.holdDisplayState(h) === 'frozen';
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
    const buttons: ActionSheetButton[] = [];

    if (!this.holdIsReady(h)) {
      buttons.push(
        {
          text: frozen ? 'Activate hold' : 'Suspend hold',
          handler: () => this.toggleHoldFrozen(h),
        },
        {
          text: 'Change pickup location',
          handler: () => this.changePickupLocation(h),
        },
      );
    }

    buttons.push(
      {
        text: 'Cancel Hold',
        role: 'destructive',
        handler: () => this.cancelHoldNow(h),
      },
      {
        text: 'View details',
        handler: () => this.openHold(h),
      },
      {
        text: 'Close',
        role: 'cancel',
      },
    );

    const sheet = await this.actionSheet.create({
      header: this.holdTitle(h),
      buttons,
    });

    await sheet.present();
  }

  private toggleHoldFrozen(h: AspenHold) {
    if (this.isHoldActionBusy(h)) return;
    if (this.holdIsReady(h)) return;

    const key = this.holdActionKey(h);
    if (!key) return;
    this.holdActionBusyKeys.add(key);

    const op$ = this.holdIsFrozen(h) ? this.holds.thawHold(h) : this.holds.freezeHold(h);
    op$
      .pipe(finalize(() => this.holdActionBusyKeys.delete(key)))
      .subscribe({
        next: (res) => {
          if (!res?.success) {
            this.toast.presentToast(this.holdIsFrozen(h) ? 'Could not activate hold.' : 'Could not suspend hold.');
            return;
          }

          const nowFrozen = !this.holdIsFrozen(h);
          this.applyHoldFrozenState(h, nowFrozen);

          this.toast.presentToast(nowFrozen ? 'Hold suspended.' : 'Hold activated.');
        },
        error: () => this.toast.presentToast(this.holdIsFrozen(h) ? 'Could not activate hold.' : 'Could not suspend hold.'),
      });
  }

  private async changePickupLocation(h: AspenHold) {
    if (this.isHoldActionBusy(h)) return;
    if (this.holdIsReady(h)) return;

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
    buttons.push({ text: 'Close', role: 'cancel' });

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
          void this.persistLocalHolds();
        },
        error: () => this.toast.presentToast('Could not change pickup location.'),
      });
  }

  private cancelHoldNow(h: AspenHold) {
    if (this.isHoldActionBusy(h)) return;

    const key = this.holdActionKey(h);
    if (!key) return;
    this.holdActionBusyKeys.add(key);

    this.holds
      .cancelHold(h)
      .pipe(finalize(() => this.holdActionBusyKeys.delete(key)))
      .subscribe({
        next: async (res) => {
          if (!res?.success) {
            this.toast.presentToast(res?.message || 'Could not cancel hold.');
            return;
          }

          this.removeHoldFromLists(h);
          this.toast.presentToast(res?.message || 'Hold cancelled.');

          const snap = this.auth.snapshot();
          if (snap.isLoggedIn && snap.activeAccountId) {
            await this.persistLocalHolds();
          }

          this.auth.refreshActiveProfile().subscribe({ error: () => {} });
        },
        error: () => this.toast.presentToast('Could not cancel hold.'),
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
    return (this.ilsReady?.length ?? 0) > 0 || (this.ilsNotReady?.length ?? 0) > 0;
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

  private applyHoldFrozenState(hold: AspenHold, frozen: boolean) {
    const key = this.holdActionKey(hold);
    const match = this.findHoldByKey(key);
    if (!match) return;

    (match as any).frozen = frozen;
    (match as any).statusMessage = frozen ? 'Suspended' : 'Active';
    (match as any).status = frozen ? 'Suspended' : 'Pending';

    this.partitionIlsHolds([...this.ilsReady, ...this.ilsNotReady]);
    void this.persistLocalHolds();
  }

  private removeHoldFromLists(hold: AspenHold) {
    const key = this.holdActionKey(hold);
    this.ilsReady = this.ilsReady.filter((h) => this.holdActionKey(h) !== key);
    this.ilsNotReady = this.ilsNotReady.filter((h) => this.holdActionKey(h) !== key);
  }

  private findHoldByKey(key: string): AspenHold | null {
    if (!key) return null;
    return (
      this.ilsReady.find((h) => this.holdActionKey(h) === key) ??
      this.ilsNotReady.find((h) => this.holdActionKey(h) === key) ??
      null
    );
  }

  private async persistLocalHolds() {
    const snap = this.auth.snapshot();
    if (!snap.activeAccountId) return;
    await this.holds.setCachedHolds(snap.activeAccountId, [...this.ilsReady, ...this.ilsNotReady]);
  }

  private holdDisplayState(h: AspenHold): 'ready' | 'active' | 'frozen' {
    if (h?.available === true) return 'ready';

    const statusBits = [
      (h?.statusMessage ?? '').toString().toLowerCase(),
      (h?.status ?? '').toString().toLowerCase(),
    ]
      .join(' ')
      .trim();

    if (statusBits.includes('ready to pickup') || statusBits.includes('ready for pickup')) {
      return 'ready';
    }

    if ((h as any)?.frozen === true) return 'frozen';
    if (statusBits.includes('frozen') || statusBits.includes('suspend') || statusBits.includes('suspended')) {
      return 'frozen';
    }

    return 'active';
  }

  private holdIsReady(h: AspenHold): boolean {
    return this.holdDisplayState(h) === 'ready';
  }
}
