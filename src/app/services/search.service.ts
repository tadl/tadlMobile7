// src/app/services/search.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, map, from, switchMap } from 'rxjs';
import { Globals } from '../globals';
import { AuthService } from './auth.service';
import { AccountStoreService } from './account-store.service';
import { DiscoveryUrlService } from './discovery-url.service';

export type AspenSearchIndex = 'Keyword' | 'Title' | 'Author' | 'Subject' | 'ISBN';
export type AspenSearchSource = 'local' | 'combined';

/**
 * For getAppSearchResults, Aspen commonly expects "web sort keys"
 * like: "relevance", "year desc,title asc", "author asc,title asc", "title", etc.
 * Treat as pass-through to match Aspen config.
 */
export type AspenSearchSort = string;

export interface AspenSearchOptions {
  lookfor: string;
  page?: number;      // 1-based
  pageSize?: number;  // Aspen param name: "count"
  language?: string;

  searchIndex?: AspenSearchIndex;
  source?: AspenSearchSource;
  sort?: AspenSearchSort;
  includeSortList?: boolean;

  // Aspen uses repeated filter[] query params
  filters?: string[];
}

export interface AspenItemRef {
  id: string;     // e.g. "ils:17026593", "overdrive:<uuid>", "overdrive:kindle:<uuid>", "hoopla:<id>"
  name: string;   // Display label like "Book", "eBook", "Kindle"
  source: string; // e.g. "ils", "overdrive", "hoopla"
}

export interface AspenSearchHit {
  key: string; // grouped work key

  title?: string;
  author?: string;
  coverUrl?: string;
  summary?: string;
  language?: string;

  format?: string | string[];
  itemList: AspenItemRef[];

  catalogUrl?: string;
  lastCheckOut?: string | number | null;
  appearsOnLists?: Array<{ id: string | number; title: string }>;

  raw: any;
}

export interface AspenFacetBucketValue {
  value: string;
  display: string;
  count: number;
  isApplied: boolean;
  url?: string;
}

export interface AspenFacetBucket {
  label: string;
  list: Record<string, AspenFacetBucketValue>;
  hasApplied?: boolean;
  valuesToShow?: number;
  showAlphabetically?: boolean;
  multiSelect?: boolean;
}

export interface AspenPaging {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
}

export interface AspenSearchResult {
  success: boolean;

  lookfor: string;
  totalResults: number;

  page: number;
  pageSize: number;

  /** kept for compatibility with existing pages/components */
  totalPages: number;

  hits: AspenSearchHit[];

  facets?: Record<string, AspenFacetBucket>;
  sortList?: any;
  paging?: AspenPaging;

  raw: any;
}

@Injectable({ providedIn: 'root' })
export class SearchService {
  constructor(
    private http: HttpClient,
    private globals: Globals,
    private auth: AuthService,
    private accounts: AccountStoreService,
    private discoveryUrls: DiscoveryUrlService,
  ) {}

  getAppSearchResults(opts: AspenSearchOptions): Observable<AspenSearchResult> {
    const page = opts.page ?? 1;
    const pageSize = opts.pageSize ?? 25;

    let params = new HttpParams()
      .set('method', 'searchLite')
      .set('type', 'catalog')
      .set('lookfor', opts.lookfor ?? '')
      .set('page', String(page))
      .set('pageSize', String(pageSize))
      .set('searchIndex', opts.searchIndex ?? 'Keyword')
      .set('source', opts.source ?? 'local');

    if (opts.language) params = params.set('language', opts.language);
    if (opts.sort) params = params.set('sort', opts.sort);
    if (opts.includeSortList !== undefined) {
      params = params.set('includeSortList', opts.includeSortList ? 'true' : 'false');
    }

    for (const f of opts.filters ?? []) {
      params = params.append('filter[]', f);
    }

    const snap = this.auth.snapshot();
    const shouldSendCreds = !!(snap.isLoggedIn && snap.activeAccountId && snap.activeAccountMeta);

    const searchRequest$ = shouldSendCreds
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

    return searchRequest$.pipe(
        map(raw => {
          const result = raw?.result ?? raw;
          const success = !!result?.success;

          const hits = this.extractHits(result);

          const totalResults = this.asNumber(result?.totalResults) ?? 0;

          const paging = this.extractPaging(result?.paging, page, pageSize, totalResults);

          return {
            success,
            lookfor: (result?.lookfor ?? opts.lookfor) as string,
            totalResults,

            page: paging.currentPage,
            pageSize: paging.itemsPerPage,
            totalPages: paging.totalPages,

            hits,

            facets: (result?.options ?? result?.facetSet ?? undefined) as Record<string, AspenFacetBucket> | undefined,
            sortList: result?.sortList,
            paging,
            raw: result,
          } satisfies AspenSearchResult;
        }),
      );
  }

  private extractHits(result: any): AspenSearchHit[] {
    const items = result?.items;
    if (!Array.isArray(items)) return [];

    const hits: AspenSearchHit[] = [];

    for (const r of items) {
      const key = typeof r?.key === 'string' ? r.key : undefined;
      if (!key) continue;

      const title = this.decodeEntities(r?.title);
      const author = this.decodeEntities(r?.author);
      const coverUrl = this.discoveryUrls.normalize(r?.image);
      const summary = this.decodeEntities(r?.summary);
      const language = this.decodeEntities(r?.language);

      const itemList = this.extractItemList(r?.itemList);

      const catalogUrl = `${this.globals.aspen_discovery_base}/GroupedWork/${encodeURIComponent(key)}`;

      hits.push({
        key,
        title,
        author,
        coverUrl,
        summary,
        language,
        format: r?.format ?? undefined,
        itemList,
        catalogUrl,
        lastCheckOut: this.normalizeLastCheckOut(r?.lastCheckOut),
        appearsOnLists: this.extractAppearsOnLists(r?.appearsOnLists),
        raw: r,
      });
    }

    return hits;
  }

  private extractItemList(input: any): AspenItemRef[] {
    if (!input) return [];
    const sourceItems = Array.isArray(input) ? input : (typeof input === 'object' ? Object.values(input) : []);
    if (!Array.isArray(sourceItems)) return [];
    const out: AspenItemRef[] = [];

    for (const x of sourceItems as any[]) {
      const id = (x?.id ?? '').toString().trim();
      const name = typeof x?.name === 'string' ? x.name : '';
      const source = typeof x?.source === 'string' ? x.source : 'ils';
      if (name) out.push({ id: id || `fmt:${name.toLowerCase()}`, name, source });
    }

    return out;
  }

  private extractAppearsOnLists(input: any): Array<{ id: string | number; title: string }> {
    if (!input) return [];
    const values = Array.isArray(input) ? input : (typeof input === 'object' ? Object.values(input) : []);
    const out: Array<{ id: string | number; title: string }> = [];
    for (const x of values as any[]) {
      const id = (x?.id ?? '').toString().trim();
      const title = (x?.title ?? '').toString().trim();
      if (id && title) out.push({ id, title });
    }
    return out;
  }

  private normalizeLastCheckOut(input: any): string | number | null {
    if (input === null || input === undefined) return null;
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (typeof input === 'string') {
      const v = input.trim();
      if (!v) return null;
      const maybeNum = Number(v);
      if (Number.isFinite(maybeNum)) return maybeNum;
      return v;
    }
    return null;
  }

  private extractPaging(p: any, fallbackPage: number, fallbackPageSize: number, totalResults: number): AspenPaging {
    const currentPage = this.asNumber(p?.currentPage) ?? fallbackPage;
    const itemsPerPage = this.asNumber(p?.itemsPerPage) ?? fallbackPageSize;

    const totalItems =
      this.asNumber(p?.totalItems) ??
      this.asNumber(p?.totalResults) ??
      totalResults ??
      0;

    const totalPages =
      this.asNumber(p?.totalPages) ??
      Math.max(1, Math.ceil(totalItems / Math.max(1, itemsPerPage)));

    return {
      currentPage,
      totalPages,
      totalItems,
      itemsPerPage,
    };
  }

  private decodeEntities(input: any): string | undefined {
    if (typeof input !== 'string') return undefined;

    let s = input.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

    try {
      const txt = document.createElement('textarea');
      txt.innerHTML = s;
      s = txt.value;
    } catch {
      // ignore
    }

    return s || undefined;
  }

  private asNumber(v: any): number | undefined {
    if (v === null || v === undefined) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
}
