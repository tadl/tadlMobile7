import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Platform } from '@ionic/angular/standalone';
import { Preferences } from '@capacitor/preferences';
import { Globals } from '../../globals';

@Component({
  standalone: true,
  selector: 'app-about',
  templateUrl: './about.page.html',
  styleUrls: ['./about.page.scss'],
  imports: [CommonModule, IonicModule],
})
export class AboutPage implements OnInit {
  platforms = '';
  storageDriver: string = '(pending)';
  credsMigrated: 'yes' | 'no' | 'pending' = 'pending';
  screenSize = '';

  constructor(
    public globals: Globals,
    private platform: Platform,
  ) {
    this.platforms = this.platform.platforms().join('/');
    this.updateScreenSize();
  }

  async ngOnInit() {
    await this.refreshPageData();
  }

  async ionViewWillEnter() {
    await this.refreshPageData();
  }

  private async refreshPageData() {
    this.updateScreenSize();

    if (!this.globals.device_info) {
      try {
        await this.globals.getDeviceInfo();
      } catch {
        // Ignore plugin errors in unsupported environments.
      }
    }

    try {
      const { value } = await Preferences.get({ key: 'creds_migrated_v1' });
      this.credsMigrated = value === 'yes' ? 'yes' : 'no';
    } catch {
      this.credsMigrated = 'pending';
    }

    this.storageDriver = this.computeStorageDriver();
  }

  private updateScreenSize() {
    this.screenSize = `${this.platform.width()} x ${this.platform.height()}`;
  }

  private computeStorageDriver(): string {
    const isNative = this.platform.is('ios') || this.platform.is('android');
    if (isNative) return 'preferences';
    return 'preferences (web)';
  }
}
