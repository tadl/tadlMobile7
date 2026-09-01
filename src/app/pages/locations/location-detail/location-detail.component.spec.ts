import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';

import { LocationDetailComponent } from './location-detail.component';
import { APP_TEST_PROVIDERS } from '../../../../testing/app-test-providers';
import type { AppLocation } from '../../../services/locations.service';

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

  it('hides service exceptions when none are upcoming', () => {
    fixture.componentRef.setInput('location', locationWithExceptions([]));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.exceptions-card')).toBeNull();
  });

  it('shows upcoming service exceptions', () => {
    fixture.componentRef.setInput(
      'location',
      locationWithExceptions([
        {
          date: component.globals.easternDateStringPlusDays(1),
          hours: 'Closed',
          reason: 'Holiday',
        },
      ])
    );
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.exceptions-card')?.textContent
    ).toContain('Holiday');
  });

  function locationWithExceptions(
    exceptions: NonNullable<AppLocation['exceptions']>
  ): AppLocation {
    return {
      id: 1,
      shortname: 'test',
      fullname: 'Test Library',
      group: 'test',
      address: '1 Library Way',
      citystatezip: 'Test, MI 00000',
      phone: '231-555-0100',
      exceptions,
    };
  }
});
