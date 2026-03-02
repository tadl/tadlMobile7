import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Platform } from '@ionic/angular/standalone';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';
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
  credentialStorage: string = '(pending)';
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

    const secureAvailable = await this.hasSecureStorage();
    this.storageDriver = this.computeStorageDriver();
    this.credentialStorage = this.describeCredentialStorage(secureAvailable);
  }

  private updateScreenSize() {
    this.screenSize = `${this.platform.width()} x ${this.platform.height()}`;
  }

  private computeStorageDriver(): string {
    const isNative = this.platform.is('ios') || this.platform.is('android');
    if (isNative) return 'preferences';
    return 'preferences (web)';
  }

  private describeCredentialStorage(secureAvailable: boolean): string {
    if (secureAvailable) return 'secure-storage';
    if (this.globals.device_info?.isVirtual) return 'secure-storage (simulator unavailable)';
    return 'secure-storage (unavailable)';
  }

  private async hasSecureStorage(): Promise<boolean> {
    try {
      const platform = await SecureStoragePlugin.getPlatform();
      return ['ios', 'android', 'web'].includes((platform?.value ?? '').toLowerCase());
    } catch {
      return false;
    }
  }
}
