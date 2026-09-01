import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';

import { LocationDetailComponent } from './location-detail.component';
import { APP_TEST_PROVIDERS } from '../../../../testing/app-test-providers';

describe('LocationDetailComponent', () => {
  let component: LocationDetailComponent;
  let fixture: ComponentFixture<LocationDetailComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [LocationDetailComponent],
      providers: APP_TEST_PROVIDERS,
    }).compileComponents();

    fixture = TestBed.createComponent(LocationDetailComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
