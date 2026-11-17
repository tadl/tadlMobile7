import { fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { Preferences } from '@capacitor/preferences';
import { PreferencesWeb } from '@capacitor/preferences/dist/esm/web';

import { AppCacheService } from './app-cache.service';
import { backendStorageKey } from './backend-storage';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}

describe('AppCache storage ordering', () => {
  let cache: AppCacheService;
  let stored: Map<string, string>;
  let set: jasmine.Spy<PreferencesWeb['set']>;
  let get: jasmine.Spy<PreferencesWeb['get']>;
  let remove: jasmine.Spy<PreferencesWeb['remove']>;
  let keys: jasmine.Spy<PreferencesWeb['keys']>;
  const storageKey = (key: string) => backendStorageKey('cache:v1:') + key;
  const valueFor = (key: string): unknown => {
    const value = stored.get(storageKey(key));
    return value ? JSON.parse(value).value : undefined;
  };

  beforeAll(async () => {
    // Capacitor's proxy recreates method wrappers, so spy on its web implementation.
    await Preferences.keys();
  });

  beforeEach(() => {
    stored = new Map();
    set = spyOn(PreferencesWeb.prototype, 'set').and.callFake(async ({ key, value }) => { stored.set(key, value); });
    get = spyOn(PreferencesWeb.prototype, 'get').and.callFake(async ({ key }) => ({ value: stored.get(key) ?? null }));
    remove = spyOn(PreferencesWeb.prototype, 'remove').and.callFake(async ({ key }) => { stored.delete(key); });
    keys = spyOn(PreferencesWeb.prototype, 'keys').and.callFake(async () => ({ keys: [...stored.keys()] }));
    cache = new AppCacheService();
  });

  it('persists the newest value even when it equals the value before a pending write', fakeAsync(() => {
    void cache.write('holds:a', []);
    flushMicrotasks();
    const first = deferred<void>();
    let call = 0;
    set.and.callFake(async ({ key, value }) => {
      if (++call === 1) await first.promise;
      stored.set(key, value);
    });
    void cache.write('holds:a', [{ id: 'synthetic-hold' }]);
    void cache.write('holds:a', []);
    flushMicrotasks();
    expect(call).toBe(1);
    first.resolve();
    flushMicrotasks();
    expect(call).toBe(2);
    expect(valueFor('holds:a')).toEqual([]);
  }));

  it('still skips identical writes after the earlier write has settled', fakeAsync(() => {
    void cache.write('key', { value: 'synthetic' });
    void cache.write('key', { value: 'synthetic' });
    flushMicrotasks();
    expect(set).toHaveBeenCalledTimes(1);
  }));

  it('keeps unrelated keys independent', fakeAsync(() => {
    const first = deferred<void>();
    set.and.callFake(async ({ key, value }) => {
      if (key === storageKey('a')) await first.promise;
      stored.set(key, value);
    });
    void cache.write('a', 'pending');
    void cache.write('b', 'ready');
    flushMicrotasks();
    expect(valueFor('a')).toBeUndefined();
    expect(valueFor('b')).toBe('ready');
    first.resolve();
    flushMicrotasks();
  }));

  it('orders reads after pending writes so stale reads cannot corrupt deduplication', fakeAsync(() => {
    const first = deferred<void>();
    set.and.callFake(async ({ key, value }) => { await first.promise; stored.set(key, value); });
    void cache.write('key', 'fresh');
    let received: unknown;
    void cache.read('key').then(value => { received = value; });
    flushMicrotasks();
    expect(get).not.toHaveBeenCalled();
    first.resolve();
    flushMicrotasks();
    expect(received).toBe('fresh');
  }));

  it('removes a key after its pending write and permits an identical later value', fakeAsync(() => {
    const first = deferred<void>();
    set.and.callFake(async ({ key, value }) => { await first.promise; stored.set(key, value); });
    void cache.write('key', 'synthetic');
    void cache.remove('key');
    flushMicrotasks();
    expect(remove).not.toHaveBeenCalled();
    first.resolve();
    flushMicrotasks();
    expect(valueFor('key')).toBeUndefined();
    void cache.write('key', 'synthetic');
    flushMicrotasks();
    expect(valueFor('key')).toBe('synthetic');
    expect(set).toHaveBeenCalledTimes(2);
  }));

  it('prefix cleanup includes new keys whose writes are not yet visible on disk', fakeAsync(() => {
    const first = deferred<void>();
    set.and.callFake(async ({ key, value }) => { await first.promise; stored.set(key, value); });
    void cache.write('lists:a', ['synthetic-list']);
    let cleaned = false;
    void cache.removeByPrefixes(['lists:']).then(() => { cleaned = true; });
    flushMicrotasks();
    expect(cleaned).toBeFalse();
    first.resolve();
    flushMicrotasks();
    expect(cleaned).toBeTrue();
    expect(valueFor('lists:a')).toBeUndefined();
  }));

  it('preserves a new write requested after cleanup begins', fakeAsync(() => {
    const listed = deferred<{ keys: string[] }>();
    keys.and.returnValue(listed.promise);
    void cache.removeByPrefixes(['preferences:']);
    void cache.write('preferences:a', 'fresh');
    flushMicrotasks();
    expect(set).not.toHaveBeenCalled();
    listed.resolve({ keys: [] });
    flushMicrotasks();
    expect(valueFor('preferences:a')).toBe('fresh');
  }));

  it('waits for all removals on a partial cleanup failure before allowing later writes', fakeAsync(() => {
    void cache.write('lists:a', 'old-a');
    void cache.write('lists:b', 'old-b');
    flushMicrotasks();
    set.calls.reset();
    const removedB = deferred<void>();
    remove.and.callFake(async ({ key }) => {
      if (key === storageKey('lists:a')) throw new Error('Synthetic removal failure');
      await removedB.promise;
      stored.delete(key);
    });
    const error = jasmine.createSpy();
    void cache.removeByPrefixes(['lists:']).catch(error);
    void cache.write('lists:b', 'new-b');
    flushMicrotasks();
    expect(set).not.toHaveBeenCalled();
    removedB.resolve();
    flushMicrotasks();
    expect(error).toHaveBeenCalledTimes(1);
    expect(valueFor('lists:b')).toBe('new-b');
  }));

  it('invalidates deduplication after a native write rejects with a side effect', fakeAsync(() => {
    void cache.write('key', 'old');
    flushMicrotasks();
    let fail = true;
    set.and.callFake(async ({ key, value }) => {
      stored.set(key, value);
      if (fail) { fail = false; throw new Error('Synthetic write failure'); }
    });
    const error = jasmine.createSpy();
    void cache.write('key', 'new').catch(error);
    void cache.write('key', 'old');
    flushMicrotasks();
    expect(error).toHaveBeenCalledTimes(1);
    expect(valueFor('key')).toBe('old');
  }));

  it('writes a previously seen value after a read confirms its storage entry is missing', fakeAsync(() => {
    void cache.write('key', 'synthetic');
    flushMicrotasks();
    stored.delete(storageKey('key'));
    void cache.read('key');
    flushMicrotasks();
    void cache.write('key', 'synthetic');
    flushMicrotasks();
    expect(valueFor('key')).toBe('synthetic');
    expect(set).toHaveBeenCalledTimes(2);
  }));

  it('can restore an earlier value after rejecting an oversized cache entry', fakeAsync(() => {
    void cache.write('key', 'synthetic');
    flushMicrotasks();
    void cache.write('key', 'x'.repeat(1_000_001));
    flushMicrotasks();
    expect(valueFor('key')).toBeUndefined();
    void cache.write('key', 'synthetic');
    flushMicrotasks();
    expect(valueFor('key')).toBe('synthetic');
  }));

  it('ignores blank cleanup prefixes instead of clearing the whole cache', fakeAsync(() => {
    void cache.write('key', 'synthetic');
    flushMicrotasks();
    void cache.removeByPrefixes(['', '  ']);
    flushMicrotasks();
    expect(keys).not.toHaveBeenCalled();
    expect(valueFor('key')).toBe('synthetic');
  }));
});
