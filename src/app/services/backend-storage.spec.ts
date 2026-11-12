import { Preferences } from '@capacitor/preferences';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';

import { APP_PROFILE } from '../app-profile';
import { AccountStoreService } from './account-store.service';
import { AppCacheService } from './app-cache.service';
import { backendStorageKey } from './backend-storage';

describe('Backend storage keys', () => {
  it('preserves existing production keys and separates each test backend', () => {
    for (const key of ['accounts:index', 'accounts:active', 'accounts:profile:example', 'accounts:password:example', 'cache:v1:']) {
      expect(backendStorageKey(key, 'tadl-prod')).toBe(key);
      expect(backendStorageKey(key, 'tadl-test')).toBe(`tadl-test:${key}`);
      expect(backendStorageKey(key, 'example-test')).toBe(`example-test:${key}`);
    }
  });
});

describe('Test backend storage isolation', () => {
  const accountId = 'synthetic-storage-account';
  const cacheId = 'synthetic-storage-cache';
  let originalBackend: string;

  async function cleanStorage(): Promise<void> {
    for (const backend of ['tadl-prod', 'tadl-test']) {
      for (const key of ['accounts:index', 'accounts:active', `accounts:profile:${accountId}`, `cache:v1:${cacheId}`]) {
        await Preferences.remove({ key: backendStorageKey(key, backend) });
      }
      try {
        await SecureStoragePlugin.remove({ key: backendStorageKey(`accounts:password:${accountId}`, backend) });
      } catch {
        // The synthetic password need not exist before or after a test.
      }
    }
  }

  beforeEach(async () => {
    originalBackend = APP_PROFILE.aspenApiParam;
    await cleanStorage();
  });

  afterEach(async () => {
    APP_PROFILE.aspenApiParam = originalBackend;
    await cleanStorage();
  });

  it('starts test accounts empty and keeps credentials, profiles and removals separate', async () => {
    APP_PROFILE.aspenApiParam = 'tadl-prod';
    const production = new AccountStoreService();
    await production.upsertAccountMeta({ id: accountId, username: 'synthetic-production', label: 'Example Production' });
    await production.setActiveAccountId(accountId);
    await production.setPassword(accountId, 'synthetic-production-password');
    await production.cacheProfile(accountId, { displayName: 'Example Production' });

    APP_PROFILE.aspenApiParam = 'tadl-test';
    const testing = new AccountStoreService();
    expect(await testing.listAccounts()).toEqual([]);
    expect(await testing.getActiveAccountId()).toBeNull();
    expect(await testing.getCachedProfile(accountId)).toBeNull();
    expect(await testing.getPassword(accountId)).toBeNull();

    await testing.upsertAccountMeta({ id: accountId, username: 'synthetic-testing', label: 'Example Testing' });
    await testing.setActiveAccountId(accountId);
    await testing.setPassword(accountId, 'synthetic-test-password');
    await testing.cacheProfile(accountId, { displayName: 'Example Testing' });

    const restoredTesting = new AccountStoreService();
    expect((await restoredTesting.listAccounts())[0].username).toBe('synthetic-testing');
    expect(await restoredTesting.getActiveAccountId()).toBe(accountId);
    expect(await restoredTesting.getPassword(accountId)).toBe('synthetic-test-password');
    expect(await restoredTesting.getCachedProfile(accountId)).toEqual({ displayName: 'Example Testing' });
    await restoredTesting.removeAccount(accountId);
    expect(await restoredTesting.listAccounts()).toEqual([]);
    expect(await restoredTesting.getActiveAccountId()).toBeNull();

    APP_PROFILE.aspenApiParam = 'tadl-prod';
    const restoredProduction = new AccountStoreService();
    expect((await restoredProduction.listAccounts())[0].username).toBe('synthetic-production');
    expect(await restoredProduction.getActiveAccountId()).toBe(accountId);
    expect(await restoredProduction.getPassword(accountId)).toBe('synthetic-production-password');
    expect(await restoredProduction.getCachedProfile(accountId)).toEqual({ displayName: 'Example Production' });
  });

  it('keeps cached values and prefix cleanup within the selected backend', async () => {
    APP_PROFILE.aspenApiParam = 'tadl-prod';
    const production = new AppCacheService();
    await production.write(cacheId, { title: 'Example Production' });

    APP_PROFILE.aspenApiParam = 'tadl-test';
    const testing = new AppCacheService();
    expect(await testing.read(cacheId)).toBeNull();
    await testing.write(cacheId, { title: 'Example Testing' });
    expect(await testing.read(cacheId)).toEqual({ title: 'Example Testing' });
    expect(await production.read(cacheId)).toEqual({ title: 'Example Production' });

    await testing.removeByPrefixes([cacheId]);
    expect(await testing.read(cacheId)).toBeNull();
    expect(await production.read(cacheId)).toEqual({ title: 'Example Production' });

    await testing.write(cacheId, { title: 'Example Testing' });
    await production.removeByPrefixes([cacheId]);
    expect(await production.read(cacheId)).toBeNull();
    expect(await testing.read(cacheId)).toEqual({ title: 'Example Testing' });
  });
});
