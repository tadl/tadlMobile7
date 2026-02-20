// src/app/services/patron.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpParams, HttpHeaders } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { Globals } from '../globals';

export interface AspenPatronProfileResponse {
  success: boolean;
  profile?: any;
  message?: string;
}

export interface PatronBadges {
  checkouts: number;
  holds: number;
  ready: number;
  finesVal: number;
  finesText?: string;
}

@Injectable({ providedIn: 'root' })
export class PatronService {
  constructor(private http: HttpClient, private globals: Globals) {}

  /**
   * Aspen LiDA-style:
   * POST /API/UserAPI?method=getPatronProfile&linkedUsers=true&checkIfValid=false&api=tadl-prod
   * Body: x-www-form-urlencoded (or FormData) with username/password
   *
   * Your proxy currently requires api=tadl-prod for ILS requests, so we include it via globals.
   */
  getPatronProfile(username: string, password: string): Observable<AspenPatronProfileResponse> {
    const params = new HttpParams()
      .set('method', 'getPatronProfile')
      .set('linkedUsers', 'true')
      .set('checkIfValid', 'false');

    // NOTE: Angular will send JSON by default. Aspen tends to like form posts.
    // We’ll use URL-encoded form data to keep it simple.
    const body = new URLSearchParams();
    body.set('username', username);
    body.set('password', password);

    const headers = new HttpHeaders({
      'Content-Type': 'application/x-www-form-urlencoded',
    });

    return this.http
      .post<any>(`${this.globals.aspen_api_base}/UserAPI`, body.toString(), { params, headers })
      .pipe(
        map(raw => {
          const r = raw?.result ?? raw;
          return {
            success: !!r?.success,
            profile: r?.profile,
            message: r?.message,
          } satisfies AspenPatronProfileResponse;
        }),
      );
  }

  badgesFromProfile(profile: any): PatronBadges {
    // Prefer the aggregate counts (these match what you want in the menu)
    const checkouts = this.asNumber(profile?.numCheckedOut) ?? this.asNumber(profile?.numCheckedOutIls) ?? 0;
    const holds = this.asNumber(profile?.numHolds) ?? this.asNumber(profile?.numHoldsIls) ?? 0;
    const ready = this.asNumber(profile?.numHoldsAvailable) ?? this.asNumber(profile?.numHoldsAvailableIls) ?? 0;

    const finesVal = this.asNumber(profile?.finesVal) ?? 0;
    const finesText = typeof profile?.fines === 'string' ? profile.fines : undefined;

    return { checkouts, holds, ready, finesVal, finesText };
  }

  displayNameFromProfile(profile: any): string {
    // Your payload has firstname/lastname and fullname like "ROCKWOOD,William"
    const dn = (profile?.displayName ?? '').trim();
    if (dn) return dn;

    const first = (profile?.firstname ?? '').trim();
    const last = (profile?.lastname ?? '').trim();
    const combined = `${first} ${last}`.trim();
    if (combined) return combined.toUpperCase();

    const fn = (profile?.fullname ?? '').trim();
    return fn ? fn.toUpperCase() : 'UNKNOWN USER';
  }

  private asNumber(v: any): number | null {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
}
