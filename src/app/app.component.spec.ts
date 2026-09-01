import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';
import { APP_TEST_PROVIDERS } from '../testing/app-test-providers';
import { APP_PROFILE } from './app-profile';

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
    const labels = app.appPages.map((item) => item.title);
    expect(labels.slice(0, 5)).toEqual([
      'Home',
      'Account',
      'Search',
      'Locations',
      'Events',
    ]);
    expect(labels.includes('Newsletter')).toBe(APP_PROFILE.newsletter.enabled);
    expect(labels.includes('Featured Items')).toBe(
      APP_PROFILE.features.featured
    );
    expect(labels.includes('Webcams')).toBe(APP_PROFILE.features.webcams);
    expect(labels.at(-1)).toBe('About');
  });

  it('should have urls', () => {
    const app = TestBed.createComponent(AppComponent).componentInstance;
    const urls = app.appPages.map((item) => item.url);
    expect(urls.slice(0, 5)).toEqual([
      '/home',
      '/account',
      '/search',
      '/locations',
      '/events',
    ]);
    expect(urls.includes('/news')).toBe(APP_PROFILE.newsletter.enabled);
    expect(urls.includes('/featured')).toBe(APP_PROFILE.features.featured);
    expect(urls.includes('/webcams')).toBe(APP_PROFILE.features.webcams);
    expect(urls.at(-1)).toBe('/about');
  });
});
