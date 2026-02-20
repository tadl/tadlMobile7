import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { forkJoin, of } from 'rxjs';
import { catchError, finalize, map } from 'rxjs/operators';

import { Globals } from '../../../globals';
import { ToastService } from '../../../services/toast.service';
import { AspenSearchHit } from '../../../services/search.service';
import {
  ItemService,
  AspenGroupedWork,
  AspenItemAvailabilityResult,
  AspenWorkAction,
  AspenWorkFormat,
} from '../../../services/item.service';

type AvailabilitySummary = {
  totalHoldingsLines: number;
  availableHoldingsLines: number;
};

@Component({
  standalone: true,
  selector: 'app-search-detail',
  templateUrl: './search-detail.component.html',
  styleUrls: ['./search-detail.component.scss'],
  imports: [CommonModule, IonicModule],
})
export class SearchDetailComponent implements OnInit {
  @Input() hit!: AspenSearchHit;

  // WorkAPI result
  work: AspenGroupedWork | null = null;

  // Per-format ILS availability (keyed by *format key* from WorkAPI, e.g. "Book", "Playaway")
  availabilityByFormat: Record<string, AspenItemAvailabilityResult> = {};

  // Quick computed stats per format
  availabilitySummaryByFormat: Record<string, AvailabilitySummary> = {};

  loading = false;

  constructor(
    public globals: Globals,
    public toast: ToastService,
    private modalController: ModalController,
    private itemService: ItemService,
  ) {}

  ngOnInit() {
    this.loadWorkAndAvailability();
  }

  close() {
    this.modalController.dismiss();
    this.globals.modal_open = false;
  }

  openCatalog() {
    if (this.hit?.catalogUrl) this.globals.open_page(this.hit.catalogUrl);
  }

  private loadWorkAndAvailability() {
    const key = (this.hit as any)?.key ?? null;
    if (!key) {
      this.work = null;
      this.availabilityByFormat = {};
      this.availabilitySummaryByFormat = {};
      return;
    }

    this.loading = true;

    this.itemService
      .getGroupedWork(String(key))
      .pipe(
        catchError(err => {
          console.error(err);
          this.toast.presentToast('Could not load item details.');
          return of(null);
        }),
        finalize(() => (this.loading = false)),
      )
      .subscribe(work => {
        if (!work) return;

        this.work = work;

        // For each WorkAPI format: if it has an ils_hold onclick, fetch availability for that ILS id.
        const formats = work.formats ?? {};
        const calls: Record<string, any> = {};

        for (const [formatKey, fmt] of Object.entries(formats)) {
          const ilsId = this.findIlsIdForFormat(fmt);
          if (!ilsId) continue;

          calls[formatKey] = this.itemService.getIlsItemAvailability(ilsId).pipe(
            catchError(err => {
              console.warn('Availability failed for', formatKey, ilsId, err);
              return of(null);
            }),
          );
        }

        if (Object.keys(calls).length === 0) {
          this.availabilityByFormat = {};
          this.availabilitySummaryByFormat = {};
          return;
        }

        forkJoin(calls)
          .pipe(
            map(results => {
              const byFormat: Record<string, AspenItemAvailabilityResult> = {};
              const summaryByFormat: Record<string, AvailabilitySummary> = {};

              for (const [formatKey, r] of Object.entries(results)) {
                if (!r) continue;
                byFormat[formatKey] = r as AspenItemAvailabilityResult;
                summaryByFormat[formatKey] = this.computeAvailabilitySummary(r as AspenItemAvailabilityResult);
              }

              return { byFormat, summaryByFormat };
            }),
          )
          .subscribe(({ byFormat, summaryByFormat }) => {
            this.availabilityByFormat = byFormat;
            this.availabilitySummaryByFormat = summaryByFormat;
          });
      });
  }

  /**
   * WorkAPI ILS holds are represented as an action with onclick:
   * AspenDiscovery.Record.showPlaceHold('Record', 'ils', '17026593', '', '34791')
   */
  private findIlsIdForFormat(fmt: AspenWorkFormat | undefined): string | null {
    if (!fmt?.actions?.length) return null;

    for (const a of fmt.actions as AspenWorkAction[]) {
      const onclick = (a as any)?.onclick as string | undefined;
      const type = (a as any)?.type as string | undefined;

      if (type === 'ils_hold' || (onclick && onclick.toLowerCase().includes('showplacehold'))) {
        const id = this.itemService.extractIlsIdFromOnclick(onclick);
        if (id) return id;
      }
    }

    return null;
  }

  private computeAvailabilitySummary(r: AspenItemAvailabilityResult): AvailabilitySummary {
    const holdings = r?.holdings;
    if (!holdings || typeof holdings !== 'object') {
      return { totalHoldingsLines: 0, availableHoldingsLines: 0 };
    }

    let total = 0;
    let available = 0;

    for (const k of Object.keys(holdings)) {
      const arr = holdings[k];
      if (!Array.isArray(arr)) continue;

      total += arr.length;
      for (const h of arr) {
        if (h && (h as any).availability === true) available += 1;
      }
    }

    return { totalHoldingsLines: total, availableHoldingsLines: available };
  }

  formatHoldingsCount(formatKey: string): number {
    return this.availabilitySummaryByFormat?.[formatKey]?.totalHoldingsLines ?? 0;
  }

  formatAvailableCount(formatKey: string): number {
    return this.availabilitySummaryByFormat?.[formatKey]?.availableHoldingsLines ?? 0;
  }

  /**
   * Button handler for WorkAPI actions.
   * - url => open directly
   * - ils_hold => open record page in browser (hold placement lives there for now)
   * - preview/onclick-only => toast for now
   */
  runAction(formatKey: string, action: any) {
    if (!action) return;

    const url = typeof action.url === 'string' ? action.url : '';
    const title = typeof action.title === 'string' ? action.title : 'Action';
    const type = typeof action.type === 'string' ? action.type : '';
    const onclick = typeof action.onclick === 'string' ? action.onclick : '';

    if (url) {
      this.globals.open_page(url);
      return;
    }

    // ILS Hold: open record page (so patron can place hold there)
    if (type === 'ils_hold' || onclick.toLowerCase().includes('showplacehold')) {
      const ilsId = this.itemService.extractIlsIdFromOnclick(onclick);
      if (ilsId) {
        // Aspen record URL (works in the browser; later we’ll do native auth + hold API)
        const recordUrl = `${this.globals.aspen_base}/Record/${encodeURIComponent(ilsId)}`;
        this.globals.open_page(recordUrl);
        return;
      }
      this.toast.presentToast('Could not determine ILS record id for hold.');
      return;
    }

    // OverDrive sample / other onclick-only actions
    this.toast.presentToast(`${title}: not wired yet (needs native/auth support).`);
  }

  // Template helper: stable iteration over formats with `keyvalue`
  formatsKeyValue() {
    return this.work?.formats ?? null;
  }
}
