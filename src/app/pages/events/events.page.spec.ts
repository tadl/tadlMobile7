import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EventsPage } from './events.page';
import { APP_TEST_PROVIDERS } from '../../../testing/app-test-providers';
import { Subject } from 'rxjs';
import { EventsService, type MobileEventsResponse, type VenueOption } from '../../services/events.service';

describe('EventsPage', () => {
  let component: EventsPage;
  let fixture: ComponentFixture<EventsPage>;
  let requests: Map<string, Subject<MobileEventsResponse>>;

  beforeEach(async () => {
    requests = new Map();
    const eventsService = jasmine.createSpyObj<EventsService>('EventsService', ['getEvents']);
    eventsService.getEvents.and.callFake((venue) => {
      const updates = new Subject<MobileEventsResponse>();
      requests.set(String(venue), updates);
      return updates;
    });
    await TestBed.configureTestingModule({
      imports: [EventsPage],
      providers: [...APP_TEST_PROVIDERS, { provide: EventsService, useValue: eventsService }],
    }).compileComponents();
    fixture = TestBed.createComponent(EventsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('keeps the latest selected venue when an earlier request responds late', () => {
    component.onVenueChange('1');
    const earlier = requests.get('1')!;
    component.onVenueChange('2');
    requests.get('2')!.next(response('Example Venue Two Event'));
    earlier.next(response('Example Venue One Event'));
    render();

    expect(earlier.observed).toBeFalse();
    expect(component.selectedVenueCode).toBe('2');
    expect(fixture.nativeElement.textContent).toContain('Example Venue Two Event');
    expect(fixture.nativeElement.textContent).not.toContain('Example Venue One Event');
  });

  it('keeps saved events visible when their refresh fails', () => {
    const updates = requests.get('all')!;
    updates.next(response('Saved Event'));
    updates.error(new Error('Synthetic refresh failure'));
    render();

    expect(fixture.nativeElement.querySelector('ion-content ion-list')?.textContent).toContain('Saved Event');
    expect(fixture.nativeElement.textContent).toContain('Showing saved events.');
    expect(fixture.nativeElement.textContent).not.toContain('No events found');
  });

  it('does not show previous-venue saved events after the new venue fails', () => {
    requests.get('all')!.next(response('Other Venue Event'));
    component.onVenueChange('2');
    requests.get('2')!.error(new Error('Synthetic venue failure'));
    render();

    expect(fixture.nativeElement.textContent).not.toContain('Other Venue Event');
    expect(fixture.nativeElement.textContent).toContain('Could not load events. Please try again.');
    expect(fixture.nativeElement.textContent).not.toContain('Showing saved events.');
    expect(fixture.nativeElement.textContent).not.toContain('No events found');
  });

  it('replaces saved events with a successful empty result', () => {
    const updates = requests.get('all')!;
    updates.next(response('Saved Event'));
    updates.next({ ...response('unused'), events: [] });
    render();

    expect(fixture.nativeElement.textContent).not.toContain('Saved Event');
    expect(fixture.nativeElement.textContent).toContain('No events found for this location.');
    expect(component.error).toBeNull();
  });

  it('finishes pull-refresh after the network request ends rather than the saved emission', () => {
    const complete = jasmine.createSpy('complete');
    component.refresh({ target: { complete } } as unknown as CustomEvent);
    const updates = requests.get('all')!;
    updates.next(response('Saved Event'));
    expect(complete).not.toHaveBeenCalled();
    updates.complete();
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('cancels requests and completes the refresher when destroyed', () => {
    const complete = jasmine.createSpy('complete');
    component.refresh({ target: { complete } } as unknown as CustomEvent);
    const updates = requests.get('all')!;
    fixture.destroy();
    updates.next(response('Late Event'));

    expect(updates.observed).toBeFalse();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(component.events).toEqual([]);
  });

  function render() {
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
  }

  function response(title: string): MobileEventsResponse {
    const venues: Array<VenueOption & { code: string }> = [
      { id: 0, code: 'all', name: 'All Locations' },
      { id: 1, code: '1', name: 'Example One' },
      { id: 2, code: '2', name: 'Example Two' },
    ];
    return {
      events: [{
        title, url: 'https://example.org/event', start_date: '2026-12-01 10:00:00',
        location: 'Example Library', image: null, description: null,
      }],
      all_venues: venues,
    };
  }
});
