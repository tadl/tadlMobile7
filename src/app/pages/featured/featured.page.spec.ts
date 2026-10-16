import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FeaturedPage } from './featured.page';
import { APP_TEST_PROVIDERS } from '../../../testing/app-test-providers';
import { NEVER } from 'rxjs';
import { FeaturedService } from '../../services/featured.service';

describe('FeaturedPage', () => {
  let component: FeaturedPage;
  let fixture: ComponentFixture<FeaturedPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FeaturedPage],
      providers: [
        ...APP_TEST_PROVIDERS,
        { provide: FeaturedService, useValue: { fetchBrowseCategoryPage: () => NEVER } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(FeaturedPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  for (const [width, columns] of [[320, 1], [700, 2], [1060, 3]]) {
    it(`fits readable, unclipped cards in a ${width}px content pane`, async () => {
      await renderTiles(width);
      const grid = fixture.nativeElement.querySelector('.category-list .category-grid') as HTMLElement;
      expect(getComputedStyle(grid).gridTemplateColumns.split(' ').length).toBe(columns);
      expect(grid.scrollWidth).toBeLessThanOrEqual(width + 1);
      expectReadableCovers(grid);
    });
  }

  it('lets cards grow for wrapped category titles without hiding covers', async () => {
    await renderTiles(700, 'New fiction and non-fiction for children, teens, and families');
    expectReadableCovers(fixture.nativeElement.querySelector('.category-list .category-grid'));
  });

  it('uses the same readable cover layout for loading placeholders', async () => {
    component.refresh();
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    const grid = fixture.nativeElement.querySelector('.skeleton-list') as HTMLElement;
    grid.style.width = '700px';
    await fixture.whenStable();
    await nextFrame();
    expect(grid.querySelectorAll('.category-card').length).toBe(4);
    expectReadableCovers(grid);
  });

  async function renderTiles(width: number, firstTitle = 'Example New Fiction') {
    const covers = Array.from({ length: 6 }, (_, index) =>
      `data:image/svg+xml,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="240"><rect id="cover-${index}" width="160" height="240" fill="navy"/></svg>`
      )}`
    );
    component.tilesByTab.books = [firstTitle, 'Example New Non-Fiction', 'Example New Kids Books']
      .map((label, index) => ({ id: `synthetic-category-${index}`, label, covers }));
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    const grid = fixture.nativeElement.querySelector('.category-list .category-grid') as HTMLElement;
    grid.style.width = `${width}px`;
    await fixture.whenStable();
    await nextFrame();
  }

  function expectReadableCovers(grid: HTMLElement) {
    for (const card of grid.querySelectorAll<HTMLElement>('.category-card')) {
      const coverGrid = card.querySelector<HTMLElement>('.cover-grid')!;
      expect(getComputedStyle(coverGrid).gridTemplateColumns.split(' ').length).toBe(3);
      const cardBounds = card.getBoundingClientRect();
      const covers = coverGrid.querySelectorAll<HTMLElement>('img, .cover-skeleton');
      expect(covers.length).toBe(6);
      for (const cover of covers) {
        const bounds = cover.getBoundingClientRect();
        expect(bounds.width).toBeGreaterThan(80);
        expect(bounds.height).toBeCloseTo(bounds.width * 1.5, 0);
        expect(bounds.bottom).toBeLessThanOrEqual(cardBounds.bottom + 1);
        expect(bounds.left).toBeGreaterThanOrEqual(cardBounds.left);
        expect(bounds.right).toBeLessThanOrEqual(cardBounds.right + 1);
      }
    }
  }

  async function nextFrame(): Promise<void> {
    await customElements.whenDefined('ion-content');
    await customElements.whenDefined('ion-card');
    const elements = (fixture.nativeElement as HTMLElement).querySelectorAll<
      HTMLElement & { componentOnReady?: () => Promise<unknown> }
    >('*');
    await Promise.all(Array.from(elements, element => element.componentOnReady?.()));
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
