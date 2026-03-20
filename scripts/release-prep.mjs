#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const IOS_APP_ID = 'org.tadl.tadl';
const ANDROID_APP_ID = 'org.TADL.TADLMobile';

function fail(msg) {
  console.error(`\n[release-prep] ${msg}`);
  process.exit(1);
}

function run(cmd, args, env = {}) {
  const pretty = [cmd, ...args].join(' ');
  console.log(`[release-prep] $ ${pretty}`);
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (res.status !== 0) {
    fail(`Command failed: ${pretty}`);
  }
}

function runAllowFail(cmd, args, env = {}) {
  const pretty = [cmd, ...args].join(' ');
  console.log(`[release-prep] $ ${pretty}`);
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  return res.status === 0;
}

function readText(path) {
  return readFileSync(path, 'utf8');
}

function writeText(path, content) {
  writeFileSync(path, content, 'utf8');
}

function preserveFiles(paths) {
  const preserved = [];
  const preserveRoot = resolve('.release-prep-preserve');
  rmSync(preserveRoot, { recursive: true, force: true });

  for (const relPath of paths) {
    const absPath = resolve(relPath);
    if (!existsSync(absPath)) continue;
    const destPath = resolve(preserveRoot, relPath);
    mkdirSync(dirname(destPath), { recursive: true });
    copyFileSync(absPath, destPath);
    preserved.push(relPath);
  }

  return {
    root: preserveRoot,
    files: preserved,
  };
}

function restorePreservedFiles(bundle) {
  if (!bundle?.files?.length) return [];
  const restored = [];

  for (const relPath of bundle.files) {
    const srcPath = resolve(bundle.root, relPath);
    const destPath = resolve(relPath);
    if (!existsSync(srcPath)) continue;
    mkdirSync(dirname(destPath), { recursive: true });
    copyFileSync(srcPath, destPath);
    restored.push(relPath);
  }

  rmSync(bundle.root, { recursive: true, force: true });
  return restored;
}

function replaceAll(content, pattern, replacement, label) {
  if (!pattern.test(content)) {
    fail(`Could not find ${label} while editing file.`);
  }
  return content.replace(pattern, replacement);
}

function updateIosProject(versionName, buildNumber, appId) {
  const pbxprojPath = resolve('ios/App/App.xcodeproj/project.pbxproj');
  if (!existsSync(pbxprojPath)) {
    console.log('[release-prep] iOS project not present yet, skipping pbxproj patch.');
    return;
  }

  let pbx = readText(pbxprojPath);
  pbx = replaceAll(
    pbx,
    /MARKETING_VERSION = [^;]+;/g,
    `MARKETING_VERSION = ${versionName};`,
    'MARKETING_VERSION',
  );
  pbx = replaceAll(
    pbx,
    /CURRENT_PROJECT_VERSION = [^;]+;/g,
    `CURRENT_PROJECT_VERSION = ${buildNumber};`,
    'CURRENT_PROJECT_VERSION',
  );
  pbx = replaceAll(
    pbx,
    /PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/g,
    `PRODUCT_BUNDLE_IDENTIFIER = ${appId};`,
    'PRODUCT_BUNDLE_IDENTIFIER',
  );
  if (!pbx.includes('CODE_SIGN_ENTITLEMENTS = App/App.entitlements;')) {
    pbx = pbx.replace(
      /ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;\n/g,
      'ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;\n\t\t\t\tCODE_SIGN_ENTITLEMENTS = App/App.entitlements;\n',
    );
  }

  writeText(pbxprojPath, pbx);
  console.log('[release-prep] Patched iOS project version/build/appId.');
}

function ensureIosEntitlements() {
  const entitlementsPath = resolve('ios/App/App/App.entitlements');
  const content = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n\t<key>com.apple.developer.associated-domains</key>\n\t<array>\n\t\t<string>applinks:discover.tadl.org</string>\n\t</array>\n</dict>\n</plist>\n`;
  writeText(entitlementsPath, content);
  console.log('[release-prep] Restored iOS entitlements.');
}

function updateIosInfoPlistDisplayName(appName) {
  const plistPath = resolve('ios/App/App/Info.plist');
  if (!existsSync(plistPath)) {
    console.log('[release-prep] iOS Info.plist not present yet, skipping display name patch.');
    return;
  }

  let plist = readText(plistPath);
  plist = replaceAll(
    plist,
    /<key>CFBundleDisplayName<\/key>\s*<string>[^<]*<\/string>/,
    `<key>CFBundleDisplayName</key>\n        <string>${appName}</string>`,
    'CFBundleDisplayName',
  );
  if (!plist.includes('<key>LSApplicationQueriesSchemes</key>')) {
    plist = plist.replace(
      /<key>LSRequiresIPhoneOS<\/key>\s*<true\/>/,
      `<key>LSApplicationQueriesSchemes</key>\n\t<array>\n\t\t<string>comgooglemaps</string>\n\t\t<string>waze</string>\n\t\t<string>maps</string>\n\t</array>\n\t<key>LSRequiresIPhoneOS</key>\n\t<true/>`,
    );
  }
  if (!plist.includes('<key>NSCameraUsageDescription</key>')) {
    plist = plist.replace(
      /<key>UILaunchStoryboardName<\/key>/,
      `<key>NSCameraUsageDescription</key>\n\t<string>Scan ISBN barcodes to search the catalog.</string>\n\t<key>UILaunchStoryboardName</key>`,
    );
  }
  if (!plist.includes('<key>NSCalendarsUsageDescription</key>')) {
    plist = plist.replace(
      /<key>UILaunchStoryboardName<\/key>/,
      `<key>NSCalendarsUsageDescription</key>\n\t<string>Add library events to your calendar.</string>\n\t<key>UILaunchStoryboardName</key>`,
    );
  }
  if (!plist.includes('<key>NSCalendarsWriteOnlyAccessUsageDescription</key>')) {
    plist = plist.replace(
      /<key>UILaunchStoryboardName<\/key>/,
      `<key>NSCalendarsWriteOnlyAccessUsageDescription</key>\n\t<string>Add library events to your calendar.</string>\n\t<key>UILaunchStoryboardName</key>`,
    );
  }
  if (!plist.includes('<key>NSCalendarsFullAccessUsageDescription</key>')) {
    plist = plist.replace(
      /<key>UILaunchStoryboardName<\/key>/,
      `<key>NSCalendarsFullAccessUsageDescription</key>\n\t<string>Let TADL Mobile access your calendar so you can add library events.</string>\n\t<key>UILaunchStoryboardName</key>`,
    );
  }

  writeText(plistPath, plist);
  console.log('[release-prep] Patched iOS display name.');
}

function ensureIosGitignore() {
  const gitignorePath = resolve('ios/.gitignore');
  if (!existsSync(gitignorePath)) return;
  let content = readText(gitignorePath);
  const wanted = ['*.xcuserstate', '*.xcscmblueprint', '*.xccheckout', '*.xcarchive', '*.ipa'];
  for (const line of wanted) {
    if (!content.includes(line)) {
      content = content.replace(/xcuserdata\n/, `xcuserdata\n${line}\n`);
    }
  }
  writeText(gitignorePath, content);
  console.log('[release-prep] Restored iOS .gitignore entries.');
}

function updateAndroidGradle(versionName, buildNumber, appId) {
  const gradlePath = resolve('android/app/build.gradle');
  if (!existsSync(gradlePath)) {
    console.log('[release-prep] Android project not present yet, skipping build.gradle patch.');
    return;
  }

  let gradle = readText(gradlePath);
  if (!gradle.includes('def signingProps = new Properties()')) {
    gradle = gradle.replace(
      "apply plugin: 'com.android.application'\n\n",
      `apply plugin: 'com.android.application'\n\n` +
        `def signingProps = new Properties()\n` +
        `def signingPropsFile = rootProject.file('signing.properties')\n` +
        `if (signingPropsFile.exists()) {\n` +
        `    signingProps.load(new FileInputStream(signingPropsFile))\n` +
        `}\n\n` +
        `def signingValue = { envKey, propKey ->\n` +
        `    def envVal = System.getenv(envKey)\n` +
        `    if (envVal != null && envVal.toString().trim()) return envVal.toString().trim()\n` +
        `    def propVal = signingProps.getProperty(propKey)\n` +
        `    return propVal != null && propVal.toString().trim() ? propVal.toString().trim() : null\n` +
        `}\n\n` +
        `def releaseStoreFile = signingValue('TADL_ANDROID_STORE_FILE', 'storeFile')\n` +
        `def releaseStorePassword = signingValue('TADL_ANDROID_STORE_PASSWORD', 'storePassword')\n` +
        `def releaseKeyAlias = signingValue('TADL_ANDROID_KEY_ALIAS', 'keyAlias')\n` +
        `def releaseKeyPassword = signingValue('TADL_ANDROID_KEY_PASSWORD', 'keyPassword')\n` +
        `def hasReleaseSigning = releaseStoreFile && releaseStorePassword && releaseKeyAlias && releaseKeyPassword\n\n`,
    );
  }

  gradle = replaceAll(
    gradle,
    /namespace\s*=\s*"[^"]+"/,
    `namespace = "${appId}"`,
    'namespace',
  );

  gradle = replaceAll(
    gradle,
    /applicationId\s+"[^"]+"/,
    `applicationId \"${appId}\"`,
    'applicationId',
  );
  gradle = replaceAll(
    gradle,
    /versionCode\s+\d+/,
    `versionCode ${buildNumber}`,
    'versionCode',
  );
  gradle = replaceAll(
    gradle,
    /versionName\s+"[^"]+"/,
    `versionName \"${versionName}\"`,
    'versionName',
  );
  if (!gradle.includes('signingConfigs {')) {
    gradle = gradle.replace(
      /compileSdk = rootProject\.ext\.compileSdkVersion\n/,
      `compileSdk = rootProject.ext.compileSdkVersion\n` +
        `    signingConfigs {\n` +
        `        release {\n` +
        `            if (hasReleaseSigning) {\n` +
        `                storeFile file(releaseStoreFile)\n` +
        `                storePassword releaseStorePassword\n` +
        `                keyAlias releaseKeyAlias\n` +
        `                keyPassword releaseKeyPassword\n` +
        `            }\n` +
        `        }\n` +
        `    }\n`,
    );
  }
  if (!gradle.includes('signingConfig signingConfigs.release')) {
    gradle = gradle.replace(
      /proguardFiles getDefaultProguardFile\('proguard-android\.txt'\), 'proguard-rules\.pro'\n/,
      `proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'\n` +
        `            if (hasReleaseSigning) {\n` +
        `                signingConfig signingConfigs.release\n` +
        `            }\n`,
    );
  }
  if (!gradle.includes('Android release signing is not configured.')) {
    gradle = gradle.replace(
      /\nrepositories \{/,
      `\nif (!hasReleaseSigning) {\n` +
        `    logger.lifecycle("Android release signing is not configured. Create android/signing.properties or set TADL_ANDROID_* env vars.")\n` +
        `}\n\nrepositories {`,
    );
  }

  writeText(gradlePath, gradle);
  console.log('[release-prep] Patched Android applicationId/versionCode/versionName.');
}

function ensureAndroidManifestDeepLinks() {
  const manifestPath = resolve('android/app/src/main/AndroidManifest.xml');
  if (!existsSync(manifestPath)) return;
  let manifest = readText(manifestPath);
  if (!manifest.includes('android:autoVerify="true"')) {
    manifest = manifest.replace(
      /<\/intent-filter>\n\s*<\/activity>/,
      `</intent-filter>\n` +
        `            <intent-filter android:autoVerify="true">\n` +
        `                <action android:name="android.intent.action.VIEW" />\n` +
        `                <category android:name="android.intent.category.DEFAULT" />\n` +
        `                <category android:name="android.intent.category.BROWSABLE" />\n\n` +
        `                <data android:scheme="https" android:host="discover.tadl.org" android:pathPrefix="/GroupedWork/" />\n` +
        `                <data android:scheme="https" android:host="discover.tadl.org" android:pathPrefix="/Record/" />\n` +
        `                <data android:scheme="https" android:host="discover.tadl.org" android:pathPrefix="/Union/Search" />\n` +
        `                <data android:scheme="https" android:host="discover.tadl.org" android:pathPrefix="/Search/" />\n` +
        `                <data android:scheme="https" android:host="discover.tadl.org" android:pathPrefix="/MyAccount/Home" />\n` +
        `            </intent-filter>\n        </activity>`,
    );
  }
  writeText(manifestPath, manifest);
  console.log('[release-prep] Restored Android app links intent filter.');
}

function updateAndroidStrings(appName) {
  const stringsPath = resolve('android/app/src/main/res/values/strings.xml');
  if (!existsSync(stringsPath)) {
    console.log('[release-prep] Android strings.xml not present yet, skipping display name patch.');
    return;
  }

  let strings = readText(stringsPath);
  strings = replaceAll(
    strings,
    /<string name="app_name">[^<]*<\/string>/,
    `<string name="app_name">${appName}</string>`,
    'android app_name',
  );
  strings = replaceAll(
    strings,
    /<string name="title_activity_main">[^<]*<\/string>/,
    `<string name="title_activity_main">${appName}</string>`,
    'android title_activity_main',
  );

  writeText(stringsPath, strings);
  console.log('[release-prep] Patched Android display name.');
}

function ensureAndroidStyles() {
  const stylesPath = resolve('android/app/src/main/res/values/styles.xml');
  if (!existsSync(stylesPath)) return;
  let styles = readText(stylesPath);
  styles = styles.replace(
    /<style name="AppTheme\.NoActionBarLaunch" parent="Theme\.SplashScreen">[\s\S]*?<\/style>/,
    `<style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">\n` +
      `        <!-- Android 12+ splash API: centered icon over solid background (no stretch) -->\n` +
      `        <item name="windowSplashScreenBackground">#07153A</item>\n` +
      `        <item name="windowSplashScreenAnimatedIcon">@mipmap/ic_launcher_foreground</item>\n` +
      `        <item name="windowSplashScreenIconBackgroundColor">#00000000</item>\n` +
      `        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>\n` +
      `        <!-- Fallback for older Android versions -->\n` +
      `        <item name="android:background">#07153A</item>\n` +
      `    </style>`,
  );
  writeText(stylesPath, styles);
  console.log('[release-prep] Restored Android splash theme.');
}

function ensureAndroidVariables() {
  const varsPath = resolve('android/variables.gradle');
  if (!existsSync(varsPath)) return;
  let vars = readText(varsPath);
  vars = replaceAll(
    vars,
    /minSdkVersion = \d+/,
    'minSdkVersion = 26',
    'minSdkVersion',
  );
  writeText(varsPath, vars);
  console.log('[release-prep] Restored Android minSdkVersion.');
}

function ensureAndroidGitignore() {
  const gitignorePath = resolve('android/.gitignore');
  if (!existsSync(gitignorePath)) return;
  let content = readText(gitignorePath);
  const anchorLines = [
    ['.gradle/\n', '.gradle-local/\n'],
    ['local.properties\n', 'signing.properties\n'],
    ['.idea/workspace.xml\n', '.idea/deviceManager.xml\n.idea/deploymentTargetSelector.xml\n'],
  ];
  for (const [anchor, insertion] of anchorLines) {
    if (!content.includes(insertion.trim())) {
      content = content.replace(anchor, `${anchor}${insertion}`);
    }
  }
  writeText(gitignorePath, content);
  console.log('[release-prep] Restored Android .gitignore entries.');
}

function ensureAndroidSigningExample() {
  const examplePath = resolve('android/signing.properties.example');
  writeText(
    examplePath,
    'storeFile=/Users/wjr/keystores/tadl/android/tadlandroid.keystore\nstorePassword=CHANGE_ME\nkeyAlias=CHANGE_ME\nkeyPassword=CHANGE_ME\n',
  );
  console.log('[release-prep] Restored Android signing.properties.example.');
}

function updateGlobalsVersion(versionName, updateDate, buildNum) {
  const globalsPath = resolve('src/app/globals.ts');
  if (!existsSync(globalsPath)) {
    fail('src/app/globals.ts not found.');
  }

  let globals = readText(globalsPath);
  globals = replaceAll(
    globals,
    /public app_version: string = '[^']*';/,
    `public app_version: string = '${versionName}';`,
    'globals app_version',
  );
  globals = replaceAll(
    globals,
    /public update_version: string = '[^']*';/,
    `public update_version: string = '${updateDate}';`,
    'globals update_version',
  );
  globals = replaceAll(
    globals,
    /public build_num: string = '[^']*';/,
    `public build_num: string = '${buildNum}';`,
    'globals build_num',
  );

  writeText(globalsPath, globals);
  console.log('[release-prep] Patched globals app_version/update_version/build_num.');
}

function readCurrentGlobalsMeta() {
  const globalsPath = resolve('src/app/globals.ts');
  if (!existsSync(globalsPath)) {
    fail('src/app/globals.ts not found.');
  }

  const globals = readText(globalsPath);
  const version = globals.match(/public app_version: string = '([^']*)';/)?.[1] ?? '';
  const updateVersion = globals.match(/public update_version: string = '([^']*)';/)?.[1] ?? '';
  const buildNum = globals.match(/public build_num: string = '([^']*)';/)?.[1] ?? '';

  return { version, updateVersion, buildNum };
}

function defaultUpdateDate() {
  const d = new Date();
  const yyyy = d.getFullYear().toString();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function deriveBuildFromVersion(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec((version ?? '').trim());
  if (!m) {
    fail('Invalid --version format. Expected semantic version like 7.0.35.');
  }

  const major = m[1];
  const minor = m[2].padStart(2, '0');
  const patch = m[3].padStart(2, '0');
  return `${major}${minor}${patch}`;
}

function nextBuildNum(currentUpdateDate, currentBuildNum, targetUpdateDate) {
  if (currentUpdateDate !== targetUpdateDate) return '00';
  const n = Number(currentBuildNum);
  if (!Number.isFinite(n) || n < 0) return '00';
  if (n >= 99) fail('build_num would exceed 99. Pass --build-num explicitly.');
  return String(n + 1).padStart(2, '0');
}

function printSummary(summary) {
  console.log('\n[release-prep] Summary');
  console.log(`[release-prep] App name: ${summary.appName}`);
  console.log(`[release-prep] Platforms: ${summary.platforms.join(', ')}`);
  console.log(`[release-prep] Version: ${summary.version}`);
  console.log(`[release-prep] Build: ${summary.build}`);
  console.log(`[release-prep] Update date: ${summary.updateDate}`);
  console.log(`[release-prep] Daily build number: ${summary.buildNum}`);
  console.log(`[release-prep] Globals updated: app_version=${summary.version}, update_version=${summary.updateDate}, build_num=${summary.buildNum}`);
  console.log(`[release-prep] Web build: ${summary.webBuildRan ? 'ran' : 'skipped'}`);
  console.log(`[release-prep] Platform dirs recreated: ${summary.recreated ? 'yes' : 'no'}`);
  console.log(`[release-prep] Asset generation: ${summary.assetsRan ? 'ran' : 'skipped'}`);
  console.log(`[release-prep] App IDs: ios=${IOS_APP_ID}, android=${ANDROID_APP_ID}`);
  console.log('[release-prep] Done.');
}

function parseArgs(argv) {
  const [platformArg, ...rest] = argv;
  const platform = (platformArg ?? '').toLowerCase().trim();
  if (platform !== 'ios' && platform !== 'android' && platform !== 'both') {
    fail('Usage: node scripts/release-prep.mjs <ios|android|both> --version <x.y.z> [--build <number>] [--recreate] [--skip-build] [--skip-assets]');
  }

  const opts = {
    platform,
    version: '',
    build: '',
    recreate: false,
    skipBuild: false,
    skipAssets: false,
    updateDate: '',
    buildNum: '',
  };

  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--version') {
      opts.version = (rest[i + 1] ?? '').trim();
      i += 1;
    } else if (a === '--build') {
      opts.build = (rest[i + 1] ?? '').trim();
      i += 1;
    } else if (a === '--recreate') {
      opts.recreate = true;
    } else if (a === '--skip-build') {
      opts.skipBuild = true;
    } else if (a === '--skip-assets') {
      opts.skipAssets = true;
    } else if (a === '--update-stamp' || a === '--update-date') {
      opts.updateDate = (rest[i + 1] ?? '').trim();
      i += 1;
    } else if (a === '--build-num') {
      opts.buildNum = (rest[i + 1] ?? '').trim();
      i += 1;
    } else {
      fail(`Unknown argument: ${a}`);
    }
  }

  if (!opts.version) fail('Missing required --version argument (example: --version 7.0.1).');
  if (opts.build && !/^\d+$/.test(opts.build)) fail('Invalid --build argument (must be numeric).');
  if (opts.updateDate && !/^\d{8}(\d{2})?$/.test(opts.updateDate)) {
    fail('Invalid --update-date/--update-stamp format (expected YYYYMMDD or YYYYMMDDNN, e.g. 20260302 or 2026030201).');
  }
  if (opts.buildNum && !/^\d{2}$/.test(opts.buildNum)) {
    fail('Invalid --build-num format (expected two digits, e.g. 00 or 01).');
  }

  return opts;
}

function preparePlatform(platform, opts, appName) {
  const appId = platform === 'ios' ? IOS_APP_ID : ANDROID_APP_ID;
  const env = {
    TADL_TARGET: platform,
    CAP_APP_ID: appId,
  };

  console.log(`[release-prep] Platform: ${platform}`);
  console.log(`[release-prep] App ID: ${appId}`);
  console.log(`[release-prep] App Name: ${appName}`);
  console.log(`[release-prep] Version: ${opts.version}`);
  console.log(`[release-prep] Build: ${opts.build}`);

  const platformDir = resolve(platform);
  const preserved =
    opts.recreate && platform === 'android'
      ? preserveFiles(['android/signing.properties', 'android/google-services.json'])
      : { root: '', files: [] };
  if (opts.recreate && existsSync(platformDir)) {
    console.log(`[release-prep] Removing ./${platform} for clean re-add...`);
    rmSync(platformDir, { recursive: true, force: true });
  }

  if (!existsSync(platformDir)) {
    run('npx', ['cap', 'add', platform], env);
  }

  const restoredLocalFiles = restorePreservedFiles(preserved);
  if (restoredLocalFiles.length) {
    console.log(`[release-prep] Restored local ${platform} files: ${restoredLocalFiles.join(', ')}`);
  }

  run('npx', ['cap', 'sync', platform], env);

  if (platform === 'ios') {
    updateIosProject(opts.version, opts.build, appId);
    ensureIosEntitlements();
    updateIosInfoPlistDisplayName(appName);
    ensureIosGitignore();
  } else {
    updateAndroidGradle(opts.version, opts.build, appId);
    updateAndroidStrings(appName);
    ensureAndroidManifestDeepLinks();
    ensureAndroidStyles();
    ensureAndroidVariables();
    ensureAndroidGitignore();
    ensureAndroidSigningExample();
  }

  if (!opts.skipAssets && existsSync(resolve('resources'))) {
    const ok = runAllowFail('npx', ['capacitor-assets', 'generate', `--${platform}`]);
    if (!ok) {
      fail(
        `Asset generation failed. Install with "npm i -D @capacitor/assets" and rerun (or pass --skip-assets).`,
      );
    }
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const appName = 'TADL';
  const currentGlobals = readCurrentGlobalsMeta();
  const versionWasDerived = !opts.build;
  const updateDateWasDerived = !opts.updateDate;
  const buildNumWasDerived = !opts.buildNum;
  let updateDate = opts.updateDate || defaultUpdateDate();
  let buildNum = opts.buildNum || '';

  if (/^\d{10}$/.test(updateDate)) {
    buildNum = updateDate.slice(-2);
    updateDate = updateDate.slice(0, 8);
  }

  opts.build = opts.build || deriveBuildFromVersion(opts.version);
  buildNum = buildNum || nextBuildNum(currentGlobals.updateVersion, currentGlobals.buildNum, updateDate);

  console.log(`[release-prep] Version: ${opts.version}`);
  console.log(`[release-prep] Build: ${opts.build}`);
  console.log(`[release-prep] Update date: ${updateDate}`);
  console.log(`[release-prep] Daily build number: ${buildNum}`);
  if (versionWasDerived) {
    console.log('[release-prep] Build was derived from the semantic version.');
  }
  if (updateDateWasDerived) {
    console.log('[release-prep] Update date defaulted to today.');
  }
  if (buildNumWasDerived) {
    if (currentGlobals.updateVersion === updateDate) {
      console.log(`[release-prep] Daily build number incremented from existing globals value ${currentGlobals.buildNum}.`);
    } else {
      console.log('[release-prep] Daily build number reset to 00 for a new update date.');
    }
  }

  updateGlobalsVersion(opts.version, updateDate, buildNum);

  const platforms = opts.platform === 'both' ? ['ios', 'android'] : [opts.platform];
  const assetsRan = !opts.skipAssets && existsSync(resolve('resources'));

  if (!opts.skipBuild) {
    run('npm', ['run', 'build']);
  }

  if (opts.platform === 'both') {
    preparePlatform('ios', opts, appName);
    preparePlatform('android', opts, appName);
  } else {
    preparePlatform(opts.platform, opts, appName);
  }

  printSummary({
    appName,
    platforms,
    version: opts.version,
    build: opts.build,
    updateDate,
    buildNum,
    webBuildRan: !opts.skipBuild,
    recreated: opts.recreate,
    assetsRan,
  });
}

main();
