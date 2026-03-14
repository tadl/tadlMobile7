#!/usr/bin/env node
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

  writeText(pbxprojPath, pbx);
  console.log('[release-prep] Patched iOS project version/build/appId.');
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

  writeText(plistPath, plist);
  console.log('[release-prep] Patched iOS display name.');
}

function updateAndroidGradle(versionName, buildNumber, appId) {
  const gradlePath = resolve('android/app/build.gradle');
  if (!existsSync(gradlePath)) {
    console.log('[release-prep] Android project not present yet, skipping build.gradle patch.');
    return;
  }

  let gradle = readText(gradlePath);

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

  writeText(gradlePath, gradle);
  console.log('[release-prep] Patched Android applicationId/versionCode/versionName.');
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
  if (opts.recreate && existsSync(platformDir)) {
    console.log(`[release-prep] Removing ./${platform} for clean re-add...`);
    rmSync(platformDir, { recursive: true, force: true });
  }

  if (!existsSync(platformDir)) {
    run('npx', ['cap', 'add', platform], env);
  }

  run('npx', ['cap', 'sync', platform], env);

  if (platform === 'ios') {
    updateIosProject(opts.version, opts.build, appId);
    updateIosInfoPlistDisplayName(appName);
  } else {
    updateAndroidGradle(opts.version, opts.build, appId);
    updateAndroidStrings(appName);
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
