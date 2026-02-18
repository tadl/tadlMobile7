import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface VenueOption {
  id: number;
  name: string;
}

export interface MobileEvent {
  title: string;
  start_date: string; // "YYYY-MM-DD HH:MM:SS"
  location: string;
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

  constructor(private http: HttpClient) {}

  getEvents(venue: 'all' | number): Observable<MobileEventsResponse> {
    const params = new HttpParams().set('venue', String(venue));
    return this.http.get<MobileEventsResponse>(this.baseUrl, { params });
  }
}
