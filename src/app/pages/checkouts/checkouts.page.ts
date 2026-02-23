import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { finalize } from 'rxjs';

import { Globals } from '../../globals';
import { ToastService } from '../../services/toast.service';
import { AuthService } from '../../services/auth.service';
import { CheckoutsService, type AspenCheckout } from '../../services/checkouts.service';
import { ItemDetailComponent } from '../../components/item-detail/item-detail.component';
import { AspenSearchHit } from '../../services/search.service';

@Component({
  standalone: true,
  selector: 'app-checkouts',
  templateUrl: './checkouts.page.html',
  styleUrls: ['./checkouts.page.scss'],
  imports: [CommonModule, IonicModule],
})
export class CheckoutsPage {
  loading = false;

  ilsCheckouts: AspenCheckout[] = [];

  constructor(
    public globals: Globals,
    private toast: ToastService,
    private auth: AuthService,
    private checkouts: CheckoutsService,
    private modalCtrl: ModalController,
  ) {}

  ionViewWillEnter() {
    this.refresh();
  }

  refresh(ev?: any) {
    if (this.loading) {
      ev?.target?.complete?.();
      return;
    }

    const snap = this.auth.snapshot();
    if (!snap.isLoggedIn || !snap.activeAccountId) {
      this.ilsCheckouts = [];
      ev?.target?.complete?.();
      return;
    }

    this.loading = true;

    this.checkouts
      .fetchActiveCheckouts()
      .pipe(
        finalize(() => {
          this.loading = false;
          ev?.target?.complete?.();
        }),
      )
      .subscribe({
        next: (list) => {
          this.ilsCheckouts = (list ?? []).slice().sort((a, b) => {
            const da = Number(a?.dueDate ?? 0);
            const db = Number(b?.dueDate ?? 0);
            return da - db;
          });
        },
        error: () => this.toast.presentToast('Could not refresh checkouts.'),
      });
  }

  checkoutTitle(c: AspenCheckout): string {
    const raw = (c?.title ?? '').toString().trim();
    if (!raw) return 'Untitled';

    // Aspen checkout titles are often full MARC-style strings:
    // "Main title : subtitle / statement of responsibility".
    // For list display, keep the concise main title only.
    const withoutResponsibility = raw.split(/\s+\/\s+/)[0]?.trim() ?? raw;
    const withoutSubtitle = withoutResponsibility.split(/\s+:\s+/)[0]?.trim() ?? withoutResponsibility;
    const cleaned = withoutSubtitle.replace(/[\s:\/]+$/, '').trim();

    return cleaned || raw || 'Untitled';
  }

  checkoutAuthor(c: AspenCheckout): string {
    return ((c?.author ?? '') as any)?.toString?.().trim?.() || '';
  }

  dueText(c: AspenCheckout): string {
    const due = Number(c?.dueDate ?? 0);
    if (!Number.isFinite(due) || due <= 0) return '';
    // dueDate is epoch seconds
    const dt = new Date(due * 1000);
    return dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }

  async openCheckout(c: AspenCheckout) {
    const key = (c?.groupedWorkId ?? '').toString().trim();

    // We prefer groupedWorkId; if missing, still open a minimal hit (no WorkAPI key => item detail won't load work)
    const hit: AspenSearchHit = {
      key: key || '',
      title: this.checkoutTitle(c),
      author: this.checkoutAuthor(c) || undefined,
      coverUrl: c?.coverUrl,
      summary: undefined,
      language: undefined,
      format: c?.format,
      itemList: [],
      catalogUrl: key ? `${this.globals.aspen_base}/GroupedWork/${encodeURIComponent(key)}` : undefined,
      raw: c,
    };

    const m = await this.modalCtrl.create({
      component: ItemDetailComponent,
      componentProps: { hit },
    });

    this.globals.modal_open = true;

    m.onDidDismiss().then((res) => {
      const data = res?.data;
      if (data?.refreshCheckouts) {
        this.refresh();
        this.auth.refreshActiveProfile().subscribe({ error: () => {} });
      }
    });

    await m.present();
  }

  trackByCheckout(_idx: number, c: AspenCheckout) {
    return (c as any)?.id ?? (c as any)?.itemId ?? (c as any)?.barcode ?? _idx;
  }

  get hasAnyData(): boolean {
    return (this.ilsCheckouts?.length ?? 0) > 0;
  }
}
