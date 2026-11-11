export interface AppConfigLocation {
  evergreenId: number;
  aspenId: number | null;
  pickupCode: string | null;
  shortname: string;
  name: string;
  pickupEnabled: boolean;
}

export interface AppConfigSearchScope {
  id: string;
  name: string;
  filters: string[];
}

export interface AppConfig {
  schemaVersion: 1;
  backend: string;
  revision: string;
  locations: AppConfigLocation[];
  searchScopes: AppConfigSearchScope[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string' || value.length > maxLength) return null;
  const normalized = value.trim();
  if (!normalized || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return normalized;
}

function isId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** Reject the entire response so a partial mapping cannot misroute a hold. */
export function parseAppConfig(value: unknown, expectedBackend: string): AppConfig | null {
  if (!isRecord(value) || value['schemaVersion'] !== 1) return null;
  const backend = text(value['backend'], 80);
  const revision = text(value['revision'], 128);
  if (backend !== expectedBackend || !revision) return null;

  const rawLocations = value['locations'];
  const rawScopes = value['searchScopes'];
  if (!Array.isArray(rawLocations) || !rawLocations.length || rawLocations.length > 100) return null;
  if (!Array.isArray(rawScopes) || !rawScopes.length || rawScopes.length > 100) return null;

  const locations: AppConfigLocation[] = [];
  const evergreenIds = new Set<number>();
  const aspenIds = new Set<number>();
  const pickupCodes = new Set<string>();
  const shortnames = new Set<string>();
  for (const raw of rawLocations) {
    if (!isRecord(raw) || !isId(raw['evergreenId'])) return null;
    const evergreenId = raw['evergreenId'];
    const aspenId = raw['aspenId'];
    const pickupCode = raw['pickupCode'] === null ? null : text(raw['pickupCode'], 80);
    const shortname = text(raw['shortname'], 128);
    const name = text(raw['name'], 160);
    const pickupEnabled = raw['pickupEnabled'];
    if (aspenId !== null && !isId(aspenId)) return null;
    if (raw['pickupCode'] !== null && !pickupCode) return null;
    if (pickupCode && !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(pickupCode)) return null;
    if (!shortname || !name || typeof pickupEnabled !== 'boolean') return null;
    if (pickupEnabled && (aspenId === null || pickupCode === null)) return null;
    if (evergreenIds.has(evergreenId) || shortnames.has(shortname)) return null;
    if (aspenId !== null && aspenIds.has(aspenId)) return null;
    if (pickupCode !== null && pickupCodes.has(pickupCode)) return null;
    evergreenIds.add(evergreenId);
    shortnames.add(shortname);
    if (aspenId !== null) aspenIds.add(aspenId);
    if (pickupCode !== null) pickupCodes.add(pickupCode);
    locations.push({ evergreenId, aspenId, pickupCode, shortname, name, pickupEnabled });
  }
  if (!locations.some(location => location.pickupEnabled)) return null;

  const searchScopes: AppConfigSearchScope[] = [];
  const scopeIds = new Set<string>();
  for (const raw of rawScopes) {
    if (!isRecord(raw)) return null;
    const id = text(raw['id'], 128);
    const name = text(raw['name'], 160);
    const rawFilters = raw['filters'];
    if (!id || !name || scopeIds.has(id)) return null;
    if (!Array.isArray(rawFilters) || rawFilters.length > 20) return null;
    const filters: string[] = [];
    for (const rawFilter of rawFilters) {
      const filter = text(rawFilter, 256);
      if (!filter) return null;
      filters.push(filter);
    }
    scopeIds.add(id);
    searchScopes.push({ id, name, filters });
  }
  if (!searchScopes.some(scope => scope.id === 'all' && scope.filters.length === 0)) return null;

  return { schemaVersion: 1, backend, revision, locations, searchScopes };
}
