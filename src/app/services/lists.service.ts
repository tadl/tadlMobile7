import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, from, map, switchMap, throwError, concat, filter, tap, finalize, shareReplay } from 'rxjs';

import { Globals } from '../globals';
import { AuthService } from './auth.service';
import { AccountStoreService } from './account-store.service';
import { AppCacheService } from './app-cache.service';
import { DiscoveryUrlService } from './discovery-url.service';

export interface AspenUserList {
  id: string | number;
  title: string;
  description?: string;
  numTitles?: number;
  public?: boolean;
  dateUpdated?: string;
  cover?: string;
}

export interface AspenListTitle {
  id: string;
  title?: string;
  author?: string;
  image?: string;
  small_image?: string;
  shortId?: string;
  recordType?: string;
  titleURL?: string;
  description?: string;
  length?: string;
  publisher?: string;
  format?: string | string[];
  language?: string;
  [k: string]: any;
}

export interface AspenListTitlesResult {
  success: boolean;
  listTitle?: string;
  listDescription?: string;
  titles: AspenListTitle[];
  totalResults?: number;
  page_current?: number;
  page_total?: number;
  message?: string;
}

export interface AspenListMutationResult {
  success: boolean;
  message?: string;
  listId?: string;
  listTitle?: string;
  raw?: any;
}

@Injectable({ providedIn: 'root' })
export class ListsService {
  private userListsFetch$: Observable<AspenUserList[]> | null = null;

  constructor(
    private http: HttpClient,
    private globals: Globals,
    private auth: AuthService,
    private accounts: AccountStoreService,
    private cache: AppCacheService,
    private discoveryUrls: DiscoveryUrlService,
  ) {}

  fetchUserLists(): Observable<AspenUserList[]> {
    const snap = this.auth.snapshot();
    const accountId = (snap?.activeAccountId ?? '').toString().trim();
    const cacheKey = `lists:user:${accountId || 'none'}`;

    const cached$ = from(this.cache.read<AspenUserList[]>(cacheKey)).pipe(
      filter((v): v is AspenUserList[] => Array.isArray(v)),
    );

    const network$ = this.userListsFetch$ ?? this.callListApi('getUserLists').pipe(
      map((r: any) => {
        if (!r?.success) return [];
        const lists = Array.isArray(r?.lists) ? r.lists : [];
        return lists.map((list: AspenUserList) => ({
          ...list,
          cover: this.normalizeDiscoveryUrl(list?.cover),
        })) as AspenUserList[];
      }),
      tap((lists) => {
        if (accountId) this.cache.write(cacheKey, lists).catch(() => {});
      }),
      finalize(() => {
        this.userListsFetch$ = null;
      }),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    this.userListsFetch$ = network$;

    return concat(cached$, network$);
  }

  fetchListTitles(listId: string | number, page = 1, numTitles = 50): Observable<AspenListTitlesResult> {
    const id = (listId ?? '').toString().trim();
    if (!id) return throwError(() => new Error('missing_list_id'));

    const snap = this.auth.snapshot();
    const accountId = (snap?.activeAccountId ?? '').toString().trim();
    const cacheKey = `lists:titles:${accountId || 'none'}:${id}:${Math.max(1, Number(page) || 1)}:${Math.max(1, Number(numTitles) || 50)}`;

    const cached$ = from(this.cache.read<AspenListTitlesResult>(cacheKey)).pipe(
      filter((v): v is AspenListTitlesResult => !!v && Array.isArray(v.titles)),
    );

    const network$ = this.callListApi('getListTitles', {
      id,
      page: String(Math.max(1, Number(page) || 1)),
      numTitles: String(Math.max(1, Number(numTitles) || 50)),
    }).pipe(
      map((r: any) => ({
        success: !!r?.success,
        listTitle: typeof r?.listTitle === 'string' ? r.listTitle : undefined,
        listDescription: typeof r?.listDescription === 'string' ? r.listDescription : undefined,
        titles: Array.isArray(r?.titles)
          ? (r.titles as AspenListTitle[]).map(t => ({
            ...t,
            image: this.normalizeDiscoveryUrl((t as any)?.image),
            small_image: this.normalizeDiscoveryUrl((t as any)?.small_image),
          }))
          : [],
        totalResults: Number.isFinite(Number(r?.totalResults)) ? Number(r.totalResults) : undefined,
        page_current: Number.isFinite(Number(r?.page_current)) ? Number(r.page_current) : undefined,
        page_total: Number.isFinite(Number(r?.page_total)) ? Number(r.page_total) : undefined,
        message: typeof r?.message === 'string' ? r.message : undefined,
      })),
      tap((result) => {
        if (accountId && result?.success) this.cache.write(cacheKey, result).catch(() => {});
      }),
    );

    return concat(cached$, network$);
  }

  removeTitlesFromList(listId: string | number, recordIds: Array<string | number>): Observable<AspenListMutationResult> {
    const id = (listId ?? '').toString().trim();
    const records = (recordIds ?? [])
      .map(r => (r ?? '').toString().trim())
      .filter(r => !!r);

    if (!id) return throwError(() => new Error('missing_list_id'));
    if (!records.length) return throwError(() => new Error('missing_record_ids'));

    return this.callListApi('removeTitlesFromList', {
      listId: id,
      recordIds: records.join(','),
    }).pipe(
      map((r: any) => this.mapMutationResult(r)),
    );
  }

  addTitlesToList(listId: string | number, recordIds: Array<string | number>): Observable<AspenListMutationResult> {
    const id = (listId ?? '').toString().trim();
    const records = (recordIds ?? [])
      .map(r => (r ?? '').toString().trim())
      .filter(r => !!r);

    if (!id) return throwError(() => new Error('missing_list_id'));
    if (!records.length) return throwError(() => new Error('missing_record_ids'));

    return this.callListApi('addTitlesToList', {
      listId: id,
      recordIds: records.join(','),
      source: 'GroupedWork',
    }).pipe(
      map((r: any) => this.mapMutationResult(r)),
    );
  }

  createList(title: string, description = '', isPublic = false): Observable<AspenListMutationResult> {
    const t = (title ?? '').toString().trim();
    if (!t) return throwError(() => new Error('missing_title'));

    return this.callListApi('createList', {
      title: t,
      description: (description ?? '').toString().trim(),
      public: isPublic ? '1' : '0',
    }).pipe(
      map((r: any) => this.mapMutationResult(r)),
    );
  }

  editList(
    listId: string | number,
    updates: { title?: string; description?: string; isPublic?: boolean },
  ): Observable<AspenListMutationResult> {
    const id = (listId ?? '').toString().trim();
    if (!id) return throwError(() => new Error('missing_list_id'));

    const params: Record<string, string> = { id };
    if (updates?.title !== undefined) params['title'] = (updates.title ?? '').toString().trim();
    if (updates?.description !== undefined) params['description'] = (updates.description ?? '').toString().trim();
    // Backend quirk: docs/api/ListAPI.php editList() does not treat string "0" as false.
    // Send explicit booleans-as-strings for editList only.
    if (updates?.isPublic !== undefined) params['public'] = updates.isPublic ? 'true' : 'false';

    return this.callListApi('editList', params).pipe(
      map((r: any) => this.mapMutationResult(r)),
    );
  }

  deleteList(listId: string | number): Observable<AspenListMutationResult> {
    const id = (listId ?? '').toString().trim();
    if (!id) return throwError(() => new Error('missing_list_id'));

    return this.callListApi('deleteList', {
      id,
      optOutOfSoftDeletion: 'false',
    }).pipe(
      map((r: any) => this.mapMutationResult(r)),
    );
  }

  private mapMutationResult(r: any): AspenListMutationResult {
    const listId = (r?.listId ?? r?.id ?? '').toString().trim();
    const listTitle = (r?.listTitle ?? '').toString().trim();
    return {
      success: !!r?.success,
      message: typeof r?.message === 'string' ? r.message : undefined,
      listId: listId || undefined,
      listTitle: listTitle || undefined,
      raw: r,
    };
  }

  private normalizeDiscoveryUrl(input: any): string | undefined {
    return this.discoveryUrls.normalize(input);
  }

  private callListApi(method: string, extraParams?: Record<string, string>): Observable<any> {
    const snap = this.auth.snapshot();
    if (!snap.isLoggedIn || !snap.activeAccountId || !snap.activeAccountMeta) {
      return throwError(() => new Error('not_logged_in'));
    }

    return from(this.accounts.getPassword(snap.activeAccountId)).pipe(
      switchMap(password => {
        if (!password) return throwError(() => new Error('missing_password'));

        let params = new HttpParams().set('method', method);
        for (const [k, v] of Object.entries(extraParams ?? {})) {
          params = params.set(k, (v ?? '').toString());
        }

        const body = new URLSearchParams();
        body.set('username', snap.activeAccountMeta!.username);
        body.set('password', password);

        const headers = new HttpHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' });

        return this.http
          .post<any>(`${this.globals.aspen_api_base}/ListAPI`, body.toString(), { params, headers })
          .pipe(map(raw => raw?.result ?? raw));
      }),
    );
  }
}
