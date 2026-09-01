import { provideHttpClient } from '@angular/common/http';
import { EnvironmentProviders, Provider } from '@angular/core';
import { provideRouter } from '@angular/router';
import {
  ActionSheetController,
  AlertController,
  LoadingController,
  MenuController,
  ModalController,
  Platform,
  PopoverController,
  ToastController,
  provideIonicAngular,
} from '@ionic/angular';

export const APP_TEST_PROVIDERS: Array<Provider | EnvironmentProviders> = [
  provideHttpClient(),
  provideRouter([]),
  provideIonicAngular(),
  ActionSheetController,
  AlertController,
  LoadingController,
  MenuController,
  ModalController,
  {
    provide: Platform,
    useValue: {
      ready: () => new Promise<void>(() => {}),
      is: () => false,
      platforms: () => [],
      width: () => 1024,
      height: () => 768,
      backButton: {
        subscribeWithPriority: () => ({ unsubscribe: () => {} }),
      },
    },
  },
  PopoverController,
  ToastController,
];
