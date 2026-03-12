import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController, ActionSheetController } from '@ionic/angular';
import { catchError, concatMap, finalize, from, map, of, switchMap, timer, toArray } from 'rxjs';

import { Globals } from '../../globals';
import { ToastService } from '../../services/toast.service';
import { AuthService } from '../../services/auth.service';
import { CheckoutsService, type AspenCheckout } from '../../services/checkouts.service';
import { ItemDetailComponent } from '../../components/item-detail/item-detail.component';
import { AspenSearchHit } from '../../services/search.service';
import { MelcatManageModalComponent } from '../../components/melcat-manage-modal/melcat-manage-modal.component';

@Component({
  standalone: true,
  selector: 'app-checkouts',
  templateUrl: './checkouts.page.html',
  styleUrls: ['./checkouts.page.scss'],
  imports: [CommonModule, IonicModule],
})
export class CheckoutsPage {
  private static readonly BULK_ACTION_DELAY_MS = 450;
  loading = false;
  renewAllBusy = false;
  private renewingKeys = new Set<string>();
  readonly melcatPlaceholderImage = 'assets/images/melcat-logo-square.png';

  ilsCheckouts: AspenCheckout[] = [];

  constructor(
    public globals: Globals,
    private toast: ToastService,
    private auth: AuthService,
    private checkouts: CheckoutsService,
    private modalCtrl: ModalController,
    private actionSheetCtrl: ActionSheetController,
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
          this.ilsCheckouts = this.sortCheckouts((list ?? []).slice());
          this.syncProfileCheckoutCount(this.ilsCheckouts.length);
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

  checkoutRenewInfoText(c: AspenCheckout): string {
    const used = Number(c?.renewCount);
    const max = Number(c?.maxRenewals);

    if (Number.isFinite(used) && Number.isFinite(max) && max >= 0) {
      const left = Math.max(0, max - used);
      return `Renewals left: ${left}`;
    }
    if (Number.isFinite(max) && max >= 0) return `Max renewals: ${max}`;
    if (Number.isFinite(used) && used >= 0) return `Renewals used: ${used}`;
    return '';
  }

  checkoutCanRenew(c: AspenCheckout): boolean {
    return c?.canRenew === true || (c as any)?.canrenew === true;
  }

  showMelcatPlaceholder(c: AspenCheckout): boolean {
    return !c?.coverUrl && this.isMelcatCheckout(c);
  }

  isRenewing(c: AspenCheckout): boolean {
    return this.renewingKeys.has(this.checkoutKey(c));
  }

  get renewableCount(): number {
    return (this.ilsCheckouts ?? []).filter((c) => this.checkoutCanRenew(c)).length;
  }

  get hasRenewableCheckouts(): boolean {
    return this.renewableCount > 0;
  }

  async openBulkActions(ev?: Event) {
    ev?.stopPropagation();
    ev?.preventDefault();

    const buttons: any[] = [];

    if (this.hasRenewableCheckouts) {
      buttons.push({
        text: 'Renew all',
        handler: () => this.confirmRenewAll(),
      });
    }

    buttons.push({
      text: 'Refresh',
      handler: () => this.refresh(),
    });
    buttons.push({
      text: 'Close', role: 'cancel',
    });

    const sheet = await this.actionSheetCtrl.create({
      header: 'Bulk actions',
      subHeader: `${this.ilsCheckouts.length} item${this.ilsCheckouts.length === 1 ? '' : 's'} checked out`,
      buttons,
    });

    await sheet.present();
  }

  async openCheckoutActions(c: AspenCheckout, ev?: Event) {
    ev?.stopPropagation();
    ev?.preventDefault();

    if (this.isMelcatCheckout(c)) {
      const sheet = await this.actionSheetCtrl.create({
        header: this.checkoutTitle(c),
        buttons: [
          { text: 'Manage checkout', handler: () => this.openMelcatManager('checkout', c) },
          { text: 'Close', role: 'cancel' },
        ],
      });
      await sheet.present();
      return;
    }

    const canRenew = this.checkoutCanRenew(c);
    const sheet = await this.actionSheetCtrl.create({
      header: this.checkoutTitle(c),
      subHeader: canRenew ? undefined : 'This item cannot be renewed.',
      buttons: [
        ...(canRenew
          ? [{
              text: 'Renew',
              handler: () => this.renewSingle(c),
            }]
          : []),
        {
          text: 'View details',
          handler: () => this.openCheckout(c),
        },
        {
          text: 'Close', role: 'cancel',
        },
      ],
    });

    await sheet.present();
  }

  async confirmRenewAll() {
    if (this.renewAllBusy) return;
    const count = this.renewableCount;
    if (count <= 0) {
      this.toast.presentToast('No renewable checkouts right now.');
      return;
    }

    const sheet = await this.actionSheetCtrl.create({
      header: 'Renew all checkouts?',
      subHeader: `Try to renew ${count} item${count === 1 ? '' : 's'}. Items that cannot be renewed will be skipped.`,
      buttons: [
        {
          text: 'Renew all',
          handler: () => this.renewAll(),
        },
        { text: 'Close', role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  private renewSingle(c: AspenCheckout) {
    if (!this.checkoutCanRenew(c) || this.renewAllBusy) return;
    const key = this.checkoutKey(c);
    if (!key || this.renewingKeys.has(key)) return;

    this.renewingKeys.add(key);
    this.checkouts.renewCheckout(c)
      .pipe(finalize(() => this.renewingKeys.delete(key)))
      .subscribe({
        next: (res) => {
          if (!res?.success) {
            this.toast.presentToast(res?.message || 'Could not renew.');
            return;
          }
          this.applyRenewMutationToCheckout(c, res?.raw);
          this.toast.presentToast(res?.message || 'Renewed.');
        },
        error: () => this.toast.presentToast('Could not renew.'),
      });
  }

  private renewAll() {
    const renewable = (this.ilsCheckouts ?? []).filter((c) => this.checkoutCanRenew(c));
    if (!renewable.length) return;

    this.renewAllBusy = true;
    this.renewingKeys = new Set(renewable.map((c) => this.checkoutKey(c)));

    from(renewable)
      .pipe(
        concatMap((checkout, idx) =>
          timer(idx === 0 ? 0 : CheckoutsPage.BULK_ACTION_DELAY_MS).pipe(
            switchMap(() => this.checkouts.renewCheckout(checkout)),
            map((res) => ({
              checkout,
              success: !!res?.success,
              message: (res?.message ?? '').toString().trim(),
              raw: res?.raw,
              rateLimited: false,
            })),
            catchError((err) => of({ checkout, success: false, message: '', raw: null, rateLimited: err?.status === 429 })),
          ),
        ),
        toArray(),
        finalize(() => {
          this.renewAllBusy = false;
          this.renewingKeys.clear();
        }),
      )
      .subscribe({
        next: (results) => {
          for (const r of results) {
            if (r.success && r.checkout) {
              this.applyRenewMutationToCheckout(r.checkout, r.raw);
            }
          }

          const ok = results.filter((r) => r.success).length;
          const failed = results.length - ok;
          const rateLimited = results.some((r) => r.rateLimited);
          if (rateLimited) {
            this.toast.presentToast('Aspen rate-limited the bulk renew request. Some items may not have updated yet.', 6000);
          } else if (failed === 0) {
            this.toast.presentToast(`Renewed ${ok} item${ok === 1 ? '' : 's'}.`);
          } else if (ok === 0) {
            this.toast.presentToast('Could not renew any items.');
          } else {
            this.toast.presentToast(`Renewed ${ok} item${ok === 1 ? '' : 's'}; ${failed} failed.`);
          }
        },
        error: () => {
          this.toast.presentToast('Could not complete renew all.');
        },
      });
  }

  async openCheckout(c: AspenCheckout) {
    if (this.isMelcatCheckout(c)) {
      await this.openMelcatManager('checkout', c);
      return;
    }

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
      catalogUrl: key ? `${this.globals.aspen_discovery_base}/GroupedWork/${encodeURIComponent(key)}` : undefined,
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
        this.ilsCheckouts = this.sortCheckouts([...(this.ilsCheckouts ?? [])]);
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

  private checkoutKey(c: AspenCheckout): string {
    const raw = (c as any)?.id ?? (c as any)?.itemId ?? (c as any)?.barcode ?? (c as any)?.recordId ?? '';
    return String(raw).trim();
  }

  private isMelcatCheckout(c: AspenCheckout | null | undefined): boolean {
    const grouped = ((c as any)?.groupedWorkId ?? '').toString().trim();
    const cover = ((c as any)?.coverUrl ?? '').toString().trim();
    return !grouped && !cover;
  }

  private async openMelcatManager(type: 'hold' | 'checkout', checkout?: AspenCheckout) {
    const title = checkout ? this.checkoutTitle(checkout) : '';
    const author = checkout ? this.checkoutAuthor(checkout) : '';
    const format = this.checkoutFormatSummary(checkout);

    const modal = await this.modalCtrl.create({
      component: MelcatManageModalComponent,
      componentProps: { type, title, author, format },
    });
    this.globals.modal_open = true;
    await modal.present();
  }

  private checkoutFormatSummary(checkout?: AspenCheckout): string {
    const raw = (checkout as any)?.format;
    if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter(Boolean).join(', ');
    return (raw ?? '').toString().trim();
  }

  private sortCheckouts(list: AspenCheckout[]): AspenCheckout[] {
    return list.sort((a, b) => {
      const aOverdue = !!a?.overdue;
      const bOverdue = !!b?.overdue;
      if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;

      const aDue = this.dueDateSortValue(a);
      const bDue = this.dueDateSortValue(b);
      if (aDue !== bDue) return aDue - bDue;

      return this.checkoutTitle(a).localeCompare(this.checkoutTitle(b));
    });
  }

  private dueDateSortValue(c: AspenCheckout): number {
    const due = Number(c?.dueDate ?? 0);
    if (!Number.isFinite(due) || due <= 0) return Number.MAX_SAFE_INTEGER;
    return due;
  }

  private applyRenewMutationToCheckout(checkout: AspenCheckout, raw: any): void {
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
      checkout.dueDate = dueEpoch;
      checkout.overdue = false;
    }

    if (rawRenewalDate != null) {
      checkout.renewalDate = String(rawRenewalDate);
    }

    const currentRenewCount = Number(checkout.renewCount ?? 0);
    checkout.renewCount = Number.isFinite(currentRenewCount) ? currentRenewCount + 1 : 1;

    if (Number.isFinite(Number(checkout.maxRenewals))) {
      checkout.canRenew = Number(checkout.renewCount ?? 0) < Number(checkout.maxRenewals ?? 0);
    }

    this.ilsCheckouts = this.sortCheckouts([...this.ilsCheckouts]);
  }

  private syncProfileCheckoutCount(totalCheckouts: number) {
    const target = Math.max(0, Number(totalCheckouts ?? 0) || 0);
    const snap = this.auth.snapshot();
    const profile: any = snap?.profile ?? {};
    const current = this.toCount(profile?.numCheckedOut ?? profile?.numCheckedOutIls ?? profile?.checkouts);
    this.auth.adjustActiveProfileCounts({ checkouts: target - current });
  }

  private toCount(value: any): number {
    const n = Number(value ?? 0);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }
}
