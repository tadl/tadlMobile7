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

  it('cleans CMS markup before Angular performs final sanitization', () => {
    const warn = spyOn(console, 'warn');
    component.event = {
      description:
        '<div class="fusion-row" style="width: 100%"><h3 style="text-align:center">Book Club</h3><script>alert(1)</script><a href="javascript:alert(1)" onclick="alert(1)">Bad link</a><a href="tel:2312589411" style="color: green">Call us</a></div>',
    };

    const html = component.descriptionHtml;

    expect(html).toContain('<h3>Book Club</h3>');
    expect(html).toContain('href="tel:2312589411"');
    expect(html).not.toContain('class=');
    expect(html).not.toContain('style=');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('javascript:');
    expect(warn).not.toHaveBeenCalled();
  });
});
