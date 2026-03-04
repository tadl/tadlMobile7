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
import { format } from 'date-fns';

export interface PickupLocationOption {
  code: string; // e.g. "TADL-WOOD"
  name: string; // e.g. "Woodmere (Main) Branch Library"
}

@Injectable({ providedIn: 'root' })
export class Globals {
  constructor(
    private menuController: MenuController,
    private modalController: ModalController,
    private alertController: AlertController,
    private platform: Platform,
  ) {}

  // ---- app identity / toggles ----
  public app_version: string = '7.0.2';
  public update_version: string = '20260303';
  public build_num: string = '00';

  public device_info: any;
  public system_color: any = window.matchMedia('(prefers-color-scheme: dark)');

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
  public pickupLocations: Array<{ id: number; code: string; name: string }> = [
    { id: 7, code: 'TADL-WOOD', name: 'Woodmere (Main) Branch Library' },
    { id: 2, code: 'TADL-EBB', name: 'East Bay Branch Library' },
    { id: 3, code: 'TADL-FLPL', name: 'Fife Lake Public Library' },
    { id: 4, code: 'TADL-IPL', name: 'Interlochen Public Library' },
    { id: 5, code: 'TADL-KBL', name: 'Kingsley Branch Library' },
    { id: 6, code: 'TADL-PCL', name: 'Peninsula Community Library' },
  ];

  pickupNameForCode(code: string): string | null {
    const c = (code ?? '').trim();
    const loc = this.pickupLocations.find(x => x.code === c);
    return loc ? loc.name : null;
  }

  pickupAspenNewLocation(loc: { id: number; code: string }): string {
    return `${loc.id}_${loc.code}`;
  }

  // New locations host
  public locations_base: string = 'https://locations.tools.tadl.org';
  public fines_payment_url: string = 'https://pay.catalog.tadl.org/pay';
  public melcat_base: string = 'https://search.mel.org';
  public melcat_search_path: string = '/iii/encore/HomePage,queryComponent.searchFormComponent.sdirect';
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

  // ---- helpers ----
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
    return format(new Date(), 'EEEE'); // e.g. "Monday"
  }

  async open_account_menu() {
    await this.menuController.enable(true, 'account');

    const m = await this.menuController.get('account');
    console.log('[Globals] account menu found?', !!m, m);

    const opened = await this.menuController.open('account');
    console.log('[Globals] account menu opened?', opened);

    return opened;
  }

  async toggleMenu(menu: string) {
    await this.menuController.enable(true, menu);

    const m = await this.menuController.get(menu);
    console.log(`[Globals] ${menu} menu found?`, !!m, m);

    const toggled = await this.menuController.toggle(menu);
    console.log(`[Globals] ${menu} menu toggled?`, toggled);

    return toggled;
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
