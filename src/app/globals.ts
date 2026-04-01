import { Injectable } from '@angular/core';
import {
  AlertController,
  ModalController,
  MenuController,
  Platform,
} from '@ionic/angular/standalone';
import { Browser } from '@capacitor/browser';
import { Device } from '@capacitor/device';
import { App } from '@capacitor/app';
import { AppLauncher } from '@capacitor/app-launcher';
import { Network } from '@capacitor/network';
import { Preferences } from '@capacitor/preferences';
import { format } from 'date-fns';

export interface PickupLocationOption {
  code: string; // e.g. "TADL-WOOD"
  name: string; // e.g. "Woodmere (Main) Branch Library"
}

export interface AspenPickupLocationOption extends PickupLocationOption {
  id: number;
}

type ThemeMode = 'light' | 'dark' | 'system';
type LinkMode = 'app' | 'browser';

@Injectable({ providedIn: 'root' })
export class Globals {
  public readonly app_time_zone = 'America/New_York';
  private readonly theme_pref_key = 'app:theme_mode';
  private readonly link_pref_key = 'app:link_mode';
  private theme_initialized = false;
  private link_mode_initialized = false;

  constructor(
    private menuController: MenuController,
    private modalController: ModalController,
    private alertController: AlertController,
    private platform: Platform,
  ) {}

  // ---- app identity / toggles ----
  public app_version: string = '7.0.85';
  public update_version: string = '20260401';
  public build_num: string = '00';

  public device_info: any;
  public system_color: any = window.matchMedia('(prefers-color-scheme: dark)');
  public theme_mode: ThemeMode = 'system';
  public link_mode: LinkMode = 'app';

  public system_short_name: string = 'TADL';

  // Aspen hosts:
  // - discovery host serves catalog pages and covers
  // - api host serves proxied API endpoints
  public aspen_discovery_base: string = 'https://discover.tadl.org';
  public aspen_api_host: string = 'https://aspen.tools.tadl.org';
  public aspen_api_base: string = this.aspen_api_host + '/API';

  // Back-compat alias: existing code may still reference this for discovery links.
  public aspen_base: string = this.aspen_discovery_base;

  // Centralized Aspen ILS API selector (your proxy requires this)
  public aspen_api_param_api: string = 'tadl-prod';

  // Pickup locations (Aspen LocationID + PickupBranch code)
  // NOTE: Aspen expects newLocation formatted as "<locationId>_<pickupBranchCode>"
  public pickupLocations: AspenPickupLocationOption[] = [
    { id: 7, code: 'TADL-WOOD', name: 'Woodmere (Main) Branch Library' },
    { id: 2, code: 'TADL-EBB', name: 'East Bay Branch Library' },
    { id: 3, code: 'TADL-FLPL', name: 'Fife Lake Public Library' },
    { id: 4, code: 'TADL-IPL', name: 'Interlochen Public Library' },
    { id: 5, code: 'TADL-KBL', name: 'Kingsley Branch Library' },
    { id: 6, code: 'TADL-PCL', name: 'Peninsula Community Library' },
  ];

  // Legacy Preferences pickup_library ids -> Aspen location ids.
  // Legacy:
  // 23 Traverse City, 24 Interlochen, 25 Kingsley, 26 Peninsula, 27 Fife Lake, 28 East Bay
  // Aspen:
  // 7 Woodmere, 4 Interlochen, 5 Kingsley, 6 Peninsula, 3 Fife Lake, 2 East Bay
  public legacyPickupLibraryToAspenLocationId: Record<string, number> = {
    '23': 7,
    '24': 4,
    '25': 5,
    '26': 6,
    '27': 3,
    '28': 2,
  };

  pickupNameForCode(code: string): string | null {
    const c = (code ?? '').trim();
    const loc = this.pickupLocations.find(x => x.code === c);
    return loc ? loc.name : null;
  }

  pickupLocationByAspenId(id: string | number): AspenPickupLocationOption | null {
    const n = Number(id);
    if (!Number.isFinite(n)) return null;
    return this.pickupLocations.find((x) => x.id === n) ?? null;
  }

  pickupLocationFromLegacyPreferencesCode(legacyCode: string | number): AspenPickupLocationOption | null {
    const code = (legacyCode ?? '').toString().trim();
    if (!code) return null;
    const aspenId = this.legacyPickupLibraryToAspenLocationId[code];
    if (!aspenId) return null;
    return this.pickupLocationByAspenId(aspenId);
  }

  pickupAspenNewLocation(loc: { id: number; code: string }): string {
    return `${loc.id}_${loc.code}`;
  }

  // New locations host
  public locations_base: string = 'https://locations.tools.tadl.org';
  public fines_payment_url: string = 'https://pay.catalog.tadl.org/pay';
  public melcat_base: string = 'https://search.mel.org';
  public melcat_search_path: string = '/iii/encore/HomePage,queryComponent.searchFormComponent.sdirect';
  public my_melcat_url: string = 'https://dcb3.mel.org/patroninfo?agency=zv330';
  public suggest_item_url: string = 'https://www.tadl.org/suggestion';

  // Locations APIs
  public locations_group: string = 'tadl';
  public locations_list_url: string = `${this.locations_base}/locations.json?group=${encodeURIComponent(
    this.locations_group,
  )}`;

  locations_detail_url(shortname: string): string {
    return `${this.locations_base}/locations.json?shortname=${encodeURIComponent(
      (shortname || '').trim(),
    )}`;
  }

  melcatSearchUrl(query: string): string {
    const params = new URLSearchParams({
      formids: 'If_5,searchString,If_7,If_9,searchImageSumbitComponent',
      seedids: 'ZH4sIAAAAAAAAAIVUS27bMBB1geYmWUaAHTO2u3TVtDHgNIHtosuCooY2YYqjkrQL5Uy9Rhc5TO/QoSQgomyjK1HzhjPvzYe//w6uXgaD94PB4OrPjQN7VAKuhzcl34aPwKJEA8bXZ+O5MmDp7MA5hSacytb7u+VlCTbt3HA70LpryDCvuv+gk5nMJtl0Bsl4Ms4SNmOj5AMXkyRnU8mmIybZMBCRnIihWYHmnhJ3gxhcC6tK/wier0BacLsunCLuFbiNKuCFbE9SOvBppOuMwwM3uQbbRH6L8oxaieoreiVVrHUhrxkJxl/pwXksHoDnYBcyStRFDNXax7XBfcqtXyqzf7OPIvvcROW71w6ubyOPR2oMNeM0fMm9RbNB1K5rzpUrNa+ea/SpDLV1C3kbdZEfYbNTbg3cil2PQlC8JocGDAxizU3aOZXSu29lzj2cCVDDiyLwlmfILbnZHghcgwbhkWr3TH/nKtxmEwIPxi9xq8z/tfbmccKyDDI+Tm7leJYwmbEku2MsuZsymIpsOpzxMI9fgBZBiSD4xzC0vy54fWxIUHY8UAeMVLb4qFHsu4mKqiX5CXyvIC3LpmRzCzymuKtlt0O2eVx2MY9lnSm+QdYVGLp0wuLItcrrfbq39Ai8e7VoL+EEuc8xHB4EOrk2em+3fx7AVmtqGF3vSeT5kRsBeTM0MdsYCxMeqccCQvPTJnVK87RFW51z6e0e91zjNt0hUqN6fEQUjdY8Ejrq4VUzh5D3t9va4BT7ni7ihWCXlPbtdVmjBaoLRYyLjvUfbRVjC9cFAAA',
      lang: 'eng',
      suite: 'gold',
      reservedids: 'inst,lang,suite',
      submitmode: '',
      submitname: '',
      If_5: 'F',
      If_7: 'F',
      If_9: 'T',
      searchString: (query ?? '').trim(),
    });

    return `${this.melcat_base}${this.melcat_search_path}?${params.toString()}`;
  }

  // Back-compat alias (so older code doesn’t explode if referenced anywhere)
  public hours_locations_url: string = this.locations_list_url;

  // ---- UI state ----
  public api_loading: boolean = false;
  public net_status: string = 'online';
  public net_type: string = 'unknown';
  public modal_open: boolean = false;

  public server_error_msg: string =
    'Whoops. Something went wrong. Please check your internet connection and try again in a minute.';

  private connectionChangeHandler = () => this.updateNetworkFromEnvironment();
  private browserOnlineHandler = () => this.updateNetworkFromEnvironment();
  private browserOfflineHandler = () => this.updateNetworkFromEnvironment();
  private nativeNetworkListenerHandle: { remove: () => Promise<void> } | null = null;
  private readonly systemThemeChangeHandler = () => {
    if (this.theme_mode === 'system') this.applyThemeClass('system');
  };

  // ---- helpers ----
  async initThemePreference() {
    if (this.theme_initialized) {
      this.applyThemeClass(this.theme_mode);
      return;
    }

    let preferred: ThemeMode = 'system';

    try {
      const { value } = await Preferences.get({ key: this.theme_pref_key });
      if (value === 'light' || value === 'dark' || value === 'system') preferred = value;
    } catch {
      // Fall back to system theme preference when local preferences are unavailable.
    }

    this.theme_mode = preferred;
    this.theme_initialized = true;
    this.applyThemeClass(preferred);
    this.attachSystemThemeListener();
  }

  async initLinkPreference() {
    if (this.link_mode_initialized) return;

    let preferred: LinkMode = 'app';
    try {
      const { value } = await Preferences.get({ key: this.link_pref_key });
      if (value === 'app' || value === 'browser') preferred = value;
    } catch {
      // Keep default when local preferences are unavailable.
    }

    this.link_mode = preferred;
    this.link_mode_initialized = true;
  }

  isDarkTheme(): boolean {
    if (this.theme_mode === 'dark') return true;
    if (this.theme_mode === 'light') return false;
    return !!this.system_color?.matches;
  }

  async setTheme(mode: ThemeMode) {
    this.theme_mode = mode === 'dark' || mode === 'light' || mode === 'system' ? mode : 'system';
    this.applyThemeClass(this.theme_mode);
    this.theme_initialized = true;
    await Preferences.set({ key: this.theme_pref_key, value: this.theme_mode });
    this.attachSystemThemeListener();
  }

  async setLinkMode(mode: LinkMode) {
    const next: LinkMode = mode === 'browser' ? 'browser' : 'app';
    this.link_mode = next;
    this.link_mode_initialized = true;
    await Preferences.set({ key: this.link_pref_key, value: next });
  }

  private applyThemeClass(mode: ThemeMode) {
    const dark = mode === 'system' ? !!this.system_color?.matches : mode === 'dark';
    const root = document.documentElement;
    root.classList.toggle('ion-palette-dark', dark);
  }

  private attachSystemThemeListener() {
    if (!this.system_color) return;

    const anyMedia = this.system_color as any;
    if (typeof anyMedia.addEventListener === 'function') {
      anyMedia.removeEventListener('change', this.systemThemeChangeHandler);
      anyMedia.addEventListener('change', this.systemThemeChangeHandler);
      return;
    }

    if (typeof anyMedia.addListener === 'function') {
      anyMedia.removeListener?.(this.systemThemeChangeHandler);
      anyMedia.addListener(this.systemThemeChangeHandler);
    }
  }

  async open_page(url: string) {
    await Browser.open({ url });
  }

  async open_external_page(url: string) {
    const target = (url ?? '').toString().trim();
    if (!target) return;

    try {
      await AppLauncher.openUrl({ url: target });
      return;
    } catch {
      // Fall back to the in-app browser when the launcher path is unavailable.
    }

    await Browser.open({ url: target });
  }

  day_today() {
    return this.easternWeekdayKey(new Date()).replace(/^./, (ch) => ch.toUpperCase());
  }

  easternDateString(value: Date = new Date()): string {
    const parts = this.easternDateParts(value);
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  easternWeekdayKey(value: Date = new Date()): string {
    return this.easternDateParts(value).weekday;
  }

  easternDateStringPlusDays(days: number, from: Date = new Date()): string {
    const parts = this.easternDateParts(from);
    const baseUtc = new Date(Date.UTC(parts.yearNum, parts.monthNum - 1, parts.dayNum));
    baseUtc.setUTCDate(baseUtc.getUTCDate() + days);
    const year = String(baseUtc.getUTCFullYear()).padStart(4, '0');
    const month = String(baseUtc.getUTCMonth() + 1).padStart(2, '0');
    const day = String(baseUtc.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private easternDateParts(value: Date = new Date()): {
    year: string;
    month: string;
    day: string;
    weekday: string;
    yearNum: number;
    monthNum: number;
    dayNum: number;
  } {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: this.app_time_zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'long',
    }).formatToParts(value);

    const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
    const month = parts.find((part) => part.type === 'month')?.value ?? '01';
    const day = parts.find((part) => part.type === 'day')?.value ?? '01';
    const weekday = (parts.find((part) => part.type === 'weekday')?.value ?? 'monday').toLowerCase();

    return {
      year,
      month,
      day,
      weekday,
      yearNum: Number(year),
      monthNum: Number(month),
      dayNum: Number(day),
    };
  }

  async open_account_menu() {
    await this.menuController.enable(true, 'account');
    return this.menuController.open('account');
  }

  async toggleMenu(menu: string) {
    await this.menuController.enable(true, menu);
    return this.menuController.toggle(menu);
  }

  async close_modal() {
    await this.modalController.dismiss('Wrapped up!');
    this.modal_open = false;
  }

  async go_back() {
    if (this.modal_open) {
      await this.close_modal();
    } else {
      window.history.back();
    }
  }

  loading_show() {
    this.api_loading = true;
  }

  async getDeviceInfo() {
    this.device_info = await Device.getInfo();
  }

  initNetworkStatusTracking() {
    this.updateNetworkFromEnvironment();

    window.addEventListener('online', this.browserOnlineHandler);
    window.addEventListener('offline', this.browserOfflineHandler);

    const conn = this.getBrowserConnection();
    if (conn?.addEventListener) {
      conn.addEventListener('change', this.connectionChangeHandler);
    }

    void this.initNativeNetworkTracking();
  }

  private updateNetworkFromEnvironment() {
    const online = typeof navigator?.onLine === 'boolean' ? navigator.onLine : true;
    this.net_status = online ? 'online' : 'offline';
    this.net_type = this.pickNetworkType(online);
  }

  private async initNativeNetworkTracking() {
    try {
      const status = await Network.getStatus();
      this.applyNativeNetworkStatus(status.connected, status.connectionType);
      this.nativeNetworkListenerHandle ??= await Network.addListener('networkStatusChange', status => {
        this.applyNativeNetworkStatus(status.connected, status.connectionType);
      });
    } catch {
      // Browser fallback remains in place when the native plugin is unavailable.
    }
  }

  private applyNativeNetworkStatus(connected: boolean, connectionType?: string) {
    this.net_status = connected ? 'online' : 'offline';
    this.net_type = this.normalizeNetworkType(connected, connectionType ?? '');
  }

  private pickNetworkType(online: boolean): string {
    if (!online) return 'none';

    const conn = this.getBrowserConnection();
    const rawTransport = ((conn?.type ?? '') as string).toLowerCase().trim();
    const rawEffective = ((conn?.effectiveType ?? '') as string).toLowerCase().trim();
    const isDesktop = this.platform.is('desktop');

    if (rawTransport) {
      return this.normalizeNetworkType(true, rawTransport);
    }

    // effectiveType (2g/3g/4g) is link quality, not transport; on desktop it often
    // reports "4g" even when wired, so do not classify desktop as cellular from it.
    if (rawEffective) {
      if (isDesktop) return 'ethernet';
      if (rawEffective === '4g' || rawEffective === '3g' || rawEffective === '2g' || rawEffective === 'slow-2g') {
        return 'cellular';
      }
      return rawEffective;
    }

    // Fallback for desktop browsers that expose neither field.
    if (isDesktop) return 'ethernet';

    return 'unknown';
  }

  private normalizeNetworkType(online: boolean, rawType: string): string {
    const type = (rawType || '').toLowerCase().trim();
    if (!online || type === 'none') return 'none';
    if (type.includes('wifi') || type === 'wlan') return 'wifi';
    if (type.includes('ethernet') || type.includes('wired')) return 'ethernet';
    if (type.includes('cell') || type === '4g' || type === '3g' || type === '2g' || type === '5g') return 'cellular';
    if (type === 'unknown' || !type) {
      if (this.device_info?.isVirtual) return 'simulator';
      return online ? 'unknown' : 'none';
    }
    return type;
  }

  private getBrowserConnection(): any {
    const n = navigator as any;
    return n?.connection ?? n?.mozConnection ?? n?.webkitConnection ?? null;
  }

  async confirm_exit() {
    if (this.modal_open) {
      await this.close_modal();
      return;
    }

    const alert = await this.alertController.create({
      header: 'Exit the app?',
      buttons: [
        { text: 'Cancel', role: 'cancel', cssClass: 'secondary' },
        { text: 'Exit App', handler: () => App.exitApp() },
      ],
    });
    await alert.present();
  }

  replacebreaks(str: string) {
    return str.replace(/\n/g, '<br>');
  }
}
