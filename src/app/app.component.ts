import { Component, NgZone, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import {
  ActionSheetController,
  AlertController,
  ModalController,
  Platform,
  PopoverController,
} from '@ionic/angular/standalone';
import { App } from '@capacitor/app';
import { Keyboard } from '@capacitor/keyboard';
import { SplashScreen } from '@capacitor/splash-screen';
import { fromEvent, Observable } from 'rxjs';
import { distinctUntilChanged, filter, take } from 'rxjs/operators';
import { NavigationEnd, Router } from '@angular/router';

import { Globals } from './globals';
import { AuthService } from './services/auth.service';
import { LoadingService } from './services/loading.service';
import { CacheWarmService } from './services/cache-warm.service';
import { DiscoveryLinkRouterService } from './services/discovery-link-router.service';

@Component({
  standalone: true,
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  imports: [
    CommonModule,
    RouterModule,
    IonicModule,
  ],
})
export class AppComponent implements OnInit {
  public appPages: Array<{ title: string; url: string; icon: string }> = [
    { title: 'Home', url: '/home', icon: 'home' },
    { title: 'Account', url: '/account', icon: 'person-circle' },
    { title: 'Search', url: '/search', icon: 'search' },
    { title: 'Locations', url: '/locations', icon: 'compass' },
    { title: 'Events', url: '/events', icon: 'calendar' },
    { title: 'News', url: '/news', icon: 'megaphone' },
    { title: 'Featured Items', url: '/featured', icon: 'star' },
    { title: 'About', url: '/about', icon: 'information-circle' },
  ];

  // Bind in templates: *ngIf="isLoading$ | async"
  isLoading$: Observable<boolean>;
  private lastWarmedAccountId: string | null = null;
  private lastResumeRefreshAt = 0;
  private splashHidden = false;
  private readonly appBootStartedAt = Date.now();
  private incomingUrlInFlight = false;
  private queuedIncomingUrl: string | null = null;

  constructor(
    public globals: Globals,
    private platform: Platform,
    private auth: AuthService,
    private loading: LoadingService,
    private cacheWarm: CacheWarmService,
    private router: Router,
    private discoveryLinks: DiscoveryLinkRouterService,
    private zone: NgZone,
    private modalCtrl: ModalController,
    private actionSheetCtrl: ActionSheetController,
    private popoverCtrl: PopoverController,
    private alertCtrl: AlertController,
  ) {
    this.isLoading$ = this.loading.isLoading$();

    this.platform.ready().then(async () => {
      // Ensure splash stays visible through cold-start initialization.
      await SplashScreen.show({
        autoHide: false,
        showDuration: 0,
      }).catch(() => {});

      await this.globals.getDeviceInfo();
      await this.globals.initThemePreference();
      await this.globals.initLinkPreference();
      this.globals.initNetworkStatusTracking();

      App.addListener('backButton', ({ canGoBack }) => {
        if (canGoBack) this.globals.go_back();
        else this.globals.confirm_exit();
      });

      App.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) return;
        this.handleAppResume();
      });
      App.addListener('appUrlOpen', ({ url }) => {
        this.zone.run(() => {
          void this.handleIncomingUrl(url);
        });
      });
      App.getLaunchUrl()
        .then((launch) => {
          const url = (launch?.url ?? '').toString().trim();
          if (!url) return;
          this.zone.run(() => {
            void this.handleIncomingUrl(url);
          });
        })
        .catch(() => {});

      fromEvent(document, 'didDismiss').subscribe(() => {
        this.globals.modal_open = false;
      });

      this.whenInitialNavigationReady();
    });
  }

  ngOnInit() {
    this.auth.restore().subscribe({
      next: (s) => {
        if (!s?.isLoggedIn || !s?.activeAccountId) return;
      },
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

  private handleAppResume() {
    const snap = this.auth.snapshot();
    if (!snap.isLoggedIn || !snap.activeAccountId) return;

    const now = Date.now();
    if (now - this.lastResumeRefreshAt < 10000) return;
    this.lastResumeRefreshAt = now;

    this.auth.refreshActiveProfile().subscribe({ error: () => {} });

    const path = this.router.url || '/home';
    if (path === '/' || path.startsWith('/home')) {
      this.cacheWarm.warmForActiveAccount();
    }
  }

  private whenInitialNavigationReady() {
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        take(1),
      )
      .subscribe(() => this.hideLaunchSplash());

    // Fallback: don't block forever if navigation events are delayed unexpectedly.
    window.setTimeout(() => this.hideLaunchSplash(), 3500);
  }

  private hideLaunchSplash() {
    if (this.splashHidden) return;
    const minVisibleMs = 900;
    const elapsed = Date.now() - this.appBootStartedAt;
    const remaining = Math.max(0, minVisibleMs - elapsed);

    window.setTimeout(() => {
      if (this.splashHidden) return;
      this.splashHidden = true;
      SplashScreen.hide().catch(() => {});
    }, remaining);
  }

  private async handleIncomingUrl(rawUrl: string): Promise<void> {
    const target = (rawUrl ?? '').toString().trim();
    if (!target) return;

    if (this.incomingUrlInFlight) {
      this.queuedIncomingUrl = target;
      return;
    }

    this.incomingUrlInFlight = true;
    try {
      let nextUrl: string | null = target;
      while (nextUrl) {
        const currentUrl = nextUrl;
        nextUrl = null;
        this.queuedIncomingUrl = null;

        if (!this.discoveryLinks.isDiscoveryUrl(currentUrl)) {
          continue;
        }

        await this.dismissOpenOverlaysIfAny();
        await this.hideKeyboardIfOpen();
        await this.discoveryLinks.routeIfHandled(currentUrl, {
          openExternalWhenBrowserMode: true,
        });

        if (this.queuedIncomingUrl && this.queuedIncomingUrl !== currentUrl) {
          nextUrl = this.queuedIncomingUrl;
        }
      }
    } finally {
      this.incomingUrlInFlight = false;
      this.queuedIncomingUrl = null;
    }
  }

  private async dismissOpenOverlaysIfAny(): Promise<void> {
    try {
      for (let i = 0; i < 8; i += 1) {
        const [topModal, topActionSheet, topPopover, topAlert] = await Promise.all([
          this.modalCtrl.getTop(),
          this.actionSheetCtrl.getTop(),
          this.popoverCtrl.getTop(),
          this.alertCtrl.getTop(),
        ]);

        const topOverlay = topModal ?? topActionSheet ?? topPopover ?? topAlert;
        if (!topOverlay) break;

        await topOverlay.dismiss();
      }
      this.globals.modal_open = false;
    } catch {
      // Ignore modal-dismiss errors and continue deep-link routing.
    }
  }

  private async hideKeyboardIfOpen(): Promise<void> {
    try {
      await Keyboard.hide();
    } catch {
      // Keyboard may be unavailable on web/simulator; safe to ignore.
    }
  }

}
