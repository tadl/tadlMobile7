import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, from, map, of, switchMap, tap } from 'rxjs';

import { Globals } from '../globals';
import { AppCacheService } from './app-cache.service';

export interface AccountPreferences {
  username: string;
  hold_shelf_alias: string;
  day_phone: string;
  evening_phone: string;
  other_phone: string;
  email: string;
  melcat_id: string;
  pickup_library: string;
  default_search: string;
  keep_circ_history: boolean;
  keep_hold_history: boolean;
  email_notify: boolean;
  phone_notify: boolean;
  text_notify: boolean;
  phone_notify_number: string;
  text_notify_number: string;
}

export interface PreferencesPayload {
  token: string;
  preferences: AccountPreferences;
  raw: any;
}

export interface PreferencesUpdateResult {
  success: boolean;
  message: string;
  token?: string;
  preferences?: AccountPreferences;
  raw: any;
}

@Injectable({ providedIn: 'root' })
export class AccountPreferencesService {
  constructor(
    private http: HttpClient,
    private globals: Globals,
    private cache: AppCacheService,
  ) {}

  getCachedPreferences(accountId: string): Promise<AccountPreferences | null> {
    const id = (accountId ?? '').trim();
    if (!id) return Promise.resolve(null);
    return this.cache.read<AccountPreferences>(this.preferencesCacheKey(id));
  }

  getCachedToken(accountId: string): Promise<string | null> {
    const id = (accountId ?? '').trim();
    if (!id) return Promise.resolve(null);
    return this.cache.read<string>(this.tokenCacheKey(id));
  }

  fetchByCredentials(username: string, password: string): Observable<PreferencesPayload> {
    const params = new HttpParams()
      .set('username', (username ?? '').trim())
      .set('password', (password ?? '').trim());

    return this.http
      .get<any>(this.preferencesFetchUrl(), { params })
      .pipe(
        map((raw) => {
          const root = raw?.result ?? raw ?? {};
          const user = root?.user ?? {};
          const preferences = this.normalizePreferences(root?.preferences ?? {});

          return {
            token: (user?.token ?? '').toString().trim(),
            preferences,
            raw,
          } satisfies PreferencesPayload;
        }),
      );
  }

  fetchForAccount(accountId: string, username: string, password: string): Observable<PreferencesPayload> {
    const id = (accountId ?? '').trim();
    if (!id) return this.fetchByCredentials(username, password);

    return this.fetchByCredentials(username, password).pipe(
      tap((res) => this.persistAccountCache(id, res)),
    );
  }

  updateByToken(
    token: string,
    values: Record<string, string | number | boolean>,
    username?: string,
    password?: string,
  ): Observable<PreferencesUpdateResult> {
    let params = new HttpParams().set('token', (token ?? '').trim());
    const user = (username ?? '').trim();
    const pass = (password ?? '').trim();
    if (user) params = params.set('username', user);
    if (pass) params = params.set('password', pass);

    for (const [key, value] of Object.entries(values ?? {})) {
      params = params.set(key, `${value}`);
    }

    if (!params.has('v')) {
      params = params.set('v', '5');
    }

    return this.http
      .get<any>(this.preferencesUpdateUrl(), { params })
      .pipe(
        map((raw) => {
          const root = raw?.result ?? raw ?? {};
          const user = root?.user ?? {};
          const prefs = root?.preferences ? this.normalizePreferences(root.preferences) : undefined;
          const message = this.extractMessage(root);
          const success = this.inferSuccess(root);

          return {
            success,
            message,
            token: (user?.token ?? '').toString().trim(),
            preferences: prefs,
            raw,
          } satisfies PreferencesUpdateResult;
        }),
      );
  }

  updateForAccount(
    accountId: string,
    username: string,
    password: string,
    currentToken: string,
    values: Record<string, string | number | boolean>,
  ): Observable<PreferencesUpdateResult> {
    const id = (accountId ?? '').trim();
    const user = (username ?? '').trim();
    const pass = (password ?? '').trim();
    const inMemoryToken = (currentToken ?? '').trim();

    const getToken$ = inMemoryToken
      ? of(inMemoryToken)
      : from(this.cache.read<string>(this.tokenCacheKey(id))).pipe(
          map((t) => (t ?? '').toString().trim()),
        );

    return getToken$.pipe(
      switchMap((token) => {
        if (!token) {
          return this.fetchByCredentials(user, pass).pipe(
            tap((res) => this.persistAccountCache(id, res)),
            switchMap((res) => this.updateByToken(res.token, values, user, pass)),
          );
        }

        return this.updateByToken(token, values, user, pass).pipe(
          switchMap((res) => {
            if (!this.shouldRetryWithCredentials(res)) {
              return of(res);
            }
            return this.fetchByCredentials(user, pass).pipe(
              tap((fresh) => this.persistAccountCache(id, fresh)),
              switchMap((fresh) => this.updateByToken(fresh.token, values, user, pass)),
            );
          }),
          catchError(() =>
            this.fetchByCredentials(user, pass).pipe(
              tap((fresh) => this.persistAccountCache(id, fresh)),
              switchMap((fresh) => this.updateByToken(fresh.token, values, user, pass)),
            ),
          ),
        );
      }),
    );
  }

  async persistTokenForAccount(accountId: string, token: string): Promise<void> {
    const id = (accountId ?? '').trim();
    const t = (token ?? '').trim();
    if (!id || !t) return;
    await this.cache.write(this.tokenCacheKey(id), t);
  }

  async persistPreferencesForAccount(accountId: string, preferences: AccountPreferences): Promise<void> {
    const id = (accountId ?? '').trim();
    if (!id || !preferences) return;
    await this.cache.write(this.preferencesCacheKey(id), preferences);
  }

  private normalizePreferences(input: any): AccountPreferences {
    return {
      username: (input?.username ?? '').toString(),
      hold_shelf_alias: (input?.hold_shelf_alias ?? '').toString(),
      day_phone: (input?.day_phone ?? '').toString(),
      evening_phone: (input?.evening_phone ?? '').toString(),
      other_phone: (input?.other_phone ?? '').toString(),
      email: (input?.email ?? '').toString(),
      melcat_id: (input?.melcat_id ?? '').toString(),
      pickup_library: (input?.pickup_library ?? '').toString(),
      default_search: (input?.default_search ?? '').toString(),
      keep_circ_history: this.toBool(input?.keep_circ_history),
      keep_hold_history: this.toBool(input?.keep_hold_history),
      email_notify: this.toBool(input?.email_notify),
      phone_notify: this.toBool(input?.phone_notify),
      text_notify: this.toBool(input?.text_notify),
      phone_notify_number: (input?.phone_notify_number ?? '').toString(),
      text_notify_number: (input?.text_notify_number ?? '').toString(),
    };
  }

  private toBool(v: any): boolean {
    if (typeof v === 'boolean') return v;
    const s = `${v ?? ''}`.toLowerCase().trim();
    return s === 'true' || s === '1' || s === 'yes';
  }

  private extractMessage(root: any): string {
    const messages = Array.isArray(root?.messages) ? root.messages : [];
    const first = messages[0] ?? {};
    if (typeof first?.error === 'string' && first.error.trim()) return first.error.trim();
    if (typeof first?.success === 'string' && first.success.trim()) return first.success.trim();
    if (typeof root?.message === 'string' && root.message.trim()) return root.message.trim();
    if (typeof root?.error === 'string' && root.error.trim()) return root.error.trim();
    return '';
  }

  private inferSuccess(root: any): boolean {
    if (root?.success === false) return false;
    const messages = Array.isArray(root?.messages) ? root.messages : [];
    const first = messages[0] ?? {};
    if (first?.error) return false;
    if (first?.success) return true;
    if (root?.preferences) return true;
    if (root?.user) return true;
    return root?.success === true;
  }

  private async persistAccountCache(accountId: string, payload: PreferencesPayload): Promise<void> {
    const id = (accountId ?? '').trim();
    if (!id) return;

    const token = (payload?.token ?? '').toString().trim();
    if (token) {
      await this.cache.write(this.tokenCacheKey(id), token);
    }
    if (this.looksLikeValidPreferences(payload?.preferences)) {
      await this.cache.write(this.preferencesCacheKey(id), payload.preferences);
    }
  }

  private looksLikeValidPreferences(prefs: AccountPreferences | null | undefined): boolean {
    if (!prefs) return false;
    return !!prefs.username || !!prefs.email || !!prefs.pickup_library;
  }

  private tokenCacheKey(accountId: string): string {
    return `preferences:token:${accountId}`;
  }

  private preferencesCacheKey(accountId: string): string {
    return `preferences:data:${accountId}`;
  }

  private preferencesFetchUrl(): string {
    return `${this.globals.aspen_api_base}/Preferences`;
  }

  private preferencesUpdateUrl(): string {
    return `${this.globals.aspen_api_base}/Preferences/update_preferences`;
  }

  private shouldRetryWithCredentials(res: PreferencesUpdateResult): boolean {
    if (!res || res.success) return false;
    const msg = (res.message ?? '').toLowerCase();
    if (!msg) return true;
    return msg.includes('token') || msg.includes('login') || msg.includes('not logged in') || msg.includes('invalid');
  }
}
