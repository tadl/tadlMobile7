import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { EMPTY, Observable, concat, distinctUntilChanged, filter, from, map, of, tap } from 'rxjs';

import { Globals } from '../globals';
import { AppCacheService } from './app-cache.service';

export interface AppLocation {
  id: number;
  shortname: string;
  fullname: string;
  group: string;
  address: string;
  citystatezip: string;
  phone: string;
  fax?: string;
  email?: string;
  image?: string;
  sunday?: string;
  monday?: string;
  tuesday?: string;
  wednesday?: string;
  thursday?: string;
  friday?: string;
  saturday?: string;
  sunday_open?: string | null;
  sunday_close?: string | null;
  monday_open?: string | null;
  monday_close?: string | null;
  tuesday_open?: string | null;
  tuesday_close?: string | null;
  wednesday_open?: string | null;
  wednesday_close?: string | null;
  thursday_open?: string | null;
  thursday_close?: string | null;
  friday_open?: string | null;
  friday_close?: string | null;
  saturday_open?: string | null;
  saturday_close?: string | null;
  exceptions?: AppLocationException[];
}

export interface AppLocationException {
  date?: string;
  hours?: string;
  reason?: string;
}

export type LocationWeekdayKey =
  | 'sunday'
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday';

export type LocationDayHours = {
  open: string | null;
  close: string | null;
};

const LOCATION_WEEKDAY_KEYS: LocationWeekdayKey[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

export function locationWeekdayKeys(): LocationWeekdayKey[] {
  return LOCATION_WEEKDAY_KEYS.slice();
}

export function getLocationDayHours(
  location: AppLocation | null | undefined,
  weekday: LocationWeekdayKey,
): LocationDayHours {
  const open = normalizeHoursValue((location as Record<string, unknown> | null)?.[`${weekday}_open`]);
  const close = normalizeHoursValue((location as Record<string, unknown> | null)?.[`${weekday}_close`]);
  return {
    open: open || null,
    close: close || null,
  };
}

export function isLocationClosed(
  location: AppLocation | null | undefined,
  weekday: LocationWeekdayKey,
): boolean {
  const { open, close } = getLocationDayHours(location, weekday);
  return !open || !close;
}

export function formatLocationDayHours(
  location: AppLocation | null | undefined,
  weekday: LocationWeekdayKey,
): string {
  const { open, close } = getLocationDayHours(location, weekday);
  if (!open || !close) return 'Closed';
  return `${open} to ${close}`;
}

export function parseClockLabelToMinutes(
  value: string | null | undefined,
): number | null {
  const raw = normalizeHoursValue(value);
  if (!raw) return null;

  const lower = raw.toLowerCase();
  if (lower === 'midnight') return 24 * 60;
  if (lower === 'noon') return 12 * 60;

  const match = raw.match(/^([0-9]{1,2})(?::([0-9]{2}))?\s*([AaPp][Mm])$/);
  if (!match) return null;

  const hour12 = Number(match[1]);
  const minutes = Number(match[2] ?? '0');
  const meridiem = (match[3] ?? '').toUpperCase();
  if (!Number.isFinite(hour12) || !Number.isFinite(minutes)) return null;

  let hour24 = hour12 % 12;
  if (meridiem === 'PM') hour24 += 12;
  return hour24 * 60 + minutes;
}

export function getLocationClosingMinutes(
  location: AppLocation | null | undefined,
  weekday: LocationWeekdayKey,
): number | null {
  const { open, close } = getLocationDayHours(location, weekday);
  if (!open || !close) return null;

  const openMinutes = parseClockLabelToMinutes(open);
  const closeMinutes = parseClockLabelToMinutes(close);
  if (openMinutes === null || closeMinutes === null) return null;

  return closeMinutes <= openMinutes ? closeMinutes + 24 * 60 : closeMinutes;
}

function normalizeHoursValue(value: unknown): string {
  const normalized = (value ?? '').toString().trim();
  if (!normalized) return '';
  if (normalized.toLowerCase() === 'closed') return '';
  return normalized;
}

@Injectable({ providedIn: 'root' })
export class LocationsService {
  private latestLocations: AppLocation[] | null = null;
  private readonly listCacheKey: string;

  constructor(
    private http: HttpClient,
    private globals: Globals,
    private cache: AppCacheService,
  ) {
    this.listCacheKey = `locations:list:${this.globals.locations_group}`;
  }

  getLocations(): Observable<AppLocation[]> {
    const memory$ = Array.isArray(this.latestLocations)
      ? of(this.latestLocations)
      : EMPTY;

    const cached$ = from(this.cache.read<AppLocation[]>(this.listCacheKey)).pipe(
      filter((v): v is AppLocation[] => Array.isArray(v)),
      tap((locations) => {
        this.latestLocations = locations;
      }),
    );

    const network$ = this.http
      .get<{ locations: AppLocation[] }>(this.globals.locations_list_url)
      .pipe(
        map((res) => Array.isArray(res?.locations) ? res.locations : []),
        tap((locations) => {
          void this.hydrateLocations(locations);
        }),
      );

    return concat(memory$, cached$, network$).pipe(
      distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
    );
  }

  getLatestLocationsSnapshot(): AppLocation[] {
    return Array.isArray(this.latestLocations) ? this.latestLocations.slice() : [];
  }

  async hydrateLocations(locations: AppLocation[]): Promise<void> {
    const normalized = Array.isArray(locations) ? locations : [];
    this.latestLocations = normalized;
    await this.cache.write(this.listCacheKey, normalized);

    await Promise.all(
      normalized.map((location) => {
        const shortname = (location?.shortname ?? '').toString().trim();
        if (!shortname) return Promise.resolve();
        return this.cache.write(`locations:detail:${shortname}`, location);
      }),
    );
  }

  getLocationByShortname(shortname: string, options?: { skipCache?: boolean }): Observable<AppLocation | null> {
    const s = (shortname ?? '').toString().trim();
    const cacheKey = `locations:detail:${s}`;
    const skipCache = options?.skipCache === true;

    const cached$ = from(this.cache.read<AppLocation>(cacheKey)).pipe(
      filter((v): v is AppLocation => !!v && typeof v === 'object'),
    );

    const network$ = this.http
      .get<{ locations: AppLocation[] }>(this.globals.locations_detail_url(s))
      .pipe(
        map((res) => (Array.isArray(res?.locations) ? res.locations[0] ?? null : null)),
        tap((location) => {
          if (location) this.cache.write(cacheKey, location).catch(() => {});
        }),
      );

    return skipCache ? network$ : concat(cached$, network$);
  }
}
