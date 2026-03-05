import { bootstrapApplication } from '@angular/platform-browser';
import {
  PreloadAllModules,
  provideRouter,
  RouteReuseStrategy,
  withPreloading,
} from '@angular/router';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { HTTP_INTERCEPTORS } from '@angular/common/http';

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
  search,
  informationCircle,
  personCircle,
  openOutline,
  locationOutline,
  calendarOutline,
  close,
  closeCircle,
  chevronBackOutline,
  chevronForward,
  chevronDown,
  chevronUp,
  add,
  createOutline,
  trashOutline,
  ellipsisVertical,
  navigateOutline,
  personCircleOutline,
  bookmarkOutline,
  albumsOutline,
  barcodeOutline,
  cardOutline,
} from 'ionicons/icons';

import { routes } from './app/app.routes';
import { AppComponent } from './app/app.component';
import { AspenApiParamsInterceptor } from './app/services/aspen-api-params.interceptor';
import { LoadingInterceptor } from './app/services/loading.interceptor';

// Register only what you use (fixes ionicon asset-path / base URL issues)
addIcons({
  home,
  compass,
  calendar,
  megaphone,
  star,
  search,
  'chevron-forward': chevronForward,
  'calendar-outline': calendarOutline,
  'open-outline': openOutline,
  'location-outline': locationOutline,
  'information-circle': informationCircle,
  'person-circle': personCircle,
  close,
  'close-circle': closeCircle,
  'chevron-back-outline': chevronBackOutline,
  add,
  'chevron-down': chevronDown,
  'chevron-up': chevronUp,
  'create-outline': createOutline,
  'trash-outline': trashOutline,
  'ellipsis-vertical': ellipsisVertical,
  'navigate-outline': navigateOutline,
  'person-circle-outline': personCircleOutline,
  'bookmark-outline': bookmarkOutline,
  'albums-outline': albumsOutline,
  'barcode-outline': barcodeOutline,
  'card-outline': cardOutline,
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

    // Interceptors
    { provide: HTTP_INTERCEPTORS, useClass: AspenApiParamsInterceptor, multi: true },
    { provide: HTTP_INTERCEPTORS, useClass: LoadingInterceptor, multi: true },

    provideRouter(routes, withPreloading(PreloadAllModules)),
    provideHttpClient(withInterceptorsFromDi()),
  ],
}).catch(err => console.error(err));
