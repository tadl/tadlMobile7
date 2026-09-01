import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EventsPage } from './events.page';
import { APP_TEST_PROVIDERS } from '../../../testing/app-test-providers';

describe('EventsPage', () => {
  let component: EventsPage;
  let fixture: ComponentFixture<EventsPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EventsPage],
      providers: APP_TEST_PROVIDERS,
    }).compileComponents();
    fixture = TestBed.createComponent(EventsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
