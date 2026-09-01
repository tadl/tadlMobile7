import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';

import { EventDetailComponent } from './event-detail.component';
import { APP_TEST_PROVIDERS } from '../../../../testing/app-test-providers';

describe('EventDetailComponent', () => {
  let component: EventDetailComponent;
  let fixture: ComponentFixture<EventDetailComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [EventDetailComponent],
      providers: APP_TEST_PROVIDERS,
    }).compileComponents();

    fixture = TestBed.createComponent(EventDetailComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
