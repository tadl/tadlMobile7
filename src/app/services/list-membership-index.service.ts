import { Injectable } from '@angular/core';
import { lastValueFrom } from 'rxjs';
import { Storage } from '@ionic/storage-angular';

import { AuthService } from './auth.service';
import { ListsService } from './lists.service';

export interface ListMembershipRef {
  listId: string;
  listTitle: string;
}

interface MembershipIndexDoc {
  updatedAt: number;
  byRecordId: Record<string, ListMembershipRef[]>;
}

export interface MembershipIndexStatus {
  updatedAt: number | null;
  records: number;
}

export interface MembershipSyncResult {
  listsSynced: number;
  recordsIndexed: number;
  updatedAt: number;
}

@Injectable({ providedIn: 'root' })
export class ListMembershipIndexService {
  private storage = new Storage({ name: '__tadldb' });
  private ready: Promise<void> | null = null;

  constructor(
    private auth: AuthService,
    private lists: ListsService,
  ) {}

  async getStatusForCurrentUser(): Promise<MembershipIndexStatus> {
    const doc = await this.readDocForCurrentUser();
    const records = Object.keys(doc?.byRecordId ?? {}).length;
    return {
      updatedAt: doc?.updatedAt ?? null,
      records,
    };
  }

  async membershipsForRecord(recordId: string): Promise<ListMembershipRef[]> {
    const key = this.normalizeRecordId(recordId);
    if (!key) return [];

    const doc = await this.readDocForCurrentUser();
    if (!doc) return [];
    return (doc.byRecordId[key] ?? []).slice();
  }

  async upsertMembership(recordId: string, listId: string, listTitle: string): Promise<void> {
    const recordKey = this.normalizeRecordId(recordId);
    const normalizedListId = (listId ?? '').toString().trim();
    if (!recordKey || !normalizedListId) return;

    const doc = await this.readDocForCurrentUserOrEmpty();
    const existing = doc.byRecordId[recordKey] ?? [];
    const title = (listTitle ?? '').toString().trim() || 'List';

    const already = existing.find((x) => x.listId === normalizedListId);
    if (already) {
      already.listTitle = title;
    } else {
      existing.push({ listId: normalizedListId, listTitle: title });
    }

    doc.byRecordId[recordKey] = existing;
    doc.updatedAt = Date.now();
    await this.writeDocForCurrentUser(doc);
  }

  async removeMembership(recordId: string, listId: string): Promise<void> {
    const recordKey = this.normalizeRecordId(recordId);
    const normalizedListId = (listId ?? '').toString().trim();
    if (!recordKey || !normalizedListId) return;

    const doc = await this.readDocForCurrentUser();
    if (!doc) return;

    const next = (doc.byRecordId[recordKey] ?? []).filter((x) => x.listId !== normalizedListId);
    if (next.length) doc.byRecordId[recordKey] = next;
    else delete doc.byRecordId[recordKey];

    doc.updatedAt = Date.now();
    await this.writeDocForCurrentUser(doc);
  }

  async removeList(listId: string): Promise<void> {
    const normalizedListId = (listId ?? '').toString().trim();
    if (!normalizedListId) return;

    const doc = await this.readDocForCurrentUser();
    if (!doc) return;

    for (const recordKey of Object.keys(doc.byRecordId)) {
      const next = (doc.byRecordId[recordKey] ?? []).filter((x) => x.listId !== normalizedListId);
      if (next.length) doc.byRecordId[recordKey] = next;
      else delete doc.byRecordId[recordKey];
    }

    doc.updatedAt = Date.now();
    await this.writeDocForCurrentUser(doc);
  }

  async renameList(listId: string, listTitle: string): Promise<void> {
    const normalizedListId = (listId ?? '').toString().trim();
    const title = (listTitle ?? '').toString().trim();
    if (!normalizedListId || !title) return;

    const doc = await this.readDocForCurrentUser();
    if (!doc) return;

    let changed = false;
    for (const recordKey of Object.keys(doc.byRecordId)) {
      const arr = doc.byRecordId[recordKey] ?? [];
      for (const entry of arr) {
        if (entry.listId !== normalizedListId) continue;
        if (entry.listTitle === title) continue;
        entry.listTitle = title;
        changed = true;
      }
    }

    if (!changed) return;
    doc.updatedAt = Date.now();
    await this.writeDocForCurrentUser(doc);
  }

  async syncAllForCurrentUser(): Promise<MembershipSyncResult> {
    const accountKey = this.currentAccountKey();
    if (!accountKey) throw new Error('not_logged_in');

    const lists = await lastValueFrom(this.lists.fetchUserLists());
    const byRecordId: Record<string, ListMembershipRef[]> = {};
    let listsSynced = 0;

    for (const list of lists ?? []) {
      const listId = (list?.id ?? '').toString().trim();
      if (!listId) continue;
      const listTitle = (list?.title ?? '').toString().trim() || 'List';
      listsSynced += 1;

      const titles = await this.fetchAllTitlesForList(listId);
      for (const title of titles) {
        const recordKey = this.normalizeRecordId((title as any)?.id);
        if (!recordKey) continue;

        const refs = byRecordId[recordKey] ?? [];
        if (!refs.some((x) => x.listId === listId)) {
          refs.push({ listId, listTitle });
          byRecordId[recordKey] = refs;
        }
      }
    }

    const updatedAt = Date.now();
    const doc: MembershipIndexDoc = { updatedAt, byRecordId };
    await this.writeDocForCurrentUser(doc);

    return {
      listsSynced,
      recordsIndexed: Object.keys(byRecordId).length,
      updatedAt,
    };
  }

  private async fetchAllTitlesForList(listId: string): Promise<any[]> {
    const out: any[] = [];
    let page = 1;
    let pageTotal = 1;

    while (page <= pageTotal) {
      const res = await lastValueFrom(this.lists.fetchListTitles(listId, page, 100));
      if (!res?.success) break;
      out.push(...(res.titles ?? []));
      pageTotal = Math.max(1, Number(res.page_total ?? 1) || 1);
      page += 1;
    }

    return out;
  }

  private async ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = this.storage.create().then(() => undefined);
    }
    await this.ready;
  }

  private currentAccountKey(): string | null {
    const snap = this.auth.snapshot();
    const accountId = (snap?.activeAccountId ?? '').toString().trim();
    return accountId || null;
  }

  private storageKeyForCurrentUser(): string | null {
    const accountKey = this.currentAccountKey();
    if (!accountKey) return null;
    return `list-memberships:${accountKey}`;
  }

  private async readDocForCurrentUser(): Promise<MembershipIndexDoc | null> {
    await this.ensureReady();
    const key = this.storageKeyForCurrentUser();
    if (!key) return null;
    const raw = await this.storage.get(key);
    if (!raw || typeof raw !== 'object') return null;
    const byRecordId = (raw as any)?.byRecordId;
    const updatedAt = Number((raw as any)?.updatedAt ?? 0);
    if (!byRecordId || typeof byRecordId !== 'object') return null;
    return {
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
      byRecordId: byRecordId as Record<string, ListMembershipRef[]>,
    };
  }

  private async readDocForCurrentUserOrEmpty(): Promise<MembershipIndexDoc> {
    return (
      (await this.readDocForCurrentUser()) ?? {
        updatedAt: 0,
        byRecordId: {},
      }
    );
  }

  private async writeDocForCurrentUser(doc: MembershipIndexDoc): Promise<void> {
    await this.ensureReady();
    const key = this.storageKeyForCurrentUser();
    if (!key) return;
    await this.storage.set(key, doc);
  }

  private normalizeRecordId(value: any): string {
    return (value ?? '').toString().trim().toLowerCase();
  }
}
