import { Component, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, IonContent } from '@ionic/angular';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { Globals } from '../../globals';
import { FeaturedService, type FeaturedCategoryPage } from '../../services/featured.service';

type FeaturedTabKey = 'books' | 'video' | 'music';

interface FeaturedTile {
  id: string;
  label: string;
  covers: string[];
}

@Component({
  standalone: true,
  selector: 'app-featured',
  templateUrl: './featured.page.html',
  styleUrls: ['./featured.page.scss'],
  imports: [CommonModule, IonicModule],
})
export class FeaturedPage {
  @ViewChild('content', { static: false }) content?: IonContent;

  selectedTab: FeaturedTabKey = 'books';
  private loadingTabs = new Set<FeaturedTabKey>();
  private loadedTabs = new Set<FeaturedTabKey>();
  tabErrorByTab: Record<FeaturedTabKey, string | null> = {
    books: null,
    video: null,
    music: null,
  };
  tilesByTab: Record<FeaturedTabKey, FeaturedTile[]> = {
    books: [],
    video: [],
    music: [],
  };
  private readonly tabCategoryIds: Record<FeaturedTabKey, string[]> = {
    books: ['tadl_adult_fiction', 'tadl_adult_nonfiction', 'tadl_adult_audiobooks', 'tadl_large_print'],
    video: ['tadl_all_movie_genres', 'tadl_hot_movies_tv', 'tadl_tv', 'tadl_movie_performing_arts'],
    music: ['tadl_all_music_genres', 'tadl_music_local', 'tadl_music_pop_rock', 'tadl_music_jazz'],
  };

  constructor(
    public globals: Globals,
    private featured: FeaturedService,
    private router: Router,
  ) {}

  ionViewWillEnter() {
    this.refresh(this.selectedTab);
  }

  refresh(tab: FeaturedTabKey = this.selectedTab, ev?: any) {
    if (this.loadingTabs.has(tab)) {
      ev?.target?.complete?.();
      return;
    }

    this.loadingTabs.add(tab);
    this.tabErrorByTab[tab] = null;

    const ids = this.tabCategoryIds[tab] ?? [];
    const tilesById = new Map<string, FeaturedTile>();
    for (const t of this.tilesByTab[tab] ?? []) {
      if (t?.id) tilesById.set(t.id, t);
    }
    let completed = 0;
    let successfulRequests = 0;
    let failedRequests = 0;

    if (ids.length === 0) {
      this.tilesByTab[tab] = [];
      this.loadingTabs.delete(tab);
      ev?.target?.complete?.();
      return;
    }

    for (const id of ids) {
      this.featured.fetchBrowseCategoryPage(id, 1, 6)
        .pipe(finalize(() => {
          completed += 1;
          if (completed === ids.length) {
            this.updateRenderedTiles(tab, ids, tilesById);
            if (successfulRequests === 0 && failedRequests > 0) {
              this.tabErrorByTab[tab] = 'Could not load featured categories for this tab.';
            } else {
              this.tabErrorByTab[tab] = null;
            }
            this.loadedTabs.add(tab);
            this.loadingTabs.delete(tab);
            ev?.target?.complete?.();
          }
        }))
        .subscribe({
          next: (page: FeaturedCategoryPage) => {
            if (!page?.success) {
              failedRequests += 1;
              return;
            }
            successfulRequests += 1;
            tilesById.set(id, {
              id,
              label: (page.title ?? `Category ${id}`).toString().trim() || `Category ${id}`,
              covers: (page.items ?? []).map((item) => this.coverUrl(item.image)).filter(Boolean).slice(0, 6),
            });
            this.updateRenderedTiles(tab, ids, tilesById);
          },
          error: () => {
            failedRequests += 1;
          },
        });
    }
  }

  async onTabChanged(ev: CustomEvent) {
    const tab = ((ev?.detail?.value ?? 'books').toString().toLowerCase()) as FeaturedTabKey;
    if (tab !== 'books' && tab !== 'video' && tab !== 'music') return;
    this.selectedTab = tab;
    await this.content?.scrollToTop(200);
    if (!this.loadedTabs.has(tab)) {
      this.refresh(tab);
    }
  }

  openCategory(tile: FeaturedTile) {
    const id = (tile?.id ?? '').toString().trim();
    if (!id) return;
    this.router.navigate(['/featured', id], {
      queryParams: { label: tile.label || 'Featured' },
    });
  }

  coverUrl(url?: string): string {
    return (url ?? '').toString().trim();
  }

  isTabLoading(tab: FeaturedTabKey): boolean {
    return this.loadingTabs.has(tab);
  }

  retrySelectedTab() {
    this.refresh(this.selectedTab);
  }

  trackByTile(_idx: number, tile: FeaturedTile): string {
    return (tile?.id ?? '').toString().trim() || `${_idx}`;
  }

  private updateRenderedTiles(tab: FeaturedTabKey, ids: string[], tilesById: Map<string, FeaturedTile>) {
    this.tilesByTab[tab] = ids.map((categoryId) => tilesById.get(categoryId)).filter((v): v is FeaturedTile => !!v);
  }
}
