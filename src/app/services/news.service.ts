import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, concat, from, filter, map, tap } from 'rxjs';
import { AppCacheService } from './app-cache.service';
import { APP_PROFILE } from '../app-profile';

export interface NewsletterItem {
  title: string;
  url: string;
  published_at: string; // ISO
  summary?: string | null;
  html?: string | null;
  image?: string | null;
}

interface WordPressRenderedValue {
  rendered?: string;
}

interface WordPressPost {
  date?: string;
  modified?: string;
  link?: string;
  title?: WordPressRenderedValue;
  excerpt?: WordPressRenderedValue;
  content?: WordPressRenderedValue;
}

@Injectable({ providedIn: 'root' })
export class NewsService {
  private http = inject(HttpClient);
  private cache = inject(AppCacheService);

  getPosts(): Observable<NewsletterItem[]> {
    const cacheKey = `newsletter:${APP_PROFILE.newsletter.provider}:items`;
    const cached$ = from(this.cache.read<NewsletterItem[]>(cacheKey)).pipe(
      filter((posts): posts is NewsletterItem[] => Array.isArray(posts))
    );

    const network$ = this.fetchPosts().pipe(
      tap((posts) => {
        this.cache
          .write(cacheKey, Array.isArray(posts) ? posts : [])
          .catch(() => {});
      })
    );

    return concat(cached$, network$);
  }

  private fetchPosts(): Observable<NewsletterItem[]> {
    if (APP_PROFILE.newsletter.provider === 'wordpress-posts') {
      return this.http
        .get<WordPressPost[]>(APP_PROFILE.newsletter.url)
        .pipe(map((posts) => this.normalizeWordPressPosts(posts)));
    }

    return this.http.get<NewsletterItem[]>(APP_PROFILE.newsletter.url);
  }

  private normalizeWordPressPosts(posts: WordPressPost[]): NewsletterItem[] {
    if (!Array.isArray(posts)) return [];

    return posts.map((post) => ({
      title: this.plainText(post?.title?.rendered) || 'Newsletter',
      url: (post?.link ?? APP_PROFILE.websiteBase).toString(),
      published_at: (post?.modified ?? post?.date ?? '').toString(),
      summary: this.plainText(
        post?.excerpt?.rendered ?? post?.content?.rendered
      ),
      html: (post?.content?.rendered ?? '').toString() || null,
      image: null,
    }));
  }

  private plainText(value: string | null | undefined): string {
    const raw = (value ?? '').toString();
    if (!raw) return '';

    const parser = new DOMParser();
    const doc = parser.parseFromString(raw, 'text/html');
    return (doc.body.textContent ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
