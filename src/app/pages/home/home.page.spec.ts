import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HomePage } from './home.page';
import { APP_TEST_PROVIDERS } from '../../../testing/app-test-providers';
import { Subject } from 'rxjs';
import { LocationsService, type AppLocation } from '../../services/locations.service';

describe('HomePage', () => {
  let component: HomePage;
  let fixture: ComponentFixture<HomePage>;
  let requests: Subject<AppLocation[]>[];

  beforeEach(async () => {
    requests = [];
    const locations = jasmine.createSpyObj<LocationsService>('LocationsService', ['getLocations']);
    locations.getLocations.and.callFake(() => {
      const updates = new Subject<AppLocation[]>();
      requests.push(updates);
      return updates;
    });
    await TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [...APP_TEST_PROVIDERS, { provide: LocationsService, useValue: locations }],
    }).compileComponents();
    fixture = TestBed.createComponent(HomePage);
    component = fixture.componentInstance;
    spyOn(component.globals, 'easternDateString').and.returnValue('2026-11-17');
    spyOn(component.globals, 'easternDateStringPlusDays').and.returnValue('2026-11-18');
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('retains a saved closure notice when the locations refresh fails', () => {
    component.ionViewDidEnter();
    requests[0].next([closedLocation()]);
    const savedNotice = component.closureNotice;
    requests[0].error(new Error('Synthetic locations refresh failure'));

    expect(savedNotice?.message).toContain('Example Library is closed today.');
    expect(component.closureNotice).toEqual(savedNotice);
  });

  it('clears a saved notice after a successful response has no relevant closure', () => {
    component.ionViewDidEnter();
    requests[0].next([closedLocation()]);
    requests[0].next([{ ...closedLocation(), exceptions: [] }]);

    expect(component.closureNotice).toBeNull();
  });

  it('cancels an earlier entry refresh and ignores updates after destruction', () => {
    component.ionViewDidEnter();
    const earlier = requests[0];
    component.ionViewDidEnter();
    requests[1].next([closedLocation()]);
    const savedNotice = component.closureNotice;
    earlier.next([]);

    expect(earlier.observed).toBeFalse();
    expect(component.closureNotice).toEqual(savedNotice);
    fixture.destroy();
    requests[1].next([]);
    expect(requests[1].observed).toBeFalse();
    expect(component.closureNotice).toEqual(savedNotice);
  });

  function closedLocation(): AppLocation {
    return {
      id: 901, shortname: 'example', fullname: 'Example Library', group: 'tadl',
      address: '1 Example Road', citystatezip: 'Example, MI 00000', phone: '555-0100',
      exceptions: [{ date: '2026-11-17', hours: 'Closed', reason: 'Synthetic holiday' }],
    };
  }
});
