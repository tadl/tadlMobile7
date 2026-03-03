import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { finalize } from 'rxjs';

import { Globals } from '../../globals';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { AspenFine, FinesService } from '../../services/fines.service';

@Component({
  standalone: true,
  selector: 'app-fines',
  templateUrl: './fines.page.html',
  styleUrls: ['./fines.page.scss'],
  imports: [CommonModule, IonicModule],
})
export class FinesPage {
  loading = false;
  fines: AspenFine[] = [];
  totalOwed = 0;

  constructor(
    public globals: Globals,
    private auth: AuthService,
    private finesService: FinesService,
    private toast: ToastService,
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
    if (!snap.isLoggedIn) {
      this.fines = [];
      this.totalOwed = 0;
      ev?.target?.complete?.();
      return;
    }

    this.loading = true;
    this.finesService
      .fetchPatronFines()
      .pipe(
        finalize(() => {
          this.loading = false;
          ev?.target?.complete?.();
        }),
      )
      .subscribe({
        next: (res) => {
          if (!res?.success) {
            this.fines = [];
            this.totalOwed = 0;
            if (res?.message && res.message !== 'missing_password' && res.message !== 'not_logged_in') {
              this.toast.presentToast('Could not load fines.');
            }
            return;
          }

          this.fines = (res.fines ?? []).slice().sort((a, b) => {
            return this.dateSortValue(b) - this.dateSortValue(a);
          });
          this.totalOwed = Number(res.totalOwed ?? 0) || 0;
        },
        error: () => {
          this.fines = [];
          this.totalOwed = 0;
          this.toast.presentToast('Could not load fines.');
        },
      });
  }

  get hasAnyData(): boolean {
    return (this.fines?.length ?? 0) > 0;
  }

  get canPayFines(): boolean {
    return this.totalOwed > 0;
  }

  totalOwedText(): string {
    return this.currencyText(this.totalOwed);
  }

  async payFines() {
    if (!this.canPayFines) return;
    await this.globals.open_external_page(this.globals.fines_payment_url);
  }

  fineReason(fine: AspenFine): string {
    return (fine?.reason ?? '').toString().trim() || 'Library fine';
  }

  fineAmountText(fine: AspenFine): string {
    const outstanding = (fine?.amountOutstanding ?? fine?.amount ?? '').toString().trim();
    if (outstanding) return outstanding;

    const numeric =
      Number.isFinite(Number(fine?.amountOutstandingVal)) ? Number(fine?.amountOutstandingVal) :
      Number.isFinite(Number(fine?.amountVal)) ? Number(fine?.amountVal) :
      0;
    return this.currencyText(numeric);
  }

  fineOriginalAmountText(fine: AspenFine): string {
    const original = (fine?.amountOriginal ?? '').toString().trim();
    const current = this.fineAmountText(fine);
    if (!original || original === current) return '';
    return original;
  }

  fineDateText(fine: AspenFine): string {
    const raw = (fine?.date ?? '').toString().trim();
    return raw || '';
  }

  fineMessageText(fine: AspenFine): string {
    return (fine?.message ?? '').toString().trim();
  }

  trackByFine = (index: number, fine: AspenFine) => {
    return `${this.fineReason(fine)}|${this.fineDateText(fine)}|${this.fineAmountText(fine)}|${index}`;
  };

  private currencyText(amount: number): string {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'USD',
    }).format(Number.isFinite(amount) ? amount : 0);
  }

  private dateSortValue(fine: AspenFine): number {
    const raw = this.fineDateText(fine);
    if (!raw) return 0;

    const parsed = new Date(raw);
    if (Number.isFinite(parsed.getTime())) return parsed.getTime();

    const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return 0;
    const month = Number(m[1]) - 1;
    const day = Number(m[2]);
    const year = Number(m[3]);
    return new Date(year, month, day).getTime();
  }
}
