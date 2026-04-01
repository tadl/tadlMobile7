import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, concat, filter as rxFilter, from, map, of, switchMap, tap, throwError } from 'rxjs';

import { Globals } from '../globals';
import { AuthService } from './auth.service';
import { AccountStoreService } from './account-store.service';
import { AppCacheService } from './app-cache.service';
import { DiscoveryUrlService } from './discovery-url.service';

export interface AspenReadingHistoryItem {
  id?: string;
  recordId?: string | number;
  groupedWorkId?: string;
  title?: string;
  author?: string;
  format?: string;
  coverUrl?: string;
  image?: string;
  checkout?: string;
  checkoutTime?: number;
  lastCheckout?: string;
  lastCheckoutTime?: number;
  [k: string]: any;
}

export interface AspenReadingHistoryPage {
  success: boolean;
  items: AspenReadingHistoryItem[];
  totalResults: number;
  pageCurrent: number;
  pageTotal: number;
  sort: string;
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class HistoryService {
  constructor(
    private http: HttpClient,
    private globals: Globals,
    private auth: AuthService,
    private accounts: AccountStoreService,
    private cache: AppCacheService,
    private discoveryUrls: DiscoveryUrlService,
  ) {}

  fetchReadingHistoryPage(
    page = 1,
    pageSize = 50,
    sort = 'checkedOut',
    queryFilter = '',
    useCache = true,
  ): Observable<AspenReadingHistoryPage> {
    const snap = this.auth.snapshot();
    if (!snap.isLoggedIn || !snap.activeAccountId || !snap.activeAccountMeta) {
      return from([{
        success: true,
        items: [],
        totalResults: 0,
        pageCurrent: 1,
        pageTotal: 1,
        sort,
      } satisfies AspenReadingHistoryPage]);
    }

    const p = Math.max(1, Number(page) || 1);
    const sz = Math.max(1, Number(pageSize) || 50);
    const cacheKey = `history:${snap.activeAccountId}:${p}:${sz}:${sort}:${queryFilter}`;

    const cached$ = useCache
      ? from(this.cache.read<AspenReadingHistoryPage>(cacheKey)).pipe(
        rxFilter((v): v is AspenReadingHistoryPage => !!v && Array.isArray(v.items)),
      )
      : of<AspenReadingHistoryPage>();

    const network$ = from(this.accounts.getPassword(snap.activeAccountId)).pipe(
      switchMap(password => {
        if (!password) return throwError(() => new Error('missing_password'));

        let params = new HttpParams()
          .set('method', 'getPatronReadingHistory')
          .set('page', String(p))
          .set('pageSize', String(sz))
          .set('sort_by', sort);

        if ((queryFilter ?? '').toString().trim()) {
          params = params.set('filter', queryFilter.toString().trim());
        }

        const body = new URLSearchParams();
        body.set('username', snap.activeAccountMeta!.username);
        body.set('password', password);

        const headers = new HttpHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' });

        return this.http
          .post<any>(`${this.globals.aspen_api_base}/UserAPI`, body.toString(), { params, headers })
          .pipe(
            map(raw => raw?.result ?? raw),
            map((r: any) => ({
              success: !!r?.success,
              items: Array.isArray(r?.readingHistory)
                ? (r.readingHistory as AspenReadingHistoryItem[]).map((item) => this.normalizeHistoryItem(item))
                : [],
              totalResults: Number.isFinite(Number(r?.totalResults)) ? Number(r.totalResults) : 0,
              pageCurrent: Number.isFinite(Number(r?.page_current)) ? Number(r.page_current) : p,
              pageTotal: Number.isFinite(Number(r?.page_total)) ? Number(r.page_total) : 1,
              sort: (r?.sort ?? sort).toString(),
              message: typeof r?.message === 'string' ? r.message : undefined,
            }) satisfies AspenReadingHistoryPage),
            tap((pageResult) => {
              if (pageResult?.success) this.cache.write(cacheKey, pageResult).catch(() => {});
            }),
          );
      }),
    );

    return concat(cached$, network$);
  }

  private normalizeHistoryItem(item: AspenReadingHistoryItem): AspenReadingHistoryItem {
    return {
      ...item,
      coverUrl: this.discoveryUrls.normalize(item?.coverUrl),
      image: this.discoveryUrls.normalize(item?.image),
    };
  }
}
