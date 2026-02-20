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
import { format } from 'date-fns';

@Injectable({ providedIn: 'root' })
export class Globals {
  constructor(
    private menuController: MenuController,
    private modalController: ModalController,
    private alertController: AlertController,
    private platform: Platform,
  ) {}

  // ---- app identity / toggles ----
  public app_version: string = '7.0.0';
  public update_version: string = '2026021800';

  public device_info: any;
  public system_color: any = window.matchMedia('(prefers-color-scheme: dark)');

  public system_short_name: string = 'TADL';

  // Aspen API proxy (LIDA-compatible paths)
  public aspen_base: string = 'https://aspen.tools.tadl.org';
  public aspen_api_base: string = this.aspen_base + '/API';

  // Centralized Aspen ILS API selector (your proxy requires this)
  public aspen_api_param_api: string = 'tadl-prod';

  // New locations host
  public locations_base: string = 'https://locations.tools.tadl.org';

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

  // Back-compat alias (so older code doesn’t explode if referenced anywhere)
  public hours_locations_url: string = this.locations_list_url;

  // ---- UI state ----
  public api_loading: boolean = false;
  public net_status: string = 'online';
  public net_type: string = 'unknown';
  public modal_open: boolean = false;

  public server_error_msg: string =
    'Whoops. Something went wrong. Please check your internet connection and try again in a minute.';

  // ---- helpers ----
  async open_page(url: string) {
    await Browser.open({ url });
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
