# TADL Mobile 7

TADL Mobile is the Traverse Area District Library catalog and account app. It is a standalone Ionic/Angular application backed by Aspen Discovery and TADL-managed content APIs.

## Supported toolchain

- Node.js 24.15.0 (see `.node-version`)
- Angular 21
- Ionic 9
- Capacitor 8
- TypeScript 5.9

Angular 21 is intentional. Angular 22 requires TypeScript 6, which is not yet supported by the current `typescript-eslint` toolchain.

## Local development

```sh
fnm use
npm install
npm start
```

Useful checks:

```sh
npm run lint
npm run build
npm test -- --watch=false --browsers=ChromeHeadless
```

## Library profile

Library-specific web configuration is centralized in `src/app/app-profile.ts`. It defines:

- app and library identity
- Aspen Discovery host and API selector
- pickup location mappings
- locations API group
- events and newsletter providers
- featured browse categories
- library branding and optional features

The current TADL providers are:

- Aspen API: `https://aspen.tools.tadl.org/API` with `api=tadl-prod`
- Discovery: `https://discover.tadl.org`
- Locations: `https://locations.tools.tadl.org/locations.json?group=tadl`
- Events: TADL mobile events feed
- Newsletter: TADL newsletter feed

The events service also supports The Events Calendar's WordPress REST response, and the newsletter service supports WordPress posts. This is used by the contract-library variants.

## Native projects

`capacitor.config.ts` and the constants at the top of `scripts/release-prep.mjs` hold native identity and app-link settings. Prepare a release with an explicit semantic version:

```sh
npm run prep:ios -- --version 7.2.0
npm run prep:android -- --version 7.2.0
npm run prep:both -- --version 7.2.0
```

Pass `--recreate` to rebuild a platform directory, `--skip-build` to reuse an existing web build, or `--skip-assets` to leave native assets untouched.

Android signing remains local. Use `android/signing.properties` or the documented `TADL_ANDROID_*` environment variables; never commit credentials or keystores.

## Security notes

- Account credentials use the native secure-storage plugin where available.
- Authentication and patron preferences use the existing TADL helper API.
- CMS HTML is sanitized before display.
- `npm audit --omit=dev` should remain clean. Remaining audit advisories, if any, are confined to build and asset-generation tools and must not be force-fixed across framework major versions.
