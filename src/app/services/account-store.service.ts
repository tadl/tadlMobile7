// src/app/services/account-store.service.ts
import { Injectable } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';

export interface StoredAccountMeta {
  id: string;            // stable internal id (uuid-ish)
  label: string;         // display label in UI (e.g. "WILLIAM ROCKWOOD")
  username: string;      // Aspen login username (e.g. "768661" or barcode)
  lastUsedAt?: number;   // unix seconds
}

export interface StoredAccount extends StoredAccountMeta {
  // password is not stored here; it lives in secure storage
}

const PREF_ACCOUNTS_INDEX = 'accounts:index';
const PREF_ACTIVE_ACCOUNT_ID = 'accounts:active';
const PREF_PROFILE_CACHE_PREFIX = 'accounts:profile:'; // + accountId

const SECURE_PASSWORD_PREFIX = 'accounts:password:';   // + accountId

@Injectable({ providedIn: 'root' })
export class AccountStoreService {
  // ---------- Accounts index (Preferences) ----------

  async listAccounts(): Promise<StoredAccountMeta[]> {
    const { value } = await Preferences.get({ key: PREF_ACCOUNTS_INDEX });
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        const normalized = await this.normalizeAccounts(parsed as StoredAccountMeta[]);
        return normalized;
      }
    } catch {
      // ignore
    }
    return [];
  }

  async upsertAccountMeta(meta: Omit<StoredAccountMeta, 'id'> & { id?: string }): Promise<StoredAccountMeta> {
    const accounts = await this.listAccounts();

    // Find by id (preferred) or by username fallback
    let acct: StoredAccountMeta | undefined;
    if (meta.id) acct = accounts.find(a => a.id === meta.id);
    if (!acct) acct = accounts.find(a => a.username === meta.username);

    const now = Math.floor(Date.now() / 1000);

    if (!acct) {
      acct = {
        id: meta.id ?? this.newId(),
        username: meta.username,
        label: meta.label,
        lastUsedAt: now,
      };
      accounts.unshift(acct);
    } else {
      acct.username = meta.username;
      acct.label = meta.label;
      acct.lastUsedAt = now;
    }

    // Move the canonical account to the top, then collapse any duplicate ids/usernames.
    const rest = accounts.filter(a => a.id !== acct.id);
    const normalized = await this.normalizeAccounts([acct, ...rest], acct.id);
    return normalized.find(a => a.id === acct.id) ?? acct;
  }

  async removeAccount(accountId: string): Promise<void> {
    const accounts = await this.listAccounts();
    const next = accounts.filter(a => a.id !== accountId);
    await Preferences.set({ key: PREF_ACCOUNTS_INDEX, value: JSON.stringify(next) });

    // remove password
    await this.deletePassword(accountId);

    // clear active if needed
    const active = await this.getActiveAccountId();
    if (active === accountId) {
      await this.setActiveAccountId(null);
    }

    // clear cached profile
    await this.clearCachedProfile(accountId);
  }

  // ---------- Password (Secure Storage) ----------

  async setPassword(accountId: string, password: string): Promise<void> {
    await SecureStoragePlugin.set({
      key: SECURE_PASSWORD_PREFIX + accountId,
      value: password,
    });
  }

  async getPassword(accountId: string): Promise<string | null> {
    try {
      const res = await SecureStoragePlugin.get({ key: SECURE_PASSWORD_PREFIX + accountId });
      return res?.value ?? null;
    } catch {
      return null;
    }
  }

  async deletePassword(accountId: string): Promise<void> {
    try {
      await SecureStoragePlugin.remove({ key: SECURE_PASSWORD_PREFIX + accountId });
    } catch {
      // ignore
    }
  }

  // ---------- Active account ----------

  async getActiveAccountId(): Promise<string | null> {
    const { value } = await Preferences.get({ key: PREF_ACTIVE_ACCOUNT_ID });
    return value ?? null;
  }

  async setActiveAccountId(accountId: string | null): Promise<void> {
    if (accountId) {
      await Preferences.set({ key: PREF_ACTIVE_ACCOUNT_ID, value: accountId });
    } else {
      await Preferences.remove({ key: PREF_ACTIVE_ACCOUNT_ID });
    }
  }

  async getActiveAccountMeta(): Promise<StoredAccountMeta | null> {
    const id = await this.getActiveAccountId();
    if (!id) return null;
    const accounts = await this.listAccounts();
    return accounts.find(a => a.id === id) ?? null;
  }

  // ---------- Cached profile (Preferences) ----------

  async cacheProfile(accountId: string, profile: any): Promise<void> {
    await Preferences.set({
      key: PREF_PROFILE_CACHE_PREFIX + accountId,
      value: JSON.stringify(profile ?? {}),
    });
  }

  async getCachedProfile(accountId: string): Promise<any | null> {
    const { value } = await Preferences.get({ key: PREF_PROFILE_CACHE_PREFIX + accountId });
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  async clearCachedProfile(accountId: string): Promise<void> {
    await Preferences.remove({ key: PREF_PROFILE_CACHE_PREFIX + accountId });
  }

  // ---------- Helpers ----------

  private newId(): string {
    // no crypto dependency; good enough as internal key
    return 'acct_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36);
  }

  private async normalizeAccounts(accounts: StoredAccountMeta[], preferredId?: string): Promise<StoredAccountMeta[]> {
    const seenIds = new Set<string>();
    const seenUsernames = new Set<string>();
    const duplicateIds: string[] = [];
    const ordered = [...(accounts ?? [])];

    if (preferredId) {
      ordered.sort((a, b) => {
        if (a?.id === preferredId) return -1;
        if (b?.id === preferredId) return 1;
        return 0;
      });
    }

    const normalized: StoredAccountMeta[] = [];

    for (const account of ordered) {
      const id = (account?.id ?? '').toString().trim();
      const username = (account?.username ?? '').toString().trim();
      if (!id || !username) {
        if (id) duplicateIds.push(id);
        continue;
      }
      if (seenIds.has(id) || seenUsernames.has(username)) {
        duplicateIds.push(id);
        continue;
      }
      seenIds.add(id);
      seenUsernames.add(username);
      normalized.push({
        ...account,
        id,
        username,
        label: (account?.label ?? '').toString(),
      });
    }

    await Preferences.set({ key: PREF_ACCOUNTS_INDEX, value: JSON.stringify(normalized) });

    for (const duplicateId of duplicateIds) {
      if (!duplicateId) continue;
      await this.deletePassword(duplicateId);
      await this.clearCachedProfile(duplicateId);
      const active = await this.getActiveAccountId();
      if (active === duplicateId) {
        await this.setActiveAccountId(null);
      }
    }

    return normalized;
  }
}
