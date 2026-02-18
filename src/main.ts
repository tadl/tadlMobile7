import { bootstrapApplication } from '@angular/platform-browser';
import { PreloadAllModules, provideRouter, RouteReuseStrategy, withPreloading } from '@angular/router';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';

import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular/standalone';
import {
  ModalController,
  AlertController,
  ActionSheetController,
  MenuController,
  ToastController,
  LoadingController,
  PopoverController,
  Platform,
} from '@ionic/angular/standalone';

import { addIcons } from 'ionicons';
import {
  home,
  compass,
  calendar,
  megaphone,
  star,
  informationCircle,
  personCircle,
  openOutline,
  locationOutline,
  calendarOutline,
  close,
} from 'ionicons/icons';

import { routes } from './app/app.routes';
import { AppComponent } from './app/app.component';

// Register only what you use (fixes ionicon asset-path / base URL issues)
addIcons({
  home,
  compass,
  calendar,
  megaphone,
  star,
  'calendar-outline': calendarOutline,
  'open-outline': openOutline,
  'location-outline': locationOutline,
  'information-circle': informationCircle,
  'person-circle': personCircle,
  close,
});

bootstrapApplication(AppComponent, {
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },

    provideIonicAngular(),

    // Controllers MUST match the same import path used by injectors (standalone)
    ModalController,
    AlertController,
    ActionSheetController,
    MenuController,
    ToastController,
    LoadingController,
    PopoverController,
    Platform,

    provideRouter(routes, withPreloading(PreloadAllModules)),
    provideHttpClient(withInterceptorsFromDi()),
  ],
}).catch(err => console.error(err));
