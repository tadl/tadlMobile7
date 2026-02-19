import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { Globals } from '../globals';

export type AspenSearchIndex = 'Keyword' | 'Title' | 'Author' | 'Subject' | 'ISBN';
export type AspenSearchSource = 'local' | 'combined';
export type AspenSearchSort =
  | 'relevance'
  | 'newest_to_oldest'
  | 'oldest_to_newest'
  | 'title'
  | 'author';

export interface AspenSearchOptions {
  lookfor: string;
  page?: number;
  pageSize?: number;
  language?: string;

  searchIndex?: AspenSearchIndex;
  source?: AspenSearchSource;
  sort?: AspenSearchSort;

  // Aspen uses repeated filter[] query params
  filters?: string[];
}

export interface AspenItemRef {
  /** e.g. "ils:17026593", "overdrive:<uuid>", "overdrive:kindle:<uuid>", "hoopla:<id>" */
  id: string;
  /** Display label like "Book", "eBook", "Kindle", "Audiobook CD" */
  name: string;
  /** e.g. "ils", "overdrive", "hoopla" */
  source: string;
}

export interface AspenSearchHit {
  /** Grouped-work key (best canonical ID at this level) */
  key?: string;

  title?: string;
  author?: string;
  coverUrl?: string;
  summary?: string;
  language?: string;

  /** Some Aspen configs leave format blank; itemList tends to be more reliable */
  format?: string | string[];

  /** The important part for next-step lookups */
  itemList?: AspenItemRef[];

  /** Keep raw */
  raw: any;

  /** Convenience: open grouped work / record page */
  catalogUrl?: string;
}

export interface AspenFacetBucketValue {
  value: string;
  display: string;
  count: number;
  isApplied: boolean;
  url?: string; // Aspen provides web URLs; we will *not* use them directly, but may parse for filters later
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

  lookfor?: string;
  totalResults?: number;
  page: number;
  pageSize: number;
  totalPages?: number;

  hits: AspenSearchHit[];

  facets?: Record<string, AspenFacetBucket>;
  sortList?: any;
  paging?: AspenPaging;

  raw: any;
}

@Injectable({ providedIn: 'root' })
export class SearchService {
  constructor(private http: HttpClient, private globals: Globals) {}

  /**
   * Preferred for the app:
   * POST /API/SearchAPI?method=getAppSearchResults&lookfor=...&page=...&count=...&searchIndex=...&sort=...&filter[]=...
   *
   * Your sample response shape:
   * result: {
   *   items: [{ title, author, image, itemList:[{id,name,source}], key, summary, language }, ...],
   *   facetSet, sortList, paging
   * }
   */
  getAppSearchResults(opts: AspenSearchOptions): Observable<AspenSearchResult> {
    const page = opts.page ?? 1;
    const pageSize = opts.pageSize ?? 25;

    let params = new HttpParams()
      .set('method', 'getAppSearchResults')
      .set('lookfor', opts.lookfor ?? '')
      .set('page', String(page))
      .set('count', String(pageSize)) // note: this endpoint uses "count"
      .set('type', 'catalog')
      .set('searchIndex', opts.searchIndex ?? 'Keyword')
      .set('source', opts.source ?? 'local');

    if (opts.language) params = params.set('language', opts.language);

    // IMPORTANT: sort values differ between endpoints.
    // For getAppSearchResults Aspen often expects web-style sorts like:
    // - "relevance"
    // - "year desc,title asc"
    // - "author asc,title asc"
    // - "title"
    // We'll pass through whatever you set in the UI for now.
    if (opts.sort) params = params.set('sort', opts.sort);

    (opts.filters ?? []).forEach(f => {
      params = params.append('filter[]', f);
    });

    return this.http
      .post<any>(`${this.globals.aspen_api_base}/SearchAPI`, {}, { params })
      .pipe(
        map(raw => {
          const result = raw?.result ?? raw;
          const success = !!result?.success;

          const hits = this.extractAppHits(result);

          const totalResults = this.asNumber(result?.totalResults) ?? undefined;

          const paging = this.extractPaging(result?.paging, page, pageSize);
          const totalPages =
            paging?.totalPages ??
            this.asNumber(result?.paging?.totalPages) ??
            undefined;

          return {
            success,
            lookfor: result?.lookfor ?? opts.lookfor,
            totalResults,
            page: paging?.currentPage ?? page,
            pageSize: paging?.itemsPerPage ?? pageSize,
            totalPages,
            hits,
            facets: (result?.facetSet ?? undefined) as Record<string, AspenFacetBucket> | undefined,
            sortList: result?.sortList,
            paging,
            raw: result,
          } satisfies AspenSearchResult;
        }),
      );
  }

  /**
   * Keep searchLite for comparison/fallback; not preferred going forward.
   */
  searchLite(opts: AspenSearchOptions): Observable<AspenSearchResult> {
    const page = opts.page ?? 1;
    const pageSize = opts.pageSize ?? 25;

    let params = new HttpParams()
      .set('method', 'searchLite')
      .set('lookfor', opts.lookfor ?? '')
      .set('page', String(page))
      .set('pageSize', String(pageSize))
      .set('type', 'catalog')
      .set('searchIndex', opts.searchIndex ?? 'Keyword')
      .set('source', opts.source ?? 'local');

    if (opts.language) params = params.set('language', opts.language);
    if (opts.sort) params = params.set('sort', opts.sort);

    (opts.filters ?? []).forEach(f => {
      params = params.append('filter[]', f);
    });

    return this.http
      .post<any>(`${this.globals.aspen_api_base}/SearchAPI`, {}, { params })
      .pipe(
        map(raw => {
          const result = raw?.result ?? raw;
          const success = !!result?.success;
          const hits = this.extractLiteHits(result);

          const totalResults =
            this.asNumber(result?.totalResults) ??
            this.asNumber(result?.numResults) ??
            this.asNumber(result?.total) ??
            undefined;

          const totalPages =
            this.asNumber(result?.totalPages) ??
            this.asNumber(result?.pagination?.totalPages) ??
            undefined;

          return {
            success,
            lookfor: result?.lookfor ?? opts.lookfor,
            page,
            pageSize,
            totalResults,
            totalPages,
            hits,
            raw: result,
          } satisfies AspenSearchResult;
        }),
      );
  }

  private extractAppHits(result: any): AspenSearchHit[] {
    const items = result?.items ?? [];
    if (!Array.isArray(items)) return [];

    return items.map((r: any) => {
      const title = this.decodeEntities(r?.title) ?? undefined;
      const author = this.decodeEntities(r?.author) ?? undefined;

      // getAppSearchResults uses "image" (your sample). Keep compatibility with other keys too.
      const coverUrl =
        r?.image ??
        r?.coverUrl ??
        r?.cover ??
        r?.bookCoverUrl ??
        undefined;

      const key = r?.key ?? r?.id ?? r?.groupedWorkId ?? undefined;

      const summary =
        this.decodeEntities(r?.summary) ??
        this.decodeEntities(r?.description) ??
        undefined;

      const language = this.decodeEntities(r?.language) ?? undefined;

      const itemList = this.extractItemList(r?.itemList);

      const catalogUrl =
        key ? `${this.globals.aspen_base}/GroupedWork/${encodeURIComponent(key)}` : undefined;

      return {
        key,
        title,
        author,
        coverUrl,
        summary,
        language,
        // Many configs leave "format" blank; treat itemList as authoritative
        format: r?.format ?? undefined,
        itemList,
        raw: r,
        catalogUrl,
      } satisfies AspenSearchHit;
    });
  }

  private extractItemList(input: any): AspenItemRef[] | undefined {
    if (!Array.isArray(input)) return undefined;

    const out: AspenItemRef[] = [];
    for (const x of input) {
      const id = typeof x?.id === 'string' ? x.id : undefined;
      const name = typeof x?.name === 'string' ? x.name : undefined;
      const source = typeof x?.source === 'string' ? x.source : undefined;
      if (id && name && source) out.push({ id, name, source });
    }
    return out.length ? out : undefined;
  }

  private extractPaging(p: any, fallbackPage: number, fallbackPageSize: number): AspenPaging | undefined {
    if (!p) return undefined;

    const currentPage = this.asNumber(p?.currentPage) ?? fallbackPage;
    const totalPages = this.asNumber(p?.totalPages) ?? undefined;
    const totalItems = this.asNumber(p?.totalItems) ?? undefined;
    const itemsPerPage = this.asNumber(p?.itemsPerPage) ?? fallbackPageSize;

    if (!totalPages && !totalItems) return undefined;

    return {
      currentPage,
      totalPages: totalPages ?? Math.max(1, Math.ceil((totalItems ?? 0) / itemsPerPage)),
      totalItems: totalItems ?? (totalPages ? totalPages * itemsPerPage : 0),
      itemsPerPage,
    };
  }

  private extractLiteHits(result: any): AspenSearchHit[] {
    const candidates =
      result?.records ??
      result?.data?.records ??
      result?.items ??
      result?.data?.items ??
      result?.results ??
      result?.data?.results ??
      [];

    if (!Array.isArray(candidates)) return [];

    return candidates.map((r: any) => {
      const title =
        this.decodeEntities(r?.title) ??
        this.decodeEntities(r?.title_display) ??
        this.decodeEntities(r?.groupedWorkTitle) ??
        this.decodeEntities(r?.displayTitle) ??
        undefined;

      const author =
        this.decodeEntities(r?.author) ??
        this.decodeEntities(r?.author_display) ??
        this.decodeEntities(r?.displayAuthor) ??
        undefined;

      const coverUrl =
        r?.coverUrl ??
        r?.cover ??
        r?.image ??
        r?.bookCoverUrl ??
        undefined;

      const key = r?.key ?? r?.groupedWorkId ?? r?.id ?? undefined;

      const summary =
        this.decodeEntities(r?.summary) ??
        this.decodeEntities(r?.description) ??
        this.decodeEntities(r?.snippet) ??
        undefined;

      const catalogUrl =
        key ? `${this.globals.aspen_base}/GroupedWork/${encodeURIComponent(key)}` : undefined;

      return {
        key,
        title,
        author,
        coverUrl,
        summary,
        format: r?.format ?? r?.formats ?? r?.format_category ?? undefined,
        itemList: this.extractItemList(r?.itemList),
        raw: r,
        catalogUrl,
      } satisfies AspenSearchHit;
    });
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

    return s;
  }

  private asNumber(v: any): number | undefined {
    if (v === null || v === undefined) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
}
