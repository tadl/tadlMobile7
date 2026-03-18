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
  exceptions?: AppLocationException[];
}

export interface AppLocationException {
  date?: string;
  hours?: string;
  reason?: string;
}

@Injectable({ providedIn: 'root' })
export class LocationsService {
  private latestLocations: AppLocation[] | null = null;

  constructor(
    private http: HttpClient,
    private globals: Globals,
    private cache: AppCacheService,
  ) {}

  getLocations(): Observable<AppLocation[]> {
    const cacheKey = `locations:list:${this.globals.locations_group}`;
    const memory$ = Array.isArray(this.latestLocations)
      ? of(this.latestLocations)
      : EMPTY;

    const cached$ = from(this.cache.read<AppLocation[]>(cacheKey)).pipe(
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
          this.latestLocations = locations;
          this.cache.write(cacheKey, locations).catch(() => {});
        }),
      );

    return concat(memory$, cached$, network$).pipe(
      distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
    );
  }

  getLatestLocationsSnapshot(): AppLocation[] {
    return Array.isArray(this.latestLocations) ? this.latestLocations.slice() : [];
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
