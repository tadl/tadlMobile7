import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, concat, from, filter, map, tap } from 'rxjs';
import { AppCacheService } from './app-cache.service';
import { APP_PROFILE } from '../app-profile';

export interface VenueOption {
  id: number;
  name: string;
}

export interface MobileEvent {
  id?: string | number;
  title: string;
  start_date: string; // "YYYY-MM-DD HH:MM:SS"
  end_date?: string | null;
  moderation_state?: string | null;
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
  allDay?: boolean;
  timezone?: string | null;
  tags?: string[];
}

export interface MobileEventsResponse {
  events: MobileEvent[];
  all_venues?: VenueOption[];
}

interface WordPressTaxonomy {
  name?: string;
}

interface WordPressImage {
  url?: string;
  sizes?: Record<string, { url?: string }>;
}

interface WordPressEvent {
  id?: string | number;
  status?: string;
  title?: string;
  description?: string;
  excerpt?: string;
  start_date?: string;
  end_date?: string;
  all_day?: boolean;
  timezone?: string;
  url?: string;
  image?: WordPressImage | null;
  categories?: WordPressTaxonomy[];
  tags?: WordPressTaxonomy[];
  venue?: {
    venue?: string;
    city?: string;
  } | null;
}

interface WordPressEventsResponse {
  events?: WordPressEvent[];
}

@Injectable({ providedIn: 'root' })
export class EventsService {
  private http = inject(HttpClient);
  private cache = inject(AppCacheService);

  getEvents(venue: 'all' | number): Observable<MobileEventsResponse> {
    const v = String(venue);
    const cacheKey = `events:${APP_PROFILE.events.provider}:venue:${v}`;

    const cached$ = from(this.cache.read<MobileEventsResponse>(cacheKey)).pipe(
      filter((r): r is MobileEventsResponse => !!r && Array.isArray(r.events)),
      map((res) => ({
        ...res,
        events: res.events.filter((event) => this.shouldIncludeEvent(event)),
      }))
    );

    const network$ = this.fetchEvents(venue)
      .pipe(
        tap((res) => {
          if (Array.isArray(res?.events)) {
            res.events = res.events.filter((event) =>
              this.shouldIncludeEvent(event)
            );
          }
        }),
        tap((res) => {
          this.cache.write(cacheKey, res).catch(() => {});
        })
      );

    return concat(cached$, network$);
  }

  private fetchEvents(venue: 'all' | number): Observable<MobileEventsResponse> {
    if (APP_PROFILE.events.provider === 'wordpress-tribe') {
      return this.http
        .get<WordPressEventsResponse>(APP_PROFILE.events.url)
        .pipe(map((response) => this.normalizeWordPressResponse(response)));
    }

    const params = new HttpParams().set('venue', String(venue));
    return this.http.get<MobileEventsResponse>(APP_PROFILE.events.url, {
      params,
    });
  }

  private normalizeWordPressResponse(
    response: WordPressEventsResponse
  ): MobileEventsResponse {
    const events = Array.isArray(response?.events)
      ? response.events.map((event) => this.normalizeWordPressEvent(event))
      : [];

    return { events, all_venues: [] };
  }

  private normalizeWordPressEvent(event: WordPressEvent): MobileEvent {
    const categoryNames = this.taxonomyNames(event?.categories);
    const tagNames = this.taxonomyNames(event?.tags);
    const image =
      event?.image?.sizes?.['medium_large']?.url ??
      event?.image?.sizes?.['medium']?.url ??
      event?.image?.url ??
      null;
    const status = (event?.status ?? '').toString().trim().toLowerCase();

    return {
      id: event?.id,
      title: (event?.title ?? 'Event').toString(),
      start_date: (event?.start_date ?? '').toString(),
      end_date: (event?.end_date ?? '').toString() || null,
      moderation_state:
        status === 'cancelled' || status === 'canceled' ? 'cancelled' : status,
      registration_enabled: false,
      registration_type: null,
      registration_start: null,
      registration_end: null,
      location:
        (event?.venue?.venue ?? event?.venue?.city ?? APP_PROFILE.libraryName)
          .toString()
          .trim() || APP_PROFILE.libraryName,
      room: null,
      age_group: categoryNames.length ? categoryNames : null,
      image,
      url: (event?.url ?? APP_PROFILE.websiteBase).toString(),
      description:
        (event?.description ?? event?.excerpt ?? '').toString() || null,
      allDay: event?.all_day === true,
      timezone: (event?.timezone ?? '').toString() || null,
      tags: Array.from(new Set([...categoryNames, ...tagNames])),
    };
  }

  private taxonomyNames(
    values: WordPressTaxonomy[] | null | undefined
  ): string[] {
    if (!Array.isArray(values)) return [];
    return values
      .map((value) => (value?.name ?? '').toString().trim())
      .filter((value) => !!value);
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
    const explicitEnd = this.parseDate(
      (event.end_date ?? '').toString().trim()
    );
    const inferredEnd = this.inferEventEnd(start, explicitEnd);

    // Primary rule: hide events that have ended.
    if (inferredEnd && now > inferredEnd.getTime()) return false;

    // Safety fallback: if we only have a start date and no usable end,
    // do not keep stale entries older than 24h after start.
    if (!inferredEnd && start && now - start.getTime() > 24 * 60 * 60 * 1000)
      return false;

    return true;
  }

  private inferEventEnd(
    start: Date | null,
    explicitEnd: Date | null
  ): Date | null {
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
    return new Date(start.getTime() + 2 * 60 * 60 * 1000);
  }

  private parseDate(raw: string): Date | null {
    const s = (raw ?? '').toString().trim();
    if (!s) return null;
    if (s === '0' || /^0+$/.test(s)) return null;
    if (s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined')
      return null;
    if (s === '0000-00-00' || s.startsWith('0000-00-00 ')) return null;

    const normalized = s.includes('T') ? s : s.replace(' ', 'T');
    const d = new Date(normalized);
    return Number.isNaN(d.getTime()) ? null : d;
  }
}
