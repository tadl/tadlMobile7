import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { catchError, map, Observable, throwError } from 'rxjs';

import { Globals } from '../globals';

export interface PasswordResetRequest {
  username: string;
  email: string;
}

export interface PasswordResetResult {
  success: boolean;
  message?: string;
  action?: string | null;
}

@Injectable({ providedIn: 'root' })
export class PasswordResetService {
  constructor(
    private http: HttpClient,
    private globals: Globals,
  ) {}

  submitResetRequest(input: PasswordResetRequest): Observable<PasswordResetResult> {
    const username = (input?.username ?? '').toString().trim();
    const email = (input?.email ?? '').toString().trim();
    const body = new URLSearchParams();
    body.set('username', username);
    body.set('email', email);

    const headers = new HttpHeaders({
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    });
    const params = new HttpParams().set('method', 'resetPassword');

    return this.http.post<any>(
      `${this.globals.aspen_api_base}/UserAPI`,
      body.toString(),
      {
        params,
        headers,
      },
    ).pipe(
      map((raw) => {
        const result = raw?.result ?? raw ?? {};
        return {
          success: !!result?.success,
          message: typeof result?.message === 'string' ? result.message : undefined,
          action: typeof result?.action === 'string' ? result.action : null,
        } satisfies PasswordResetResult;
      }),
      catchError((err) => {
        const status = Number(err?.status ?? 0);
        if (status === 0) return throwError(() => new Error('password_reset_network_error'));
        return throwError(() => new Error('password_reset_failed'));
      }),
    );
  }

}
