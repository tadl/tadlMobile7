import { Injectable } from '@angular/core';
import { lastValueFrom } from 'rxjs';

import { AuthService } from './auth.service';
import { AspenListTitle, AspenUserList, ListsService } from './lists.service';
import { AppCacheService } from './app-cache.service';

export interface ListMembershipRef {
  listId: string;
  listTitle: string;
}

interface ListLookupState {
  lists: AspenUserList[];
  listsLoaded: boolean;
  membershipsByRecordId: Record<string, ListMembershipRef[]>;
  lastListUsed: string | null;
  membershipIndexUpdatedAt: number | null;
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
    private auth: AuthService,
    private listsService: ListsService,
    private cache: AppCacheService,
  ) {}

  async lookup(recordIds: string[], options?: { refresh?: boolean }): Promise<ListLookupResult> {
    const accountId = this.currentAccountId();
    if (!accountId) throw new Error('not_logged_in');

    await this.ensureListsLoaded(accountId, options?.refresh === true);
    return this.filteredResult(this.ensureState(accountId), this.normalizeRecordIds(recordIds));
  }

  async membershipsForRecord(recordId: string): Promise<ListMembershipRef[]> {
    const normalized = this.normalizeRecordId(recordId);
    if (!normalized) return [];
    const result = await this.lookup([normalized]);
    return (result.membershipsByRecordId[normalized] ?? []).slice();
  }

  cachedMembershipsForRecord(recordId: string): ListMembershipRef[] {
    const state = this.activeState();
    const normalized = this.normalizeRecordId(recordId);
    if (!state || !normalized) return [];
    return (state.membershipsByRecordId[normalized] ?? []).slice();
  }

  async hasLists(options?: { refresh?: boolean }): Promise<boolean> {
    const result = await this.lookup([], options);
    return result.lists.length > 0;
  }

  async cachedListCount(): Promise<number | null> {
    const accountId = this.currentAccountId();
    if (!accountId) return 0;

    const state = this.ensureState(accountId);
    if (state.listsLoaded) return state.lists.length;

    const cached = await this.cache.read<AspenUserList[]>(`lists:user:${accountId}`);
    if (!Array.isArray(cached)) return null;

    state.lists = cached.slice();
    state.listsLoaded = true;
    return state.lists.length;
  }

  replaceLists(lists: AspenUserList[]): void {
    const state = this.activeState();
    if (!state) return;
    state.lists = (lists ?? []).slice();
    state.listsLoaded = true;
  }

  observeListPage(listId: string, listTitle: string, titles: AspenListTitle[]): void {
    const state = this.activeState();
    const normalizedListId = (listId ?? '').toString().trim();
    const normalizedTitle = (listTitle ?? '').toString().trim() || 'List';
    if (!state || !normalizedListId) return;

    for (const title of titles ?? []) {
      const recordId = this.normalizeRecordId((title?.id ?? title?.shortId ?? '').toString().trim());
      if (!recordId) continue;
      const existing = state.membershipsByRecordId[recordId] ?? [];
      if (existing.some((entry) => entry.listId === normalizedListId)) continue;
      state.membershipsByRecordId[recordId] = [
        ...existing,
        { listId: normalizedListId, listTitle: normalizedTitle },
      ];
    }
    state.membershipIndexUpdatedAt = Date.now();
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
    state.lastListUsed = normalizedListId;
    state.membershipIndexUpdatedAt = Date.now();
  }

  removeMembership(recordId: string, listId: string): void {
    const state = this.activeState();
    const recordKey = this.normalizeRecordId(recordId);
    const normalizedListId = (listId ?? '').toString().trim();
    if (!state || !recordKey || !normalizedListId) return;

    state.membershipsByRecordId[recordKey] = (state.membershipsByRecordId[recordKey] ?? []).filter(
      (entry) => entry.listId !== normalizedListId,
    );
    state.membershipIndexUpdatedAt = Date.now();
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
    if (state.lastListUsed === normalizedListId) state.lastListUsed = null;
    state.membershipIndexUpdatedAt = Date.now();
  }

  clearAccountState(accountId: string | null | undefined): void {
    const normalized = (accountId ?? '').toString().trim();
    if (!normalized) return;
    this.stateByAccountId.delete(normalized);
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
      listsLoaded: false,
      membershipsByRecordId: {},
      lastListUsed: null,
      membershipIndexUpdatedAt: null,
    };
    this.stateByAccountId.set(accountId, created);
    return created;
  }

  private async ensureListsLoaded(accountId: string, refresh: boolean): Promise<void> {
    const state = this.ensureState(accountId);
    if (state.listsLoaded && !refresh) return;

    const lists = await lastValueFrom(this.listsService.fetchUserLists());
    state.lists = (lists ?? []).slice();
    state.listsLoaded = true;
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
}
