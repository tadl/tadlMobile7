import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HomePage } from './home.page';
import { APP_TEST_PROVIDERS } from '../../../testing/app-test-providers';

describe('HomePage', () => {
  let component: HomePage;
  let fixture: ComponentFixture<HomePage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomePage],
      providers: APP_TEST_PROVIDERS,
    }).compileComponents();
    fixture = TestBed.createComponent(HomePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
