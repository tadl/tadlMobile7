import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, concat, filter, from, map, tap } from 'rxjs';

import { AppCacheService } from './app-cache.service';

export interface WebcamFeedItem {
  title: string;
  subtitle?: string | null;
  youtube_url: string;
  embed_url: string;
  active?: boolean | null;
  sort_order?: number | null;
}

@Injectable({ providedIn: 'root' })
export class WebcamsService {
  private readonly baseUrl = 'https://feeds.tools.tadl.org/webcams.json';

  constructor(
    private http: HttpClient,
    private cache: AppCacheService,
  ) {}

  getWebcams(): Observable<WebcamFeedItem[]> {
    const cacheKey = 'webcams:items';
    const cached$ = from(this.cache.read<WebcamFeedItem[]>(cacheKey)).pipe(
      filter((items): items is WebcamFeedItem[] => Array.isArray(items)),
      map((items) => this.normalize(items)),
    );

    const network$ = this.http.get<WebcamFeedItem[]>(this.baseUrl).pipe(
      map((items) => this.normalize(items)),
      tap((items) => {
        this.cache.write(cacheKey, Array.isArray(items) ? items : []).catch(() => {});
      }),
    );

    return concat(cached$, network$);
  }

  private normalize(items: WebcamFeedItem[]): WebcamFeedItem[] {
    return (Array.isArray(items) ? items : [])
      .filter((item) => !!item?.title && !!item?.youtube_url && !!item?.embed_url)
      .filter((item) => item.active !== false)
      .sort((a, b) => (a?.sort_order ?? Number.MAX_SAFE_INTEGER) - (b?.sort_order ?? Number.MAX_SAFE_INTEGER));
  }
}
