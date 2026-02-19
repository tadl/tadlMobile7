// src/app/services/aspen-api-params.interceptor.ts
import { Injectable } from '@angular/core';
import {
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpParams,
  HttpRequest,
} from '@angular/common/http';
import { Observable } from 'rxjs';

import { Globals } from '../globals';
import { ASPEN_API_QUERY_PARAMS } from './aspen-api.config';

@Injectable()
export class AspenApiParamsInterceptor implements HttpInterceptor {
  constructor(private globals: Globals) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    const aspenBase = (this.globals.aspen_api_base ?? '').replace(/\/+$/, '');
    const url = req.url;

    if (!aspenBase || !url.startsWith(aspenBase)) {
      return next.handle(req);
    }

    let params: HttpParams = req.params ?? new HttpParams();

    for (const [k, v] of Object.entries(ASPEN_API_QUERY_PARAMS)) {
      params = params.set(k, v);
    }

    return next.handle(req.clone({ params }));
  }
}
