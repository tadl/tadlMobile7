import { Injectable } from '@angular/core';
import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { Observable, tap } from 'rxjs';

import { Globals } from '../globals';
import { ServiceAlertService } from './service-alert.service';

@Injectable()
export class ServiceAlertInterceptor implements HttpInterceptor {
  constructor(
    private globals: Globals,
    private serviceAlerts: ServiceAlertService,
  ) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    if (!this.isProxyRequest(req.url)) {
      return next.handle(req);
    }

    return next.handle(req).pipe(
      tap({
        next: (event) => {
          if (!(event instanceof HttpResponse)) return;
          const alert = this.extractServiceAlert(event.body);
          if (alert) {
            void this.serviceAlerts.set(alert);
            return;
          }
          if (this.isCacheWarmRequest(req.url) && this.isConfirmedCacheWarmSuccess(event.body)) {
            void this.serviceAlerts.clear();
          }
        },
        error: (error) => {
          if (!(error instanceof HttpErrorResponse)) return;
          const alert = this.extractServiceAlert(error.error);
          if (!alert) return;
          void this.serviceAlerts.set(alert);
        },
      }),
    );
  }

  private isProxyRequest(url: string): boolean {
    const apiBase = (this.globals.aspen_api_base ?? '').replace(/\/+$/, '');
    return !!apiBase && (url ?? '').startsWith(apiBase);
  }

  private isCacheWarmRequest(url: string): boolean {
    const apiBase = (this.globals.aspen_api_base ?? '').replace(/\/+$/, '');
    return !!apiBase && (url ?? '').startsWith(`${apiBase}/CacheWarm`);
  }

  private extractServiceAlert(payload: any): string | null {
    const direct = (payload?.serviceAlert ?? '').toString().trim();
    if (direct) return direct;

    const resultAlert = (payload?.result?.serviceAlert ?? '').toString().trim();
    if (resultAlert) return resultAlert;

    return null;
  }

  private isConfirmedCacheWarmSuccess(payload: any): boolean {
    return payload?.ok === true;
  }
}
