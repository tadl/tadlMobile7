import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { Globals } from '../../globals';
import { ToastService } from '../../services/toast.service';
import { FeaturedService, type FeaturedCategoryPage } from '../../services/featured.service';

type FeaturedTabKey = 'books' | 'video' | 'music';

interface FeaturedTile {
  id: string;
  label: string;
  previewCount: number;
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
  loading = false;
  selectedTab: FeaturedTabKey = 'books';
  private loadingTabs = new Set<FeaturedTabKey>();
  private loadedTabs = new Set<FeaturedTabKey>();
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
    private toast: ToastService,
    private router: Router,
  ) {}

  ionViewWillEnter() {
    this.refresh('books');
  }

  refresh(tab: FeaturedTabKey = this.selectedTab, ev?: any) {
    if (this.loadingTabs.has(tab)) {
      ev?.target?.complete?.();
      return;
    }

    this.loadingTabs.add(tab);
    this.loading = true;

    const ids = this.tabCategoryIds[tab] ?? [];
    const tilesById = new Map<string, FeaturedTile>();
    let completed = 0;

    if (ids.length === 0) {
      this.tilesByTab[tab] = [];
      this.loadingTabs.delete(tab);
      this.loading = this.loadingTabs.size > 0;
      ev?.target?.complete?.();
      return;
    }

    for (const id of ids) {
      this.featured.fetchBrowseCategoryPage(id, 1, 12)
        .pipe(finalize(() => {
          completed += 1;
          if (completed === ids.length) {
            this.tilesByTab[tab] = ids.map((categoryId) => tilesById.get(categoryId)).filter((v): v is FeaturedTile => !!v);
            if (this.tilesByTab[tab].length === 0) {
              this.toast.presentToast('Could not load featured categories for this tab.');
            }
            this.loadedTabs.add(tab);
            this.loadingTabs.delete(tab);
            this.loading = this.loadingTabs.size > 0;
            ev?.target?.complete?.();
          }
        }))
        .subscribe({
          next: (page: FeaturedCategoryPage) => {
            if (!page?.success) return;
            tilesById.set(id, {
              id,
              label: (page.title ?? `Category ${id}`).toString().trim() || `Category ${id}`,
              previewCount: page.items?.length ?? 0,
              covers: (page.items ?? []).map((item) => this.coverUrl(item.image)).filter(Boolean).slice(0, 6),
            });
          },
          error: () => {
            // Skip failed category and continue loading remaining tiles.
          },
        });
    }
  }

  onTabChanged(ev: CustomEvent) {
    const tab = ((ev?.detail?.value ?? 'books').toString().toLowerCase()) as FeaturedTabKey;
    if (tab !== 'books' && tab !== 'video' && tab !== 'music') return;
    this.selectedTab = tab;
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

  categorySubtitle(tile: FeaturedTile): string {
    const n = tile?.previewCount ?? 0;
    if (n <= 0) return 'No preview items';
    return `${n} preview ${n === 1 ? 'item' : 'items'}`;
  }

  coverUrl(url?: string): string {
    return (url ?? '').toString().trim();
  }

  trackByTile(_idx: number, tile: FeaturedTile): string {
    return (tile?.id ?? '').toString().trim() || `${_idx}`;
  }
}
