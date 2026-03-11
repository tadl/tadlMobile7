import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Router } from '@angular/router';

import { Globals } from '../globals';
import { AuthService } from './auth.service';
import { AccountStoreService } from './account-store.service';

interface RouteDiscoveryUrlOptions {
  openExternalWhenBrowserMode?: boolean;
  openExternalForUnmatchedPath?: boolean;
}

@Injectable({ providedIn: 'root' })
export class DiscoveryLinkRouterService {
  constructor(
    private router: Router,
    private globals: Globals,
    private http: HttpClient,
    private auth: AuthService,
    private accounts: AccountStoreService,
  ) {}

  isDiscoveryUrl(rawUrl: string): boolean {
    const parsed = this.tryParse(rawUrl);
    return (parsed?.hostname ?? '').toLowerCase() === 'discover.tadl.org';
  }

  async routeIfHandled(rawUrl: string, options?: RouteDiscoveryUrlOptions): Promise<boolean> {
    const raw = (rawUrl ?? '').toString().trim();
    if (!raw) return false;

    const parsed = this.tryParse(raw);
    if (!parsed) return false;

    const host = (parsed.hostname ?? '').toLowerCase();
    if (host !== 'discover.tadl.org') return false;

    if (this.globals.link_mode === 'browser') {
      if (options?.openExternalWhenBrowserMode) {
        await this.globals.open_external_page(raw);
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
      await this.router.navigate(['/account']);
      return true;
    }

    if ((first === 'union' && (parts[1] ?? '').toLowerCase() === 'search') || first === 'search') {
      await this.handleSearchLink(parsed, raw);
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

  private async handleSearchLink(url: URL, rawUrl: string): Promise<void> {
    const lookfor =
      this.firstNonEmpty([
        url.searchParams.get('lookfor'),
        url.searchParams.get('lookfor0[]'),
        url.searchParams.get('lookfor0'),
        url.searchParams.get('lookfor0%5B%5D'),
      ]) ?? '';

    const type0 = (this.firstNonEmpty([
      url.searchParams.get('type0[]'),
      url.searchParams.get('type0'),
      url.searchParams.get('type0%5B%5D'),
    ]) ?? '').toLowerCase();

    if (type0 === 'id' && lookfor) {
      await this.resolveRecordLink(lookfor, rawUrl);
      return;
    }

    const externalFilters = [
      ...url.searchParams.getAll('filter[]'),
      ...url.searchParams.getAll('filter'),
    ]
      .map((x) => this.normalizeIncomingFilter((x ?? '').toString().trim()))
      .filter((x) => !!x);

    const queryParams: Record<string, any> = {};
    if (lookfor) queryParams['lookfor'] = lookfor;
    if (externalFilters.length) queryParams['extFilter'] = externalFilters;
    queryParams['dl'] = Date.now().toString();

    await this.router.navigate(['/search'], { queryParams, replaceUrl: true });
  }

  private firstNonEmpty(values: Array<string | null | undefined>): string | null {
    for (const raw of values) {
      const v = (raw ?? '').toString().trim();
      if (v) return v;
    }
    return null;
  }

  private normalizeIncomingFilter(rawFilter: string): string {
    const f = (rawFilter ?? '').toString().trim();
    if (!f) return '';

    const idx = f.indexOf(':');
    if (idx <= 0 || idx >= f.length - 1) return '';

    const field = f.slice(0, idx).trim();
    let value = f.slice(idx + 1).trim();
    if (!field || !value) return '';

    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1).trim();
    }
    if (!value) return '';
    return `${field}:${value}`;
  }

  private async resolveRecordLink(recordIdRaw: string, fallbackUrl: string): Promise<void> {
    const recordId = (recordIdRaw ?? '').toString().trim();
    if (!recordId) return;

    const groupedId = await this.lookupGroupedIdForRecord(recordId);
    if (groupedId) {
      await this.router.navigate(['/item', groupedId]);
      return;
    }

    await this.globals.open_external_page(fallbackUrl);
  }

  private async lookupGroupedIdForRecord(recordId: string): Promise<string | null> {
    const params = new HttpParams()
      .set('id', recordId)
      .set('api', this.globals.aspen_api_param_api);

    const snap = this.auth.snapshot();
    const username = (snap?.activeAccountMeta?.username ?? '').toString().trim();
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
        headers = new HttpHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' });
      }
    }

    try {
      const raw = await firstValueFrom(
        this.http.post<any>(`${this.globals.aspen_api_base}/RecordLookup`, body, { params, headers }),
      );
      const result = raw?.result ?? raw;
      const success = !!result?.success;
      const groupedId = (result?.id ?? '').toString().trim();
      const hasFormats = result?.formats && typeof result.formats === 'object';
      if (!success || !groupedId || !hasFormats) return null;
      return groupedId;
    } catch {
      return null;
    }
  }
}
