import { APP_PROFILE } from '../app-profile';

/** Keep installed production accounts intact while isolating test builds. */
export function backendStorageKey(key: string, backend = APP_PROFILE.aspenApiParam): string {
  return backend.endsWith('-test') ? `${backend}:${key}` : key;
}
