# Build Prep

This project uses different app IDs per platform:

- iOS: `org.tadl.tadl`
- Android: `org.TADL.TADLMobile`

`capacitor.config.ts` now resolves app IDs from env and defaults to the iOS ID.

## Install toolchain once

```bash
fnm use
npm ci
```

This project expects `@capacitor/assets` for icon/splash generation.

## One-command prep

Use the release prep script to handle:

- web build (`npm run build`)
- app ID selection per platform
- `cap sync` (or optional platform re-create)
- native version/build stamping
- `src/app/globals.ts` stamping:
  - `app_version` = `--version`
  - `update_version` = `YYYYMMDD00` (or `--update-stamp`)
- app icon/splash generation from `resources/`

### iOS

```bash
npm run prep:ios -- --version 7.0.1 --build 70001
```

### Android

```bash
npm run prep:android -- --version 7.0.1 --build 70001
```

## Optional clean re-create

```bash
npm run prep:ios:clean -- --version 7.0.1 --build 70001
npm run prep:android:clean -- --version 7.0.1 --build 70001
```

## Optional flags

- `--skip-build` Reuse web output only after its source, output, and release stamps pass validation
- `--skip-assets` Skip `npx capacitor-assets generate --<platform>`
- `--recreate` Remove and re-add native platform folder
- `--update-stamp <YYYYMMDDNN>` Override `globals.update_version`

## Reusing a verified web build

`npm run build` records its input fingerprint before compilation and writes
`www/build-manifest.json` after a successful build. The manifest includes the
web version, update date, daily build number, source fingerprint, and output
fingerprint. If the inputs or version stamps change during compilation, the
post-build check fails and the assets must be rebuilt. Starting another build
invalidates the previous manifest, including when that new build fails.

For example, prepare iOS normally, then reuse those same web assets for Android:

```bash
npm run prep:ios -- --version 7.0.1
npm run prep:android -- --version 7.0.1 --skip-build
```

With `--skip-build`, the existing web update date and daily build number are
reused. An explicitly supplied version, date, or daily build number must match
the built assets. The guard also detects source/configuration/dependency changes
and modified, added, or removed files in `www`. It rejects missing or invalid
manifests before changing globals, recreating a native platform, or invoking
Capacitor. Rebuild by omitting `--skip-build` when validation fails.

Use `npm run build` so its pre-build and post-build checks run. A direct
`ng build` or watch build does not produce the required manifest. The temporary
build-start snapshot lives under ignored `.angular/`; the output manifest lives
under ignored `www/`.

Run the release-guard regressions with:

```bash
npm run test:release
```

These Node tests use temporary synthetic projects and command stubs. They check
stale sources/output, version mismatches, interrupted builds, and failure before
native changes.

## Open native IDEs

```bash
npx cap open ios
npx cap open android
```

## Android release artifacts

After running `prep:android`, build signed release artifacts from Gradle:

```bash
cd android
./gradlew clean
./gradlew assembleRelease   # APK
./gradlew bundleRelease     # AAB (Play Console)
```

Output paths:

- APK: `android/app/build/outputs/apk/release/app-release.apk`
- AAB: `android/app/build/outputs/bundle/release/app-release.aab`

## iOS archive + export

After running `prep:ios`:

1. Open Xcode:
   - `npx cap open ios`
2. In Xcode select:
   - target: `App`
   - scheme: `App`
   - destination: `Any iOS Device (arm64)` (or generic iOS device)
3. Create archive:
   - `Product` -> `Archive`
4. In Organizer:
   - select the new archive
   - click `Distribute App`
5. Choose distribution:
   - `App Store Connect` for TestFlight/App Store
   - `Ad Hoc` / `Development` for local device distribution
6. Follow signing prompts and export/upload.

## Notes

- iOS native version fields are patched in `ios/App/App.xcodeproj/project.pbxproj`:
  - `MARKETING_VERSION`
  - `CURRENT_PROJECT_VERSION`
  - `PRODUCT_BUNDLE_IDENTIFIER`
- Android native version/app ID fields are patched in `android/app/build.gradle`:
  - `applicationId`
  - `versionCode`
  - `versionName`
