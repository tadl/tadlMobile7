import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';
import { APP_TEST_PROVIDERS } from '../testing/app-test-providers';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: APP_TEST_PROVIDERS,
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should have menu labels', () => {
    const app = TestBed.createComponent(AppComponent).componentInstance;
    expect(app.appPages.map((item) => item.title)).toEqual([
      'Home',
      'Account',
      'Search',
      'Locations',
      'Events',
      'Newsletter',
      'Featured Items',
      'Webcams',
      'About',
    ]);
  });

  it('should have urls', () => {
    const app = TestBed.createComponent(AppComponent).componentInstance;
    expect(app.appPages.map((item) => item.url)).toEqual([
      '/home',
      '/account',
      '/search',
      '/locations',
      '/events',
      '/news',
      '/featured',
      '/webcams',
      '/about',
    ]);
  });
});
