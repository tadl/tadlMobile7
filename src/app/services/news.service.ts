import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, concat, from, filter, tap } from 'rxjs';
import { AppCacheService } from './app-cache.service';

export interface WordpressRenderedField {
  rendered: string;
}

export interface FeaturedImageUrls {
  thumbnail?: string;
  medium?: string;
  large?: string;
  full?: string;
  [k: string]: string | undefined;
}

export interface MobilePost {
  title: WordpressRenderedField;
  post_url: string;
  featured_image_urls?: FeaturedImageUrls;
  content?: WordpressRenderedField & { text?: string };
  excerpt?: WordpressRenderedField;
  date?: string; // ISO
}

@Injectable({ providedIn: 'root' })
export class NewsService {
  // matches the URL you pasted
  private readonly baseUrl = 'https://feeds.tools.tadl.org/posts.json';

  constructor(
    private http: HttpClient,
    private cache: AppCacheService,
  ) {}

  getPosts(): Observable<MobilePost[]> {
    const cacheKey = 'news:posts';
    const cached$ = from(this.cache.read<MobilePost[]>(cacheKey)).pipe(
      filter((posts): posts is MobilePost[] => Array.isArray(posts)),
    );

    const network$ = this.http.get<MobilePost[]>(this.baseUrl).pipe(
      tap((posts) => {
        this.cache.write(cacheKey, Array.isArray(posts) ? posts : []).catch(() => {});
      }),
    );

    return concat(cached$, network$);
  }
}
