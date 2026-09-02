import { provideHttpClient } from '@angular/common/http';
import {
  EnvironmentProviders,
  importProvidersFrom,
  Provider,
} from '@angular/core';
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
  IonicModule,
} from '@ionic/angular/lazy';

export const APP_TEST_PROVIDERS: Array<Provider | EnvironmentProviders> = [
  provideHttpClient(),
  provideRouter([]),
  importProvidersFrom(IonicModule.forRoot()),
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
