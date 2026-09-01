import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';

import { NewsDetailComponent } from './news-detail.component';
import { APP_TEST_PROVIDERS } from '../../../../testing/app-test-providers';

describe('NewsDetailComponent', () => {
  let component: NewsDetailComponent;
  let fixture: ComponentFixture<NewsDetailComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [NewsDetailComponent],
      providers: APP_TEST_PROVIDERS,
    }).compileComponents();

    fixture = TestBed.createComponent(NewsDetailComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
