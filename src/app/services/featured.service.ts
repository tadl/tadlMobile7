import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, concat, filter, from, map, of, switchMap, tap } from 'rxjs';

import { Globals } from '../globals';
import { AuthService } from './auth.service';
import { AccountStoreService } from './account-store.service';
import { AppCacheService } from './app-cache.service';
import { DiscoveryUrlService } from './discovery-url.service';

export interface FeaturedRecord {
  key: string;
  title: string;
  author?: string;
  image?: string;
  summary?: string;
  type?: string;
  url?: string;
  itemList?: any[];
  raw: any;
}

export interface FeaturedCategory {
  id: string;
  label: string;
  source?: string;
  previewRecords: FeaturedRecord[];
  raw: any;
}

export interface FeaturedCategoryPage {
  success: boolean;
  id: string;
  title: string;
  items: FeaturedRecord[];
  pageCurrent: number;
  pageTotal: number;
  totalResults: number;
  message?: string;
  raw: any;
}

@Injectable({ providedIn: 'root' })
export class FeaturedService {
  constructor(
    private http: HttpClient,
    private globals: Globals,
    private auth: AuthService,
    private accounts: AccountStoreService,
    private cache: AppCacheService,
    private discoveryUrls: DiscoveryUrlService,
  ) {}

  fetchBrowseCategories(maxCategories = 18): Observable<FeaturedCategory[]> {
    const accountKey = this.activeAccountCacheKey();
    const cacheKey = `featured:categories:${accountKey}:${Math.max(1, Number(maxCategories) || 18)}`;

    const cached$ = from(this.cache.read<FeaturedCategory[]>(cacheKey)).pipe(
      filter((v): v is FeaturedCategory[] => Array.isArray(v)),
    );

    const maxCat = String(Math.max(1, Number(maxCategories) || 18));
    const network$ = this.callSearchApi('getBrowseCategories', {
      maxCategories: maxCat,
    }).pipe(
      switchMap((r) => {
        if (!this.isInvalidMethodResponse(r)) return of(r);
        return this.callSearchApi('getAppActiveBrowseCategories', {
          maxCategories: maxCat,
          LiDARequest: 'true',
        });
      }),
      switchMap((r) => {
        if (!this.isInvalidMethodResponse(r)) return of(r);
        return this.callSearchApi('getBrowseCategoryListForUser');
      }),
      map((r) => this.normalizeBrowseCategories(r)),
      tap((categories) => {
        this.cache.write(cacheKey, categories).catch(() => {});
      }),
    );

    return concat(cached$, network$);
  }

  fetchBrowseCategoryPage(textId: string, page = 1, pageSize = 24): Observable<FeaturedCategoryPage> {
    const id = (textId ?? '').toString().trim();
    const p = Math.max(1, Number(page) || 1);
    const limit = Math.max(1, Number(pageSize) || 24);
    const accountKey = this.activeAccountCacheKey();
    const cacheKey = `featured:category:${accountKey}:${id}:${p}:${limit}`;

    const cached$ = from(this.cache.read<FeaturedCategoryPage>(cacheKey)).pipe(
      filter((v): v is FeaturedCategoryPage => !!v && Array.isArray(v.items)),
    );

    const network$ = this.callSearchApi('getAppBrowseCategoryResults', {
      id,
      page: String(p),
      limit: String(limit),
      pageSize: String(limit),
    }).pipe(
      map((r) => this.normalizeBrowseCategoryPage(id, p, limit, r)),
      tap((categoryPage) => {
        if (categoryPage?.success) this.cache.write(cacheKey, categoryPage).catch(() => {});
      }),
    );

    return concat(cached$, network$);
  }

  private normalizeBrowseCategories(input: any): FeaturedCategory[] {
    const list = Array.isArray(input) ? input : [];
    const out: FeaturedCategory[] = [];

    for (const rawCat of list) {
      const id = (rawCat?.textId ?? rawCat?.key ?? rawCat?.id ?? '').toString().trim();
      if (!id) continue;
      const label = (rawCat?.label ?? rawCat?.title ?? id).toString().trim() || id;
      const records = this.normalizeRecordList(rawCat?.records ?? rawCat?.items);
      out.push({
        id,
        label,
        source: (rawCat?.source ?? '').toString().trim() || undefined,
        previewRecords: records.slice(0, 12),
        raw: rawCat,
      });
    }

    return out;
  }

  private normalizeBrowseCategoryPage(textId: string, page: number, pageSize: number, input: any): FeaturedCategoryPage {
    const items = this.normalizeRecordList(input?.items ?? input?.records);
    const pageCurrent = Number.isFinite(Number(input?.page_current)) ? Number(input.page_current) : page;
    let pageTotal = Number.isFinite(Number(input?.page_total)) ? Number(input.page_total) : pageCurrent;
    const totalResults = Number.isFinite(Number(input?.totalResults))
      ? Number(input.totalResults)
      : Number.isFinite(Number(input?.count))
        ? Number(input.count)
        : (pageTotal > pageCurrent ? pageTotal * pageSize : Math.max(items.length, pageCurrent * pageSize));

    if (!Number.isFinite(pageTotal) || pageTotal < pageCurrent) {
      pageTotal = pageCurrent;
    }

    return {
      success: !!input?.success,
      id: textId,
      title: (input?.title ?? textId).toString().trim() || textId,
      items,
      pageCurrent,
      pageTotal,
      totalResults,
      message: typeof input?.message === 'string' ? input.message : undefined,
      raw: input,
    };
  }

  private normalizeRecordList(input: any): FeaturedRecord[] {
    const sourceItems = Array.isArray(input) ? input : (input && typeof input === 'object' ? Object.values(input) : []);
    const out: FeaturedRecord[] = [];

    for (const raw of sourceItems as any[]) {
      const key = (raw?.key ?? raw?.id ?? '').toString().trim();
      if (!key) continue;

      const title = this.decodeEntities(raw?.title ?? raw?.title_display ?? 'Untitled') || 'Untitled';
      const author = this.decodeEntities(raw?.author ?? raw?.author_display ?? '');
      const image = this.normalizeDiscoveryUrl(raw?.image);
      const summary = this.decodeEntities(raw?.summary ?? raw?.display_description ?? '');
      const type = (raw?.type ?? '').toString().trim() || undefined;
      const url = (raw?.url ?? '').toString().trim() || undefined;
      const itemList = Array.isArray(raw?.itemList) ? raw.itemList : (raw?.itemList && typeof raw.itemList === 'object' ? Object.values(raw.itemList) : []);

      out.push({
        key,
        title,
        author: author || undefined,
        image,
        summary: summary || undefined,
        type,
        url,
        itemList,
        raw,
      });
    }

    return out;
  }

  private normalizeDiscoveryUrl(input: any): string | undefined {
    return this.discoveryUrls.normalize(input);
  }

  private decodeEntities(input: any): string {
    if (input === null || input === undefined) return '';
    let s = String(input).replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    try {
      const txt = document.createElement('textarea');
      txt.innerHTML = s;
      s = txt.value;
    } catch {
      // ignore
    }
    return s;
  }

  private activeAccountCacheKey(): string {
    const snap = this.auth.snapshot();
    return (snap?.activeAccountId ?? 'none').toString().trim() || 'none';
  }

  private callSearchApi(method: string, extraParams?: Record<string, string>): Observable<any> {
    let params = new HttpParams().set('method', method);
    for (const [k, v] of Object.entries(extraParams ?? {})) {
      params = params.set(k, (v ?? '').toString());
    }

    const snap = this.auth.snapshot();
    const shouldSendCreds = !!(snap.isLoggedIn && snap.activeAccountId && snap.activeAccountMeta);

    const request$ = shouldSendCreds
      ? from(this.accounts.getPassword(snap.activeAccountId!)).pipe(
          switchMap((password) => {
            if (!password) {
              return this.http.post<any>(`${this.globals.aspen_api_base}/SearchAPI`, {}, { params });
            }
            const body = new URLSearchParams();
            body.set('username', snap.activeAccountMeta!.username);
            body.set('password', password);
            const headers = new HttpHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' });
            return this.http.post<any>(`${this.globals.aspen_api_base}/SearchAPI`, body.toString(), { params, headers });
          }),
        )
      : this.http.post<any>(`${this.globals.aspen_api_base}/SearchAPI`, {}, { params });

    return request$.pipe(map(raw => raw?.result ?? raw));
  }

  private isInvalidMethodResponse(input: any): boolean {
    const err = (input?.error ?? input?.message ?? '').toString().trim().toLowerCase();
    return err.includes('invalid_method');
  }
}
