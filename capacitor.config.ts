import type { CapacitorConfig } from '@capacitor/cli';

const IOS_APP_ID = 'org.tadl.tadl';
const ANDROID_APP_ID = 'org.TADL.TADLMobile';
const target = (process.env.TADL_TARGET ?? '').toLowerCase().trim();

const resolvedAppId =
  (process.env.CAP_APP_ID ?? '').trim() ||
  (target === 'android' ? ANDROID_APP_ID : IOS_APP_ID);

const config: CapacitorConfig = {
  appId: resolvedAppId,
  appName: 'TADL Mobile',
  webDir: 'www'
};

export default config;
