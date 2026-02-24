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
    } else {
      fail(`Unknown argument: ${a}`);
    }
  }

  if (!opts.version) fail('Missing required --version argument (example: --version 7.0.1).');
  if (!/^\d+$/.test(opts.build)) fail('Missing or invalid --build argument (must be numeric).');

  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const appId = opts.platform === 'ios' ? IOS_APP_ID : ANDROID_APP_ID;

  const env = {
    TADL_TARGET: opts.platform,
    CAP_APP_ID: appId,
  };

  console.log(`[release-prep] Platform: ${opts.platform}`);
  console.log(`[release-prep] App ID: ${appId}`);
  console.log(`[release-prep] Version: ${opts.version}`);
  console.log(`[release-prep] Build: ${opts.build}`);

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
    run('npx', ['capacitor-assets', 'generate', `--${opts.platform}`]);
  }

  console.log('[release-prep] Done.');
}

main();
