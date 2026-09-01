import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LocationsPage } from './locations.page';
import { APP_TEST_PROVIDERS } from '../../../testing/app-test-providers';

describe('LocationsPage', () => {
  let component: LocationsPage;
  let fixture: ComponentFixture<LocationsPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LocationsPage],
      providers: APP_TEST_PROVIDERS,
    }).compileComponents();
    fixture = TestBed.createComponent(LocationsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
