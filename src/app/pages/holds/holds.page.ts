import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
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

  // We’re only showing ILS holds here (per your direction)
  ilsReady: AspenHold[] = [];
  ilsPending: AspenHold[] = [];

  constructor(
    public globals: Globals,
    private toast: ToastService,
    private auth: AuthService,
    private holds: HoldsService,
    private modal: ModalController,
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

    // 1) Load cache immediately (no spinner-jank)
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

    // show spinner only if we had nothing cached
    this.loading = !this.hydratedFromCache;

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
    return (h?.title ?? '').toString().trim() || 'Untitled';
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
      catalogUrl: `${this.globals.aspen_base}/GroupedWork/${encodeURIComponent(key)}`,
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

  trackByHold(_idx: number, h: AspenHold) {
    return (h as any)?.id ?? (h as any)?.recordId ?? (h as any)?.groupedWorkId ?? _idx;
  }

  get hasAnyData(): boolean {
    return (this.ilsReady?.length ?? 0) > 0 || (this.ilsPending?.length ?? 0) > 0;
  }
}
