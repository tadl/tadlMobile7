import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { Platform } from '@ionic/angular/standalone';
import { App } from '@capacitor/app';
import { fromEvent, Observable } from 'rxjs';
import { distinctUntilChanged } from 'rxjs/operators';

import { Globals } from './globals';
import { AuthService } from './services/auth.service';
import { AccountMenuComponent } from './components/account-menu/account-menu.component';
import { LoadingService } from './services/loading.service';
import { CacheWarmService } from './services/cache-warm.service';

@Component({
  standalone: true,
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  imports: [
    CommonModule,
    RouterModule,
    IonicModule,
    AccountMenuComponent,
  ],
})
export class AppComponent implements OnInit {
  public appPages: Array<{ title: string; url: string; icon: string }> = [
    { title: 'Home', url: '/home', icon: 'home' },
    { title: 'Search', url: '/search', icon: 'search' },
    { title: 'Locations', url: '/locations', icon: 'compass' },
    { title: 'Events', url: '/events', icon: 'calendar' },
    { title: 'News', url: '/news', icon: 'megaphone' },
    { title: 'Featured', url: '/featured', icon: 'star' },
    { title: 'About', url: '/about', icon: 'information-circle' },
  ];

  // Bind in templates: *ngIf="isLoading$ | async"
  isLoading$: Observable<boolean>;
  private lastWarmedAccountId: string | null = null;

  constructor(
    public globals: Globals,
    private platform: Platform,
    private auth: AuthService,
    private loading: LoadingService,
    private cacheWarm: CacheWarmService,
  ) {
    this.isLoading$ = this.loading.isLoading$();

    this.platform.ready().then(async () => {
      await this.globals.getDeviceInfo();
      this.globals.initNetworkStatusTracking();

      App.addListener('backButton', ({ canGoBack }) => {
        if (canGoBack) this.globals.go_back();
        else this.globals.confirm_exit();
      });

      fromEvent(document, 'didDismiss').subscribe(() => {
        this.globals.modal_open = false;
      });
    });
  }

  ngOnInit() {
    this.auth.restore().subscribe({
      error: (err) => console.warn('[Auth] restore failed', err),
    });

    this.auth.authState()
      .pipe(
        distinctUntilChanged((a, b) =>
          a.isLoggedIn === b.isLoggedIn && a.activeAccountId === b.activeAccountId,
        ),
      )
      .subscribe((s) => {
        if (!s.isLoggedIn || !s.activeAccountId) {
          this.lastWarmedAccountId = null;
          return;
        }

        if (this.lastWarmedAccountId === s.activeAccountId) return;
        this.lastWarmedAccountId = s.activeAccountId;
        this.cacheWarm.warmForActiveAccount();
      });
  }

  // Called by (ionDidOpen) on the account menu in app.component.html
  accountMenuDidOpen() {
    // Update counts/badges whenever the user opens the account menu.
    this.auth.refreshActiveProfile().subscribe({
      next: () => {},
      error: (err) => console.warn('[Auth] refreshActiveProfile failed', err),
    });
  }
}
