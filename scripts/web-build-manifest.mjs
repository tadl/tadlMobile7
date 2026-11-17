import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const manifestPath = 'www/build-manifest.json';
const buildStartPath = '.angular/web-build-inputs.json';
const webInputs = [
  'src', 'package.json', 'package-lock.json', 'angular.json',
  'tsconfig.json', 'tsconfig.app.json', 'scripts/web-build-manifest.mjs',
];
const optionalWebInputs = ['.browserslistrc', '.node-version'];

function fingerprint(root, paths, excluded = [], optional = []) {
  const hash = createHash('sha256');
  function visit(relative) {
    if (excluded.includes(relative)) return;
    const absolute = join(root, relative);
    const stat = lstatSync(absolute, { throwIfNoEntry: false });
    if (!stat && optional.includes(relative)) {
      hash.update(`missing:${relative}\0`);
      return;
    }
    if (!stat) throw new Error(`Missing build input: ${relative}`);
    if (stat.isSymbolicLink()) throw new Error(`Cannot validate symbolic link: ${relative}`);
    if (stat.isDirectory()) {
      for (const name of readdirSync(absolute).sort()) visit(`${relative}/${name}`);
    } else if (stat.isFile()) {
      const content = readFileSync(absolute);
      hash.update(`${relative.length}:${relative}:${content.length}:`);
      hash.update(content);
    } else {
      throw new Error(`Unsupported build input: ${relative}`);
    }
  }
  for (const path of paths) visit(path);
  return hash.digest('hex');
}

function sourceFingerprint(root) {
  return fingerprint(root, [...webInputs, ...optionalWebInputs], [], optionalWebInputs);
}

export function readWebVersion(root = process.cwd()) {
  const globals = readFileSync(join(root, 'src/app/globals.ts'), 'utf8');
  const values = {};
  for (const [key, field] of [
    ['version', 'app_version'], ['updateDate', 'update_version'], ['buildNum', 'build_num'],
  ]) {
    const value = globals.match(new RegExp(`public ${field}: string = '([^']*)';`))?.[1];
    if (!value) throw new Error(`Missing web version field: ${field}`);
    values[key] = value;
  }
  return values;
}

export function beginWebBuild(root = process.cwd()) {
  // A failed/interrupted build must never leave an older output certified.
  rmSync(join(root, manifestPath), { force: true });
  rmSync(join(root, buildStartPath), { force: true });
  const snapshot = { schema: 1, ...readWebVersion(root), sourceHash: sourceFingerprint(root) };
  mkdirSync(dirname(join(root, buildStartPath)), { recursive: true });
  writeFileSync(join(root, buildStartPath), `${JSON.stringify(snapshot)}\n`);
  return snapshot;
}

export function writeWebBuildManifest(root = process.cwd()) {
  if (!existsSync(join(root, 'www/index.html'))) throw new Error('Web build is missing www/index.html.');
  let snapshot;
  try {
    snapshot = JSON.parse(readFileSync(join(root, buildStartPath), 'utf8'));
  } catch {
    throw new Error('Missing or malformed build-start snapshot. Run npm run build.');
  }
  const version = readWebVersion(root);
  const sourceHash = sourceFingerprint(root);
  if (snapshot?.schema !== 1 || snapshot.sourceHash !== sourceHash ||
      ['version', 'updateDate', 'buildNum'].some(key => snapshot[key] !== version[key])) {
    throw new Error('Web sources or version stamps changed during the build. Run npm run build again.');
  }
  let revision = '';
  try {
    revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    // A source archive can still be checked by its content fingerprints.
  }
  const manifest = {
    schema: 1,
    ...version,
    revision,
    sourceHash,
    outputHash: fingerprint(root, ['www'], [manifestPath]),
  };
  writeFileSync(join(root, manifestPath), `${JSON.stringify(manifest, null, 2)}\n`);
  rmSync(join(root, buildStartPath), { force: true });
  return manifest;
}

export function assertWebBuildCurrent(root = process.cwd(), expected) {
  const rebuild = 'Run release preparation without --skip-build to rebuild the web assets.';
  try {
    const version = expected ?? readWebVersion(root);
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(join(root, manifestPath), 'utf8'));
    } catch {
      throw new Error('Missing or malformed web build manifest.');
    }
    if (manifest?.schema !== 1) throw new Error('Unsupported web build manifest.');
    for (const key of ['version', 'updateDate', 'buildNum']) {
      if (manifest[key] !== version[key]) throw new Error(`Web build ${key} does not match the requested release.`);
    }
    if (manifest.sourceHash !== sourceFingerprint(root)) {
      throw new Error('Web sources have changed since the last build.');
    }
    if (manifest.outputHash !== fingerprint(root, ['www'], [manifestPath])) {
      throw new Error('Web output has changed since the last build.');
    }
    return manifest;
  } catch (error) {
    throw new Error(`${error.message} ${rebuild}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const action = process.argv[2];
    if (action === 'begin') {
      beginWebBuild();
      console.log('[web-build] Recorded build-start source and version fingerprints.');
    } else if (action === 'write') {
      writeWebBuildManifest();
      console.log('[web-build] Recorded matching source, version, and output fingerprints.');
    } else {
      throw new Error('Usage: node scripts/web-build-manifest.mjs <begin|write>');
    }
  } catch (error) {
    console.error(`[web-build] ${error.message}`);
    process.exitCode = 1;
  }
}
