import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, concat, from, filter, map, tap } from 'rxjs';
import { AppCacheService } from './app-cache.service';

export interface VenueOption {
  id: number;
  name: string;
}

export interface MobileEvent {
  title: string;
  start_date: string; // "YYYY-MM-DD HH:MM:SS"
  end_date?: string | null;
  location: string;
  room?: string | null;
  age_group?: string[] | null;
  image: string | null;
  url: string;
  description: string | null;
}

export interface MobileEventsResponse {
  events: MobileEvent[];
  all_venues?: VenueOption[];
}

@Injectable({ providedIn: 'root' })
export class EventsService {
  private readonly baseUrl = 'https://feeds.tools.tadl.org/mobile_events.json';

  constructor(
    private http: HttpClient,
    private cache: AppCacheService,
  ) {}

  getEvents(venue: 'all' | number): Observable<MobileEventsResponse> {
    const v = String(venue);
    const params = new HttpParams().set('venue', v);
    const cacheKey = `events:venue:${v}`;

    const cached$ = from(this.cache.read<MobileEventsResponse>(cacheKey)).pipe(
      filter((r): r is MobileEventsResponse => !!r && Array.isArray(r.events)),
      map((res) => ({
        ...res,
        events: res.events.filter((event) => !this.isMidnightOnlyEvent(event)),
      })),
    );

    const network$ = this.http.get<MobileEventsResponse>(this.baseUrl, { params }).pipe(
      tap((res) => {
        if (Array.isArray(res?.events)) {
          res.events = res.events.filter((event) => !this.isMidnightOnlyEvent(event));
        }
      }),
      tap((res) => {
        this.cache.write(cacheKey, res).catch(() => {});
      }),
    );

    return concat(cached$, network$);
  }

  private isMidnightOnlyEvent(event: MobileEvent | null | undefined): boolean {
    const start = (event?.start_date ?? '').toString().trim();
    const end = (event?.end_date ?? '').toString().trim();
    if (!start || !end) return false;
    return start.endsWith('00:00:00') && end.endsWith('00:00:00');
  }
}
