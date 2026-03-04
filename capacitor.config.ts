import type { CapacitorConfig } from '@capacitor/cli';

const IOS_APP_ID = 'org.tadl.tadl';
const ANDROID_APP_ID = 'org.TADL.TADLMobile';
const target = (process.env.TADL_TARGET ?? '').toLowerCase().trim();

const resolvedAppId =
  (process.env.CAP_APP_ID ?? '').trim() ||
  (target === 'android' ? ANDROID_APP_ID : IOS_APP_ID);

const config: CapacitorConfig = {
  appId: resolvedAppId,
  appName: 'TADL',
  webDir: 'www',
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      // Keep native splash visible until app explicitly hides after first navigation.
      launchShowDuration: 0,
      backgroundColor: '#efefef',
    },
  },
};

export default config;
