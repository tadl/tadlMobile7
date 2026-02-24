# Build Prep

This project uses different app IDs per platform:

- iOS: `org.tadl.tadl`
- Android: `org.TADL.TADLMobile`

`capacitor.config.ts` now resolves app IDs from env and defaults to the iOS ID.

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

- `--skip-build` Skip `npm run build`
- `--skip-assets` Skip `npx capacitor-assets generate --<platform>`
- `--recreate` Remove and re-add native platform folder
- `--update-stamp <YYYYMMDDNN>` Override `globals.update_version`

## Open native IDEs

```bash
npx cap open ios
npx cap open android
```

## Notes

- iOS native version fields are patched in `ios/App/App.xcodeproj/project.pbxproj`:
  - `MARKETING_VERSION`
  - `CURRENT_PROJECT_VERSION`
  - `PRODUCT_BUNDLE_IDENTIFIER`
- Android native version/app ID fields are patched in `android/app/build.gradle`:
  - `applicationId`
  - `versionCode`
  - `versionName`
