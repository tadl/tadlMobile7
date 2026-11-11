import { APP_PROFILE } from './app-profile';
import type { AppConfig } from './services/app-config.types';

// Bootstrap only: valid cached/proxy configuration replaces this on startup.
export const BUNDLED_APP_CONFIG: AppConfig = {
  schemaVersion: 1,
  backend: APP_PROFILE.aspenApiParam,
  revision: 'bundled',
  locations: [
    {
      evergreenId: 23,
      aspenId: 7,
      pickupCode: 'TADL-WOOD',
      shortname: 'wood',
      name: 'Woodmere (Main) Branch Library',
      pickupEnabled: true,
    },
    {
      evergreenId: 28,
      aspenId: 2,
      pickupCode: 'TADL-EBB',
      shortname: 'ebb',
      name: 'East Bay Branch Library',
      pickupEnabled: true,
    },
    {
      evergreenId: 27,
      aspenId: 3,
      pickupCode: 'TADL-FLPL',
      shortname: 'flpl',
      name: 'Fife Lake Public Library',
      pickupEnabled: true,
    },
    {
      evergreenId: 24,
      aspenId: 4,
      pickupCode: 'TADL-IPL',
      shortname: 'ipl',
      name: 'Interlochen Public Library',
      pickupEnabled: true,
    },
    {
      evergreenId: 25,
      aspenId: 5,
      pickupCode: 'TADL-KBL',
      shortname: 'kbl',
      name: 'Kingsley Branch Library',
      pickupEnabled: true,
    },
    {
      evergreenId: 26,
      aspenId: 6,
      pickupCode: 'TADL-PCL',
      shortname: 'pcl',
      name: 'Peninsula Community Library',
      pickupEnabled: true,
    },
  ],
  searchScopes: [{ id: 'all', name: 'All locations', filters: [] }],
};
