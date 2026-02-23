// src/app/services/item.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map, concat, from, filter, tap } from 'rxjs';
import { Globals } from '../globals';
import { AppCacheService } from './app-cache.service';

export type AspenWorkAction =
  | {
      title: string;
      url?: string;
      target?: string;
      requireLogin?: boolean;
      type?: string;
      onclick?: string;
      id?: string;
      btnType?: string;
      formatId?: number;
      sampleNumber?: number;
    }
  | any;

export interface AspenWorkFormat {
  label: string;
  category: string;
  actions: AspenWorkAction[];
  isAvailable: boolean;
  numRelatedRecords?: number;
}

export interface AspenGroupedWork {
  success?: boolean; // Aspen sometimes includes success at this level
  id: string;
  title: string;
  subtitle?: string;
  author?: string;
  description?: string;
  language?: string;
  cover?: string;

  series?: { seriesTitle: string; volume?: string }[] | null;

  // Key part:
  formats?: Record<string, AspenWorkFormat>;
}

export interface AspenHoldingItem {
  location?: string;
  callnumber?: string;
  status?: string;
  dueDate?: string;
  availability?: boolean;
  holdable?: number;

  statusFull?: string;
  statusfull?: string;

  // e.g. "ils:48283600"
  id?: string;
  number?: number;
  libraryDisplayName?: string;
  section?: string;
  sectionId?: number;
  lastCheckinDate?: string;
}

export interface AspenItemAvailabilityResult {
  id: string;
  holdings: Record<string, AspenHoldingItem[]>;
}

@Injectable({ providedIn: 'root' })
export class ItemService {
  constructor(
    private http: HttpClient,
    private globals: Globals,
    private cache: AppCacheService,
  ) {}

  /**
   * Work-level details (grouped work):
   * GET /API/WorkAPI?method=getGroupedWork&id=<groupedWorkKey>&api=tadl-prod
   */
  getGroupedWork(groupedWorkKey: string): Observable<AspenGroupedWork> {
    const key = (groupedWorkKey || '').trim();
    const params = new HttpParams()
      .set('method', 'getGroupedWork')
      .set('id', key);

    const cacheKey = `item:groupedWork:${key}`;
    const cached$ = from(this.cache.read<AspenGroupedWork>(cacheKey)).pipe(
      filter((v): v is AspenGroupedWork => !!v && typeof v === 'object'),
    );

    const network$ = this.http
      .get<any>(`${this.globals.aspen_api_base}/WorkAPI`, { params })
      .pipe(
        map(raw => (raw?.result ?? raw) as AspenGroupedWork),
        tap((work) => {
          this.cache.write(cacheKey, work).catch(() => {});
        }),
      );

    return concat(cached$, network$);
  }

  /**
   * Holdings / availability (ILS only):
   * GET /API/ItemAPI?method=getItemAvailability&id=<ilsNumericId>&api=tadl-prod
   *
   * IMPORTANT:
   * - Passing "ils:48283600" does NOT work; Aspen expects bare numeric id.
   * - This does not apply to hoopla/overdrive ids.
   */
  getIlsItemAvailability(id: string): Observable<AspenItemAvailabilityResult> {
    const numeric = this.stripIlsPrefix(id);

    const params = new HttpParams()
      .set('method', 'getItemAvailability')
      .set('id', numeric);

    const cacheKey = `item:availability:${numeric}`;
    const cached$ = from(this.cache.read<AspenItemAvailabilityResult>(cacheKey)).pipe(
      filter((v): v is AspenItemAvailabilityResult => !!v && typeof v === 'object'),
    );

    const network$ = this.http
      .get<any>(`${this.globals.aspen_api_base}/ItemAPI`, { params })
      .pipe(
        map(raw => (raw?.result ?? raw) as AspenItemAvailabilityResult),
        tap((availability) => {
          this.cache.write(cacheKey, availability).catch(() => {});
        }),
      );

    return concat(cached$, network$);
  }

  stripIlsPrefix(id: string): string {
    const s = (id || '').trim();
    if (s.startsWith('ils:')) return s.slice(4);
    return s;
  }

  /**
   * Extract ILS record id from Aspen "Place Hold" onclick strings.
   * Example:
   * return AspenDiscovery.Record.showPlaceHold('Record', 'ils', '48283600', '', '243863');
   */
  extractIlsIdFromOnclick(onclick?: string): string | null {
    if (!onclick) return null;

    const m = onclick.match(/showPlaceHold\([^)]*'ils'\s*,\s*'(\d+)'/i);
    if (m?.[1]) return m[1];

    return null;
  }

  /**
   * Returns unique numeric ILS ids found within WorkAPI formats/actions.
   */
  extractIlsIdsFromGroupedWork(work?: AspenGroupedWork): string[] {
    const formats = work?.formats ?? {};
    const ids = new Set<string>();

    for (const fmt of Object.values(formats)) {
      for (const action of fmt.actions ?? []) {
        const onclick = (action as any)?.onclick as string | undefined;
        const id = this.extractIlsIdFromOnclick(onclick);
        if (id) ids.add(id);
      }
    }

    return Array.from(ids);
  }
}
