import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { assertWebBuildCurrent, beginWebBuild, readWebVersion, writeWebBuildManifest } from './web-build-manifest.mjs';

const scripts = dirname(fileURLToPath(import.meta.url));
const version = { version: '7.0.1', updateDate: '20000101', buildNum: '07' };
const manifestPath = 'www/build-manifest.json';
const snapshotPath = '.angular/web-build-inputs.json';
const nativeFiles = [
  'ios/App/App.xcodeproj/project.pbxproj', 'ios/App/App/Info.plist',
  'android/app/build.gradle', 'android/app/src/main/AndroidManifest.xml',
];

function put(root, path, content) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function fixture(t, { optionalInputs = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'tadl-web-build-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  put(root, 'src/app/globals.ts', `export class Globals {
  public app_version: string = '${version.version}';
  public update_version: string = '${version.updateDate}';
  public build_num: string = '${version.buildNum}';
}\n`);
  put(root, 'src/main.ts', "console.log('Synthetic source');\n");
  put(root, 'package.json', '{"name":"synthetic-release-fixture","private":true}\n');
  for (const file of ['package-lock.json', 'angular.json', 'tsconfig.json', 'tsconfig.app.json']) put(root, file, '{}\n');
  if (optionalInputs) {
    put(root, '.browserslistrc', 'defaults\n');
    put(root, '.node-version', '24.15.0\n');
  }
  for (const file of ['web-build-manifest.mjs', 'release-prep.mjs']) {
    put(root, `scripts/${file}`, readFileSync(join(scripts, file)));
  }
  for (const file of nativeFiles) put(root, file, `Synthetic native sentinel: ${file}\n`);
  put(root, 'capacitor.config.ts', '// Synthetic config sentinel\n');
  // A regression may reach a command, but it must never invoke real native tooling.
  for (const command of ['npx', 'npm']) {
    put(root, `bin/${command}`, '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$RELEASE_TEST_SENTINEL"\nexit 93\n');
    chmodSync(join(root, `bin/${command}`), 0o755);
  }
  return root;
}

function output(root) {
  put(root, 'www/index.html', '<!doctype html><script src="main.js"></script>\n');
  put(root, 'www/main.js', "console.log('Synthetic compiled output');\n");
}

function build(root) {
  beginWebBuild(root);
  output(root);
  return writeWebBuildManifest(root);
}

function nativeSnapshot(root) {
  return Object.fromEntries(['src/app/globals.ts', 'capacitor.config.ts', ...nativeFiles].map(file => [file, readFileSync(join(root, file), 'utf8')]));
}

function prep(root, extra = [], { recreate = true } = {}) {
  return spawnSync(process.execPath, [
    join(root, 'scripts/release-prep.mjs'), 'both', '--version', version.version,
    '--skip-build', '--skip-assets', ...(recreate ? ['--recreate'] : []), ...extra,
  ], {
    cwd: root, encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${join(root, 'bin')}${delimiter}${process.env.PATH ?? ''}`,
      RELEASE_TEST_SENTINEL: join(root, 'native-command-called'),
    },
  });
}

test('records and validates the version, sources, and compiled output', t => {
  const root = fixture(t);
  const manifest = build(root);
  assert.deepEqual(readWebVersion(root), version);
  assert.deepEqual(assertWebBuildCurrent(root), manifest);
  assert.equal(existsSync(join(root, snapshotPath)), false);
  assert.match(manifest.sourceHash, /^[a-f0-9]{64}$/);
  assert.match(manifest.outputHash, /^[a-f0-9]{64}$/);
});

for (const file of ['src/main.ts', 'package.json', 'package-lock.json', 'angular.json', 'tsconfig.json', 'tsconfig.app.json', 'scripts/web-build-manifest.mjs', '.browserslistrc', '.node-version']) {
  test(`rejects changed build input ${file}`, t => {
    const root = fixture(t);
    build(root);
    put(root, file, `${readFileSync(join(root, file), 'utf8')}\n// Synthetic change\n`);
    assert.throws(() => assertWebBuildCurrent(root), /Web sources have changed.*without --skip-build/);
  });
}

test('accepts absent optional inputs and invalidates output when one is added', t => {
  const root = fixture(t, { optionalInputs: false });
  build(root);
  assert.doesNotThrow(() => assertWebBuildCurrent(root));
  put(root, '.browserslistrc', 'defaults\n');
  assert.throws(() => assertWebBuildCurrent(root), /Web sources have changed/);
});

for (const change of ['modify', 'add', 'remove']) {
  test(`rejects an output ${change}`, t => {
    const root = fixture(t);
    build(root);
    if (change === 'modify') put(root, 'www/main.js', '// Changed synthetic output\n');
    if (change === 'add') put(root, 'www/extra.js', '// Unexpected synthetic output\n');
    if (change === 'remove') rmSync(join(root, 'www/main.js'));
    assert.throws(() => assertWebBuildCurrent(root), /Web output has changed/);
  });
}

for (const [field, value] of [['version', '7.0.2'], ['updateDate', '20000102'], ['buildNum', '08']]) {
  test(`rejects a requested ${field} that differs from the built web metadata`, t => {
    const root = fixture(t);
    build(root);
    assert.throws(() => assertWebBuildCurrent(root, { ...version, [field]: value }), new RegExp(`Web build ${field} does not match`));
  });
}

for (const [name, content] of [['missing', null], ['invalid JSON', '{broken'], ['null', 'null'], ['unknown schema', '{"schema":999}']]) {
  test(`rejects a ${name} output manifest with rebuild instructions`, t => {
    const root = fixture(t);
    build(root);
    if (content === null) rmSync(join(root, manifestPath));
    else put(root, manifestPath, content);
    assert.throws(() => assertWebBuildCurrent(root), /web build manifest.*without --skip-build/i);
  });
}

test('invalidates an older manifest before beginning a build', t => {
  const root = fixture(t);
  build(root);
  beginWebBuild(root);
  assert.equal(existsSync(join(root, manifestPath)), false);
  assert.throws(() => assertWebBuildCurrent(root), /Missing or malformed web build manifest/);
});

test('rejects source edits made while compilation was running', t => {
  const root = fixture(t);
  beginWebBuild(root);
  put(root, 'src/main.ts', '// Synthetic edit during build\n');
  output(root);
  assert.throws(() => writeWebBuildManifest(root), /changed during the build/);
  assert.equal(existsSync(join(root, manifestPath)), false);
  assert.throws(() => assertWebBuildCurrent(root), /Missing or malformed web build manifest/);
  build(root);
  assert.doesNotThrow(() => assertWebBuildCurrent(root));
});

test('rejects version edits made while compilation was running', t => {
  const root = fixture(t);
  beginWebBuild(root);
  const globals = readFileSync(join(root, 'src/app/globals.ts'), 'utf8');
  put(root, 'src/app/globals.ts', globals.replace("= '07';", "= '08';"));
  output(root);
  assert.throws(() => writeWebBuildManifest(root), /changed during the build/);
  assert.equal(existsSync(join(root, manifestPath)), false);
});

for (const content of [null, '{broken', '{"schema":999}']) {
  test(`requires a valid prebuild snapshot (${content ?? 'missing'})`, t => {
    const root = fixture(t);
    output(root);
    if (content !== null) put(root, snapshotPath, content);
    assert.throws(() => writeWebBuildManifest(root), /snapshot|changed during the build/);
    assert.equal(existsSync(join(root, manifestPath)), false);
  });
}

test('cannot certify a build without its index', t => {
  const root = fixture(t);
  beginWebBuild(root);
  assert.throws(() => writeWebBuildManifest(root), /missing www\/index.html/);
});

test('rejects source symlinks instead of following untracked build inputs', t => {
  const root = fixture(t);
  put(root, 'outside.ts', '// Synthetic source outside the input tree\n');
  symlinkSync(join(root, 'outside.ts'), join(root, 'src/linked.ts'));
  assert.throws(() => beginWebBuild(root), /Cannot validate symbolic link: src\/linked.ts/);
});

const earlyFailures = [
  ['missing manifest', root => rmSync(join(root, manifestPath)), []],
  ['malformed manifest', root => put(root, manifestPath, '{broken'), []],
  ['changed source', root => put(root, 'src/main.ts', '// Synthetic stale source\n'), []],
  ['changed output', root => put(root, 'www/main.js', '// Synthetic stale output\n'), []],
  ['different version', () => {}, ['--version', '7.0.2']],
  ['different date', () => {}, ['--update-date', '20000102']],
  ['different daily build', () => {}, ['--build-num', '08']],
];
for (const [name, change, args] of earlyFailures) {
  test(`release preparation rejects ${name} before source/native writes or commands`, t => {
    const root = fixture(t);
    build(root);
    change(root);
    const before = nativeSnapshot(root);
    const result = prep(root, args);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /without --skip-build/);
    assert.equal(existsSync(join(root, 'native-command-called')), false);
    assert.equal(existsSync(join(root, '.release-prep-preserve')), false);
    assert.deepEqual(nativeSnapshot(root), before);
  });
}

test('skip-build reuses old web stamps without incrementing or defaulting the date to today', t => {
  const root = fixture(t);
  build(root);
  const before = nativeSnapshot(root);
  const result = prep(root, [], { recreate: false });
  // The guard accepts the fixture, then the fake npx deliberately stops the run.
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Update date: 20000101/);
  assert.match(result.stdout, /Daily build number: 07/);
  assert.match(result.stdout, /Reusing verified web assets/);
  assert.doesNotMatch(result.stdout, /defaulted to today|incremented|Patched globals/);
  assert.equal(readFileSync(join(root, 'native-command-called'), 'utf8'), 'cap sync ios\n');
  assert.deepEqual(nativeSnapshot(root), before);
});

test('skip-build accepts an explicit matching ten-digit stamp', t => {
  const root = fixture(t);
  build(root);
  const result = prep(root, ['--update-stamp', '2000010107'], { recreate: false });
  assert.match(result.stdout, /Reusing verified web assets/);
  assert.equal(readFileSync(join(root, 'native-command-called'), 'utf8'), 'cap sync ios\n');
});
