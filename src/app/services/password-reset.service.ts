import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { catchError, map, Observable, throwError } from 'rxjs';

import { Globals } from '../globals';

export interface PasswordResetRequest {
  username: string;
  email: string;
}

@Injectable({ providedIn: 'root' })
export class PasswordResetService {
  constructor(
    private http: HttpClient,
    private globals: Globals,
  ) {}

  submitResetRequest(input: PasswordResetRequest): Observable<void> {
    const username = (input?.username ?? '').toString().trim();
    const email = (input?.email ?? '').toString().trim();
    const body = new URLSearchParams();
    body.set('username', username);
    body.set('email', email);
    body.set('submit', 'Reset My Password');

    const headers = new HttpHeaders({
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    });

    return this.http.post(
      `${this.globals.aspen_discovery_base}/MyAccount/EmailResetPin`,
      body.toString(),
      {
        headers,
        observe: 'response',
        responseType: 'text',
      },
    ).pipe(
      map(() => void 0),
      catchError((err) => {
        const status = Number(err?.status ?? 0);
        if (status === 0) return throwError(() => new Error('password_reset_network_or_cors'));
        return throwError(() => new Error('password_reset_failed'));
      }),
    );
  }

}
