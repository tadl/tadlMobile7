# TADL Mobile 7

TADL Mobile is the Traverse Area District Library catalog and account app. It is a standalone Ionic/Angular application backed by Aspen Discovery and TADL-managed content APIs.

## Supported toolchain

- Node.js 24.22.3 LTS (see `.node-version`)
- Angular 22.2
- Ionic 9.0
- Capacitor 8.6
- TypeScript 6.0

Angular 22 requires TypeScript 6.0 and a supported Node.js release; Ionic 9
supports Angular 18–22. The matching Angular ESLint 22 and typescript-eslint 8
packages support TypeScript 6.0. See the [Angular compatibility table](https://angular.dev/reference/versions)
and [Ionic Angular support policy](https://ionicframework.com/docs/angular/overview).

TypeScript stays on 6.0 because Angular 22 requires `<6.1`; the newer TypeScript
7 release is outside that range. ESLint stays on the latest 9.x release because
`eslint-plugin-import` 2.32 supports ESLint through 9. Other direct dependencies
use current compatible releases, with exact resolutions recorded in
`package-lock.json`. Use `npm ci` to reproduce that dependency tree.

Jasmine stays on the latest 6.x release with matching types because
[Jasmine 7 does not support Karma or Zone.js](https://jasmine.github.io/upgrade-guides/7.0#if-you-use-karma-or-zonejs).
The existing Zone/fakeAsync tests remain enabled. `eslint.config.mjs` preserves
the project's Angular and template rule policy, including inline templates.

As of November 17, 2026, `npm audit --omit=dev` reports no vulnerabilities.
The full audit reports 26 high-severity dependency entries stemming from one
[picomatch advisory](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)
in the build, lint, and test toolchain. The advisory covers all published
picomatch versions through the current 4.0.7 release; no patched version is
available. These packages are development dependencies. Recheck for an upstream
fix before the next release; do not apply the audit's suggested Angular/tooling
downgrades or disable audit reporting.

The secure-storage 0.14 update keeps the current storage namespace and changes
handling of undecryptable Android backup values. Before the next native release,
verify saved accounts when upgrading an installed 0.13 build and after Android
backup restoration. See the [plugin's platform notes](https://github.com/martinkasa/capacitor-secure-storage-plugin#platform-specific-information).

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

## Runtime locations

Startup loads the last valid cached configuration, then refreshes public
`GET /API/AppConfig?api=<backend>` in the background. The proxy dashboard's
**Settings → Mobile locations** manages Evergreen/Aspen identifiers,
pickup codes, short names, friendly names, and enabled pickups. Each backend has its own configuration. No patron login is needed.

The app validates the complete response before replacing its current mapping.
Invalid or unavailable responses leave the last valid configuration in use;
`src/app/app-config.defaults.ts` is only the first-launch offline fallback.
Configuration refreshes on startup, resume, browser visibility, and reconnection,
throttled to five minutes after success (30 seconds after failure).

Pickup preferences and hold pickers update from the same runtime registry.
Disabled locations remain available for displaying existing holds/preferences,
but cannot be chosen for new pickups. Search location remains an Aspen search
filter; the app does not expose the helper's default search-location preference.
Saving pickup preferences preserves the existing search preference value.

Deploy the proxy first; released apps keep their existing API behavior. Then
build/test these clients against the public configuration endpoint. Subsequent
location changes in the proxy Settings take effect after a client refresh and
do not require another mobile release. The Evergreen/Aspen location setup itself
is still managed in those systems. Hours/contact data keeps its existing
Locations API source; its database IDs are separate from the registry's IDs.

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
