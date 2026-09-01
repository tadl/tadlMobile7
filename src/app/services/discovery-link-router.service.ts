import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Router } from '@angular/router';

import { Globals } from '../globals';
import { AuthService } from './auth.service';
import { AccountStoreService } from './account-store.service';

interface RouteDiscoveryUrlOptions {
  openExternalWhenBrowserMode?: boolean;
  openExternalForUnmatchedPath?: boolean;
  replaceUrl?: boolean;
}

@Injectable({ providedIn: 'root' })
export class DiscoveryLinkRouterService {
  private router = inject(Router);
  private globals = inject(Globals);
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private accounts = inject(AccountStoreService);

  isDiscoveryUrl(rawUrl: string): boolean {
    const parsed = this.tryParse(rawUrl);
    return (parsed?.hostname ?? '').toLowerCase() === this.discoveryHostname();
  }

  async routeIfHandled(
    rawUrl: string,
    options?: RouteDiscoveryUrlOptions
  ): Promise<boolean> {
    const raw = (rawUrl ?? '').toString().trim();
    if (!raw) return false;

    const parsed = this.tryParse(raw);
    if (!parsed) return false;

    const host = (parsed.hostname ?? '').toLowerCase();
    if (host !== this.discoveryHostname()) return false;

    if (this.globals.link_mode === 'browser') {
      if (options?.openExternalWhenBrowserMode) {
        await this.globals.open_page(raw);
      }
      return true;
    }

    const path = (parsed.pathname ?? '').trim();
    const parts = path.split('/').filter(Boolean);
    const first = (parts[0] ?? '').toLowerCase();

    if (first === 'groupedwork' && parts[1]) {
      await this.router.navigate(['/item', parts[1]]);
      return true;
    }

    if (first === 'record' && parts[1]) {
      await this.resolveRecordLink(parts[1], raw);
      return true;
    }

    if (first === 'myaccount') {
      await this.globals.open_external_page(raw);
      return true;
    }

    if (
      (first === 'union' && (parts[1] ?? '').toLowerCase() === 'search') ||
      first === 'search'
    ) {
      await this.handleSearchLink(parsed, raw, options);
      return true;
    }

    if (options?.openExternalForUnmatchedPath) {
      await this.globals.open_external_page(raw);
      return true;
    }

    return false;
  }

  private tryParse(rawUrl: string): URL | null {
    try {
      return new URL((rawUrl ?? '').toString().trim());
    } catch {
      return null;
    }
  }

  private discoveryHostname(): string {
    try {
      return new URL(this.globals.aspen_discovery_base).hostname.toLowerCase();
    } catch {
      return '';
    }
  }

  private async handleSearchLink(
    url: URL,
    rawUrl: string,
    options?: RouteDiscoveryUrlOptions
  ): Promise<void> {
    const lookfor =
      this.firstNonEmpty([
        url.searchParams.get('lookfor'),
        url.searchParams.get('lookfor0[]'),
        url.searchParams.get('lookfor0'),
        url.searchParams.get('lookfor0%5B%5D'),
      ]) ?? '';

    const type0 = (
      this.firstNonEmpty([
        url.searchParams.get('type0[]'),
        url.searchParams.get('type0'),
        url.searchParams.get('type0%5B%5D'),
      ]) ?? ''
    ).toLowerCase();

    const filters = Array.from(
      new Set(
        this.nonEmptyValues([
          ...url.searchParams.getAll('filter[]'),
          ...url.searchParams.getAll('filter'),
          ...url.searchParams.getAll('filter%5B%5D'),
        ])
      )
    );

    const rawSort =
      this.firstNonEmpty([
        url.searchParams.get('sort'),
        url.searchParams.get('sort_by'),
      ]) ?? '';

    const searchIndex =
      this.firstNonEmpty([
        url.searchParams.get('searchIndex'),
        this.searchIndexFromType(type0),
      ]) ?? '';

    if (type0 === 'id' && lookfor) {
      await this.resolveRecordLink(lookfor, rawUrl);
      return;
    }

    const queryParams: Record<string, any> = {};
    if (lookfor) queryParams['lookfor'] = lookfor;
    if (searchIndex && searchIndex !== 'Keyword')
      queryParams['searchIndex'] = searchIndex;
    if (rawSort && rawSort !== 'relevance') queryParams['sort'] = rawSort;
    if (filters.length) queryParams['extFilter'] = filters;
    if (filters.length) queryParams['advanced'] = '1';
    queryParams['dl'] = Date.now().toString();

    await this.router.navigate(['/search'], {
      queryParams,
      replaceUrl: options?.replaceUrl === true,
    });
  }

  private firstNonEmpty(
    values: Array<string | null | undefined>
  ): string | null {
    for (const raw of values) {
      const v = (raw ?? '').toString().trim();
      if (v) return v;
    }
    return null;
  }

  private nonEmptyValues(values: Array<string | null | undefined>): string[] {
    return values
      .map((raw) => (raw ?? '').toString().trim())
      .filter((value) => !!value);
  }

  private searchIndexFromType(type0: string): string | null {
    switch ((type0 ?? '').toLowerCase()) {
      case 'title':
        return 'Title';
      case 'author':
        return 'Author';
      case 'subject':
        return 'Subject';
      case 'isbn':
        return 'ISBN';
      case 'keyword':
        return 'Keyword';
      default:
        return null;
    }
  }

  private async resolveRecordLink(
    recordIdRaw: string,
    fallbackUrl: string
  ): Promise<void> {
    const recordId = (recordIdRaw ?? '').toString().trim();
    if (!recordId) return;

    const groupedId = await this.lookupGroupedIdForRecord(recordId);
    if (groupedId) {
      await this.router.navigate(['/item', groupedId]);
      return;
    }

    await this.globals.open_external_page(fallbackUrl);
  }

  private async lookupGroupedIdForRecord(
    recordId: string
  ): Promise<string | null> {
    const params = new HttpParams()
      .set('id', recordId)
      .set('api', this.globals.aspen_api_param_api);

    const snap = this.auth.snapshot();
    const username = (snap?.activeAccountMeta?.username ?? '')
      .toString()
      .trim();
    const activeId = (snap?.activeAccountId ?? '').toString().trim();

    let body = '';
    let headers: HttpHeaders | undefined;
    if (username && activeId) {
      const password = (await this.accounts.getPassword(activeId)) ?? '';
      if (password) {
        const post = new URLSearchParams();
        post.set('username', username);
        post.set('password', password);
        body = post.toString();
        headers = new HttpHeaders({
          'Content-Type': 'application/x-www-form-urlencoded',
        });
      }
    }

    try {
      const raw = await firstValueFrom(
        this.http.post<any>(
          `${this.globals.aspen_api_base}/RecordLookup`,
          body,
          { params, headers }
        )
      );
      const result = raw?.result ?? raw;
      const success = !!result?.success;
      const groupedId = (result?.id ?? '').toString().trim();
      if (!success || !groupedId) return null;
      return groupedId;
    } catch {
      return null;
    }
  }
}
