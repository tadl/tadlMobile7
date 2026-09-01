import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FeaturedPage } from './featured.page';
import { APP_TEST_PROVIDERS } from '../../../testing/app-test-providers';

describe('FeaturedPage', () => {
  let component: FeaturedPage;
  let fixture: ComponentFixture<FeaturedPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FeaturedPage],
      providers: APP_TEST_PROVIDERS,
    }).compileComponents();
    fixture = TestBed.createComponent(FeaturedPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
