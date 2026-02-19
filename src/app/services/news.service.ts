import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

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

  constructor(private http: HttpClient) {}

  getPosts(): Observable<MobilePost[]> {
    return this.http.get<MobilePost[]>(this.baseUrl);
  }
}
