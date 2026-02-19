// src/app/services/search.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { Globals } from '../globals';

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
  constructor(private http: HttpClient, private globals: Globals) {}

  getAppSearchResults(opts: AspenSearchOptions): Observable<AspenSearchResult> {
    const page = opts.page ?? 1;
    const pageSize = opts.pageSize ?? 25;

    let params = new HttpParams()
      .set('method', 'getAppSearchResults')
      .set('type', 'catalog')
      .set('lookfor', opts.lookfor ?? '')
      .set('page', String(page))
      .set('count', String(pageSize))
      .set('searchIndex', opts.searchIndex ?? 'Keyword')
      .set('source', opts.source ?? 'local');

    if (opts.language) params = params.set('language', opts.language);
    if (opts.sort) params = params.set('sort', opts.sort);

    for (const f of opts.filters ?? []) {
      params = params.append('filter[]', f);
    }

    return this.http
      .post<any>(`${this.globals.aspen_api_base}/SearchAPI`, {}, { params })
      .pipe(
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

            facets: (result?.facetSet ?? undefined) as Record<string, AspenFacetBucket> | undefined,
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
      const coverUrl = typeof r?.image === 'string' ? r.image : undefined;
      const summary = this.decodeEntities(r?.summary);
      const language = this.decodeEntities(r?.language);

      const itemList = this.extractItemList(r?.itemList);

      const catalogUrl = `${this.globals.aspen_base}/GroupedWork/${encodeURIComponent(key)}`;

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
        raw: r,
      });
    }

    return hits;
  }

  private extractItemList(input: any): AspenItemRef[] {
    if (!Array.isArray(input)) return [];
    const out: AspenItemRef[] = [];

    for (const x of input) {
      const id = typeof x?.id === 'string' ? x.id : '';
      const name = typeof x?.name === 'string' ? x.name : '';
      const source = typeof x?.source === 'string' ? x.source : '';
      if (id && name && source) out.push({ id, name, source });
    }

    return out;
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
