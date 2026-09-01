import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NewsPage } from './news.page';
import { APP_TEST_PROVIDERS } from '../../../testing/app-test-providers';

describe('NewsPage', () => {
  let component: NewsPage;
  let fixture: ComponentFixture<NewsPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NewsPage],
      providers: APP_TEST_PROVIDERS,
    }).compileComponents();
    fixture = TestBed.createComponent(NewsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
