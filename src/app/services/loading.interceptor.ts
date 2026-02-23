import { Injectable } from '@angular/core';
import {
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpRequest,
} from '@angular/common/http';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { LoadingService } from './loading.service';

@Injectable()
export class LoadingInterceptor implements HttpInterceptor {
  constructor(private loading: LoadingService) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    // Optional escape hatch: allow callers to set a header to skip global loading
    if (req.headers.get('x-skip-global-loading') === '1') {
      return next.handle(req);
    }

    this.loading.start();
    return next.handle(req).pipe(finalize(() => this.loading.stop()));
  }
}
