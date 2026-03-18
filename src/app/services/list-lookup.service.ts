import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { lastValueFrom } from 'rxjs';

import { Globals } from '../globals';
import { AuthService } from './auth.service';
import { AccountStoreService } from './account-store.service';
import { AspenUserList } from './lists.service';

export interface ListMembershipRef {
  listId: string;
  listTitle: string;
}

interface ListLookupState {
  lists: AspenUserList[];
  membershipsByRecordId: Record<string, ListMembershipRef[]>;
  loadedRecordIds: Set<string>;
  lastListUsed: string | null;
  membershipIndexUpdatedAt: number | null;
}

interface ListLookupResponse {
  ok: boolean;
  backend?: string;
  lists?: AspenUserList[];
  membershipsByRecordId?: Record<string, ListMembershipRef[]>;
  lastListUsed?: string | number | null;
  membershipIndexUpdatedAt?: string | number | null;
}

export interface ListLookupResult {
  lists: AspenUserList[];
  membershipsByRecordId: Record<string, ListMembershipRef[]>;
  lastListUsed: string | null;
  membershipIndexUpdatedAt: number | null;
}

@Injectable({ providedIn: 'root' })
export class ListLookupService {
  private readonly stateByAccountId = new Map<string, ListLookupState>();

  constructor(
    private http: HttpClient,
    private globals: Globals,
    private auth: AuthService,
    private accounts: AccountStoreService,
  ) {}

  async lookup(recordIds: string[], options?: { refresh?: boolean }): Promise<ListLookupResult> {
    const accountId = this.currentAccountId();
    if (!accountId) throw new Error('not_logged_in');

    const state = this.ensureState(accountId);
    const normalizedIds = this.normalizeRecordIds(recordIds);
    const refresh = options?.refresh === true;
    const missingIds = refresh
      ? normalizedIds
      : normalizedIds.filter((id) => !state.loadedRecordIds.has(id));

    if (missingIds.length || !state.lists.length || refresh) {
      await this.fetchAndMerge(accountId, missingIds.length ? missingIds : normalizedIds, refresh);
    }

    return this.filteredResult(this.ensureState(accountId), normalizedIds);
  }

  async membershipsForRecord(recordId: string, options?: { refresh?: boolean }): Promise<ListMembershipRef[]> {
    const normalized = this.normalizeRecordId(recordId);
    if (!normalized) return [];
    const result = await this.lookup([normalized], options);
    return (result.membershipsByRecordId[normalized] ?? []).slice();
  }

  upsertMembership(recordId: string, listId: string, listTitle: string): void {
    const state = this.activeState();
    const recordKey = this.normalizeRecordId(recordId);
    const normalizedListId = (listId ?? '').toString().trim();
    const normalizedTitle = (listTitle ?? '').toString().trim() || 'List';
    if (!state || !recordKey || !normalizedListId) return;

    const existing = state.membershipsByRecordId[recordKey] ?? [];
    const found = existing.find((entry) => entry.listId === normalizedListId);
    if (found) {
      found.listTitle = normalizedTitle;
    } else {
      state.membershipsByRecordId[recordKey] = [
        ...existing,
        { listId: normalizedListId, listTitle: normalizedTitle },
      ];
    }
    state.loadedRecordIds.add(recordKey);
    state.lastListUsed = normalizedListId;
  }

  removeMembership(recordId: string, listId: string): void {
    const state = this.activeState();
    const recordKey = this.normalizeRecordId(recordId);
    const normalizedListId = (listId ?? '').toString().trim();
    if (!state || !recordKey || !normalizedListId) return;

    const next = (state.membershipsByRecordId[recordKey] ?? []).filter(
      (entry) => entry.listId !== normalizedListId,
    );
    state.membershipsByRecordId[recordKey] = next;
    state.loadedRecordIds.add(recordKey);
  }

  renameList(listId: string, listTitle: string): void {
    const state = this.activeState();
    const normalizedListId = (listId ?? '').toString().trim();
    const normalizedTitle = (listTitle ?? '').toString().trim();
    if (!state || !normalizedListId || !normalizedTitle) return;

    state.lists = state.lists.map((list) => {
      const id = (list?.id ?? '').toString().trim();
      if (id !== normalizedListId) return list;
      return { ...list, title: normalizedTitle };
    });

    for (const recordId of Object.keys(state.membershipsByRecordId)) {
      state.membershipsByRecordId[recordId] = (state.membershipsByRecordId[recordId] ?? []).map((entry) =>
        entry.listId === normalizedListId ? { ...entry, listTitle: normalizedTitle } : entry,
      );
    }
  }

  removeList(listId: string): void {
    const state = this.activeState();
    const normalizedListId = (listId ?? '').toString().trim();
    if (!state || !normalizedListId) return;

    state.lists = state.lists.filter((list) => (list?.id ?? '').toString().trim() !== normalizedListId);
    for (const recordId of Object.keys(state.membershipsByRecordId)) {
      state.membershipsByRecordId[recordId] = (state.membershipsByRecordId[recordId] ?? []).filter(
        (entry) => entry.listId !== normalizedListId,
      );
    }

    if (state.lastListUsed === normalizedListId) {
      state.lastListUsed = null;
    }
  }

  private currentAccountId(): string | null {
    const snap = this.auth.snapshot();
    const accountId = (snap?.activeAccountId ?? '').toString().trim();
    return accountId || null;
  }

  private activeState(): ListLookupState | null {
    const accountId = this.currentAccountId();
    if (!accountId) return null;
    return this.ensureState(accountId);
  }

  private ensureState(accountId: string): ListLookupState {
    const existing = this.stateByAccountId.get(accountId);
    if (existing) return existing;

    const created: ListLookupState = {
      lists: [],
      membershipsByRecordId: {},
      loadedRecordIds: new Set<string>(),
      lastListUsed: null,
      membershipIndexUpdatedAt: null,
    };
    this.stateByAccountId.set(accountId, created);
    return created;
  }

  private normalizeRecordIds(recordIds: string[]): string[] {
    return Array.from(
      new Set(
        (recordIds ?? [])
          .map((recordId) => this.normalizeRecordId(recordId))
          .filter((recordId): recordId is string => !!recordId),
      ),
    );
  }

  private normalizeRecordId(recordId: string): string {
    return (recordId ?? '').toString().trim().toLowerCase();
  }

  private async fetchAndMerge(accountId: string, recordIds: string[], refresh: boolean): Promise<void> {
    const snap = this.auth.snapshot();
    const username = (snap?.activeAccountMeta?.username ?? '').toString().trim();
    if (!username) throw new Error('missing_username');

    const password = await this.accounts.getPassword(accountId);
    if (!password) throw new Error('missing_password');

    let params = new HttpParams().set('api', this.globals.aspen_api_param_api);
    if (recordIds.length) params = params.set('recordIds', recordIds.join(','));
    if (refresh) params = params.set('refresh', 'true');

    const body = new URLSearchParams();
    body.set('username', username);
    body.set('password', password);
    const headers = new HttpHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' });

    const raw = await lastValueFrom(
      this.http.post<ListLookupResponse>(
        `${this.globals.aspen_api_base}/ListLookup`,
        body.toString(),
        { params, headers },
      ),
    );

    if (!raw?.ok) throw new Error('list_lookup_failed');

    const state = this.ensureState(accountId);
    const nextLists = Array.isArray(raw?.lists)
      ? raw.lists.map((list) => ({
          ...list,
          cover: this.normalizeDiscoveryUrl(list?.cover),
        }))
      : [];

    state.lists = nextLists;
    state.lastListUsed = this.normalizeNullableString(raw?.lastListUsed);
    state.membershipIndexUpdatedAt = this.normalizeNullableNumber(raw?.membershipIndexUpdatedAt);

    const memberships = raw?.membershipsByRecordId ?? {};
    for (const recordId of recordIds) {
      const normalizedRecordId = this.normalizeRecordId(recordId);
      state.loadedRecordIds.add(normalizedRecordId);
      state.membershipsByRecordId[normalizedRecordId] = this.normalizeMembershipRefs(
        memberships[recordId] ?? memberships[normalizedRecordId] ?? [],
      );
    }
  }

  private filteredResult(state: ListLookupState, recordIds: string[]): ListLookupResult {
    const membershipsByRecordId: Record<string, ListMembershipRef[]> = {};
    for (const recordId of recordIds) {
      membershipsByRecordId[recordId] = (state.membershipsByRecordId[recordId] ?? []).slice();
    }

    return {
      lists: state.lists.slice(),
      membershipsByRecordId,
      lastListUsed: state.lastListUsed,
      membershipIndexUpdatedAt: state.membershipIndexUpdatedAt,
    };
  }

  private normalizeMembershipRefs(input: any): ListMembershipRef[] {
    const values = Array.isArray(input) ? input : [];
    const refs = values
      .map((entry) => {
        const listId = (entry?.listId ?? '').toString().trim();
        const listTitle = (entry?.listTitle ?? '').toString().trim() || 'List';
        if (!listId) return null;
        return { listId, listTitle } as ListMembershipRef;
      })
      .filter((entry): entry is ListMembershipRef => !!entry);

    const byId = new Map<string, ListMembershipRef>();
    for (const ref of refs) byId.set(ref.listId, ref);
    return Array.from(byId.values());
  }

  private normalizeNullableString(value: any): string | null {
    const normalized = (value ?? '').toString().trim();
    return normalized || null;
  }

  private normalizeNullableNumber(value: any): number | null {
    const normalized = Number(value ?? 0);
    return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
  }

  private normalizeDiscoveryUrl(input: any): string | undefined {
    const raw = (input ?? '').toString().trim();
    if (!raw) return undefined;
    if (raw.startsWith('/')) return `${this.globals.aspen_discovery_base}${raw}`;
    if (!/^https?:\/\//i.test(raw)) return `${this.globals.aspen_discovery_base}/${raw}`;

    try {
      const url = new URL(raw);
      const apiHost = new URL(this.globals.aspen_api_host).host;
      if (url.host === apiHost) {
        url.protocol = 'https:';
        url.host = new URL(this.globals.aspen_discovery_base).host;
        return url.toString();
      }
      return raw;
    } catch {
      return raw;
    }
  }
}
