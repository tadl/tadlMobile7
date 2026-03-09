import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { Platform } from '@ionic/angular/standalone';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { App } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';
import { fromEvent, Observable, firstValueFrom } from 'rxjs';
import { distinctUntilChanged, filter, take } from 'rxjs/operators';
import { NavigationEnd, Router } from '@angular/router';

import { Globals } from './globals';
import { AuthService } from './services/auth.service';
import { LoadingService } from './services/loading.service';
import { CacheWarmService } from './services/cache-warm.service';
import { AccountStoreService } from './services/account-store.service';

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

  constructor(
    public globals: Globals,
    private platform: Platform,
    private auth: AuthService,
    private loading: LoadingService,
    private cacheWarm: CacheWarmService,
    private router: Router,
    private http: HttpClient,
    private accounts: AccountStoreService,
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
        void this.handleIncomingUrl(url);
      });
      App.getLaunchUrl()
        .then((launch) => {
          const url = (launch?.url ?? '').toString().trim();
          if (url) void this.handleIncomingUrl(url);
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
    const raw = (rawUrl ?? '').toString().trim();
    if (!raw) return;

    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return;
    }

    const host = (parsed.hostname ?? '').toLowerCase();
    if (host !== 'discover.tadl.org') return;

    if (this.globals.link_mode === 'browser') {
      await this.globals.open_external_page(raw);
      return;
    }

    const path = (parsed.pathname ?? '').trim();
    const parts = path.split('/').filter(Boolean);
    const first = (parts[0] ?? '').toLowerCase();

    // /GroupedWork/{groupedId}/...
    if (first === 'groupedwork' && parts[1]) {
      await this.router.navigate(['/item', parts[1]]);
      return;
    }

    // /Record/{recordId}
    if (first === 'record' && parts[1]) {
      await this.resolveRecordLink(parts[1], raw);
      return;
    }

    // /MyAccount/... => /account
    if (first === 'myaccount') {
      await this.router.navigate(['/account']);
      return;
    }

    // /Union/Search?... and /Search/Results?... => /search
    if ((first === 'union' && (parts[1] ?? '').toLowerCase() === 'search') || first === 'search') {
      await this.handleSearchLink(parsed, raw);
      return;
    }
  }

  private async handleSearchLink(url: URL, rawUrl: string): Promise<void> {
    const lookfor =
      (url.searchParams.get('lookfor') ?? '').toString().trim() ||
      (url.searchParams.get('lookfor0[]') ?? '').toString().trim() ||
      (url.searchParams.get('lookfor0%5B%5D') ?? '').toString().trim();

    // Classic web id search form:
    // /Search/Results?...lookfor0[]=48268884&type0[]=id...
    const type0 =
      (url.searchParams.get('type0[]') ?? '').toString().trim().toLowerCase() ||
      (url.searchParams.get('type0%5B%5D') ?? '').toString().trim().toLowerCase();
    if (type0 === 'id' && lookfor) {
      await this.resolveRecordLink(lookfor, rawUrl);
      return;
    }

    const searchIndex = (url.searchParams.get('searchIndex') ?? '').toString().trim();
    const allowed = new Set(['Keyword', 'Title', 'Author', 'Subject', 'ISBN']);

    const queryParams: Record<string, any> = {};
    if (lookfor) queryParams['lookfor'] = lookfor;
    if (allowed.has(searchIndex)) queryParams['searchIndex'] = searchIndex;

    await this.router.navigate(['/search'], { queryParams });
  }

  private async resolveRecordLink(recordIdRaw: string, fallbackUrl: string): Promise<void> {
    const recordId = (recordIdRaw ?? '').toString().trim();
    if (!recordId) return;

    const groupedId = await this.lookupGroupedIdForRecord(recordId);
    if (groupedId) {
      await this.router.navigate(['/item', groupedId]);
      return;
    }

    await this.globals.open_external_page(fallbackUrl);
  }

  private async lookupGroupedIdForRecord(recordId: string): Promise<string | null> {
    let params = new HttpParams()
      .set('id', recordId)
      .set('api', this.globals.aspen_api_param_api);

    const snap = this.auth.snapshot();
    const username = (snap?.activeAccountMeta?.username ?? '').toString().trim();
    const activeId = (snap?.activeAccountId ?? '').toString().trim();

    let body = '';
    let headers: HttpHeaders | undefined;
    if (username && activeId) {
      const password = (await this.accounts.getPassword(activeId)) ?? '';
      if (password) {
        const post = new URLSearchParams();
        post.set('username', username);
        post.set('password', password);
        body = post.toString();
        headers = new HttpHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' });
      }
    }

    try {
      const raw = await firstValueFrom(
        this.http.post<any>(`${this.globals.aspen_api_base}/RecordLookup`, body, { params, headers }),
      );
      const result = raw?.result ?? raw;
      const success = !!result?.success;
      const groupedId = (result?.id ?? '').toString().trim();
      const hasFormats = result?.formats && typeof result.formats === 'object';
      if (!success || !groupedId || !hasFormats) return null;
      return groupedId;
    } catch {
      return null;
    }
  }

}
