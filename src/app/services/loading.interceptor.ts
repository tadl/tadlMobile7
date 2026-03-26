import { Injectable } from '@angular/core';
import {
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpRequest,
} from '@angular/common/http';
import { Observable } from 'rxjs';
import { timeout } from 'rxjs/operators';
import { finalize } from 'rxjs/operators';
import { LoadingService } from './loading.service';

@Injectable()
export class LoadingInterceptor implements HttpInterceptor {
  private static readonly DEFAULT_REQUEST_TIMEOUT_MS = 20000;

  constructor(private loading: LoadingService) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    // Optional escape hatch: allow callers to set a header to skip global loading
    if (req.headers.get('x-skip-global-loading') === '1') {
      return this.applyTimeoutIfNeeded(req, next);
    }

    this.loading.start();
    return this.applyTimeoutIfNeeded(req, next).pipe(finalize(() => this.loading.stop()));
  }

  private applyTimeoutIfNeeded(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    if (req.headers.get('x-skip-request-timeout') === '1') {
      return next.handle(req);
    }

    return next.handle(req).pipe(timeout(LoadingInterceptor.DEFAULT_REQUEST_TIMEOUT_MS));
  }
}
