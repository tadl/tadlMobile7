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

function defaultUpdateDate() {
  const d = new Date();
  const yyyy = d.getFullYear().toString();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function parseArgs(argv) {
  const [platformArg, ...rest] = argv;
  const platform = (platformArg ?? '').toLowerCase().trim();
  if (platform !== 'ios' && platform !== 'android') {
    fail('Usage: node scripts/release-prep.mjs <ios|android> --version <x.y.z> --build <number> [--recreate] [--skip-build] [--skip-assets]');
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
  if (!/^\d+$/.test(opts.build)) fail('Missing or invalid --build argument (must be numeric).');
  if (opts.updateDate && !/^\d{8}(\d{2})?$/.test(opts.updateDate)) {
    fail('Invalid --update-date/--update-stamp format (expected YYYYMMDD or YYYYMMDDNN, e.g. 20260302 or 2026030201).');
  }
  if (opts.buildNum && !/^\d{2}$/.test(opts.buildNum)) {
    fail('Invalid --build-num format (expected two digits, e.g. 00 or 01).');
  }

  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const appId = opts.platform === 'ios' ? IOS_APP_ID : ANDROID_APP_ID;
  let updateDate = opts.updateDate || defaultUpdateDate();
  let buildNum = opts.buildNum || '00';

  if (/^\d{10}$/.test(updateDate)) {
    buildNum = updateDate.slice(-2);
    updateDate = updateDate.slice(0, 8);
  }

  const env = {
    TADL_TARGET: opts.platform,
    CAP_APP_ID: appId,
  };

  console.log(`[release-prep] Platform: ${opts.platform}`);
  console.log(`[release-prep] App ID: ${appId}`);
  console.log(`[release-prep] Version: ${opts.version}`);
  console.log(`[release-prep] Build: ${opts.build}`);
  console.log(`[release-prep] Update date: ${updateDate}`);
  console.log(`[release-prep] Daily build number: ${buildNum}`);

  updateGlobalsVersion(opts.version, updateDate, buildNum);

  if (!opts.skipBuild) {
    run('npm', ['run', 'build']);
  }

  const platformDir = resolve(opts.platform);
  if (opts.recreate && existsSync(platformDir)) {
    console.log(`[release-prep] Removing ./${opts.platform} for clean re-add...`);
    rmSync(platformDir, { recursive: true, force: true });
  }

  if (!existsSync(platformDir)) {
    run('npx', ['cap', 'add', opts.platform], env);
  }

  run('npx', ['cap', 'sync', opts.platform], env);

  if (opts.platform === 'ios') {
    updateIosProject(opts.version, opts.build, appId);
  } else {
    updateAndroidGradle(opts.version, opts.build, appId);
  }

  if (!opts.skipAssets && existsSync(resolve('resources'))) {
    const ok = runAllowFail('npx', ['capacitor-assets', 'generate', `--${opts.platform}`]);
    if (!ok) {
      fail(
        `Asset generation failed. Install with "npm i -D @capacitor/assets" and rerun (or pass --skip-assets).`,
      );
    }
  }

  console.log('[release-prep] Done.');
}

main();
