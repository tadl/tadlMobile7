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
  registration_enabled?: boolean | null;
  registration_type?: string | null;
  registration_start?: string | null;
  registration_end?: string | null;
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
        events: res.events.filter((event) => this.shouldIncludeEvent(event)),
      })),
    );

    const network$ = this.http.get<MobileEventsResponse>(this.baseUrl, { params }).pipe(
      tap((res) => {
        if (Array.isArray(res?.events)) {
          res.events = res.events.filter((event) => this.shouldIncludeEvent(event));
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

  private shouldIncludeEvent(event: MobileEvent | null | undefined): boolean {
    if (!event) return false;
    if (this.isMidnightOnlyEvent(event)) return false;

    const now = Date.now();
    const start = this.parseDate((event.start_date ?? '').toString().trim());
    const explicitEnd = this.parseDate((event.end_date ?? '').toString().trim());
    const inferredEnd = this.inferEventEnd(start, explicitEnd);

    // Primary rule: hide events that have ended.
    if (inferredEnd && now > inferredEnd.getTime()) return false;

    // Safety fallback: if we only have a start date and no usable end,
    // do not keep stale entries older than 24h after start.
    if (!inferredEnd && start && now - start.getTime() > 24 * 60 * 60 * 1000) return false;

    return true;
  }

  private inferEventEnd(start: Date | null, explicitEnd: Date | null): Date | null {
    if (explicitEnd) return explicitEnd;
    if (!start) return null;

    const isMidnightStart =
      start.getHours() === 0 &&
      start.getMinutes() === 0 &&
      start.getSeconds() === 0;

    if (isMidnightStart) {
      const endOfDay = new Date(start);
      endOfDay.setHours(23, 59, 59, 999);
      return endOfDay;
    }

    // Missing end date fallback for normal events.
    return new Date(start.getTime() + (2 * 60 * 60 * 1000));
  }

  private parseDate(raw: string): Date | null {
    const s = (raw ?? '').toString().trim();
    if (!s) return null;
    if (s === '0' || /^0+$/.test(s)) return null;
    if (s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined') return null;
    if (s === '0000-00-00' || s.startsWith('0000-00-00 ')) return null;

    const normalized = s.includes('T') ? s : s.replace(' ', 'T');
    const d = new Date(normalized);
    return Number.isNaN(d.getTime()) ? null : d;
  }
}
