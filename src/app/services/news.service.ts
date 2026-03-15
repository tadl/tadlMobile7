import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, concat, from, filter, tap } from 'rxjs';
import { AppCacheService } from './app-cache.service';

export interface NewsletterItem {
  title: string;
  url: string;
  published_at: string; // ISO
  summary?: string | null;
  html?: string | null;
  image?: string | null;
}

@Injectable({ providedIn: 'root' })
export class NewsService {
  private readonly baseUrl = 'https://feeds.tools.tadl.org/newsletter.json';

  constructor(
    private http: HttpClient,
    private cache: AppCacheService,
  ) {}

  getPosts(): Observable<NewsletterItem[]> {
    const cacheKey = 'newsletter:items';
    const cached$ = from(this.cache.read<NewsletterItem[]>(cacheKey)).pipe(
      filter((posts): posts is NewsletterItem[] => Array.isArray(posts)),
    );

    const network$ = this.http.get<NewsletterItem[]>(this.baseUrl).pipe(
      tap((posts) => {
        this.cache.write(cacheKey, Array.isArray(posts) ? posts : []).catch(() => {});
      }),
    );

    return concat(cached$, network$);
  }
}
