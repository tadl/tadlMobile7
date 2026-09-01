import type { CapacitorConfig } from '@capacitor/cli';

const IOS_APP_ID = 'org.tadl.tadl';
const ANDROID_APP_ID = 'org.TADL.TADLMobile';
const APP_NAME = 'TADL';
const target = (process.env.MOBILE_TARGET ?? process.env.TADL_TARGET ?? '')
  .toLowerCase()
  .trim();

const resolvedAppId =
  (process.env.CAP_APP_ID ?? '').trim() ||
  (target === 'android' ? ANDROID_APP_ID : IOS_APP_ID);

const config: CapacitorConfig = {
  appId: resolvedAppId,
  appName: APP_NAME,
  webDir: 'www',
  ios: {
    includePlugins: [
      '@capacitor/app',
      '@capacitor/app-launcher',
      '@capacitor/browser',
      '@capacitor/device',
      '@capacitor/haptics',
      '@capacitor/keyboard',
      '@capacitor/network',
      '@capacitor/preferences',
      '@capacitor/splash-screen',
      '@capacitor/status-bar',
      '@ebarooni/capacitor-calendar',
      'capacitor-secure-storage-plugin',
    ],
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      // Keep native splash visible until app explicitly hides after first navigation.
      launchShowDuration: 0,
      backgroundColor: '#07153A',
      androidScaleType: 'CENTER_CROP',
    },
  },
};

export default config;
