# TADL Mobile

TADL Mobile is the Traverse Area District Library mobile app, built with Ionic + Angular + Capacitor and backed by Aspen Discovery APIs.

This README is focused on product capabilities, app behavior, and developer usage.

## Core Features

### Account
- Multi-account sign-in and account switching.
- Home/account status badges for checkouts, holds, holds ready, and fines.
- Account preferences management.
- Library card display and account actions from the account page.

### Search
- Catalog search with advanced options and Aspen facets/sorting.
- ISBN search support with native barcode scanning in iOS/Android builds.
- Search result actions via kebab menu:
  - Place hold
  - Add to list
  - View details
- MeLCat handoff and suggestion link actions.

### Item Detail
- Format-level holdings display for physical formats.
- Provider-level availability/actions for digital formats.
- List membership display and list actions.
- Hold management from item detail, including multi-format/multi-hold scenarios:
  - Per-format `On Hold` state
  - Manage hold(s) flow for suspend/activate/change pickup/cancel

### Holds / Checkouts / Fines
- Holds list with action menu and state-aware restrictions.
- Checkouts sorted with overdue priority.
- Fines summary.

### Lists
- Create/edit/delete lists.
- Add/remove titles from lists from search and item detail.
- Local list-membership index with explicit sync workflow for fast in-app membership lookups.

### Locations / Events / News / Featured
- Library locations with hours and navigation links.
- Events and news feeds from `feeds.tools.tadl.org`.
- Featured browse categories with tabbed format switching.

### Theme and Accessibility
- Theme modes: `System`, `Light`, `Dark`.
- Improved muted-text contrast in both light and dark themes.
- Touch-target and action affordance improvements across list-heavy pages.

## Tech Stack

- `@ionic/angular` + Angular standalone components
- Capacitor native runtime and plugins
- Aspen Discovery API proxy endpoints (search/account/circulation/lists/item availability)
- Local persistence:
  - Capacitor Preferences
  - secure storage plugin for credentials
  - `@ionic/storage-angular` for larger local index data (list membership)

## API Integration Notes

- Primary proxy base is configured in `src/app/globals.ts` (`aspen_api_base`).
- Common APIs used:
  - `UserAPI` for profile/holds/checkouts/fines/preferences actions
  - `SearchAPI` for catalog search and facets
  - `ItemAPI` for grouped work + variation/availability details
  - `ListAPI` for list management
  - `CacheWarm` for bundled startup/account warm-up
- Cache warm path:
  - Prefers bundled `POST /API/CacheWarm`
  - Falls back to separate profile/lists/preferences warm calls if needed

## Local Development

### Prerequisites
- Node.js (project uses npm + Angular CLI)
- Ionic/Angular toolchain dependencies from `package.json`
- Xcode (for iOS)
- Android Studio + SDK (for Android)

### Install
```bash
npm install
```

### Run in browser
```bash
npm run start
```

Direct Ionic CLI option:
```bash
ionic serve
```

### Build web assets
```bash
npm run build
```

## Native Build / Sync

### Sync web assets to native projects
```bash
npx cap sync
```

Or per platform:
```bash
npx cap sync ios
npx cap sync android
```

### Open native projects
```bash
npx cap open ios
npx cap open android
```

## Release Prep Workflow

Project release prep scripts handle:
- app version metadata updates
- web build
- Capacitor sync
- native metadata patching
- asset generation

Examples:
```bash
npm run prep:ios -- --version 7.0.10 --build 70010 --update-date 20260306 --build-num 00
npm run prep:android -- --version 7.0.10 --build 70010 --update-date 20260306 --build-num 00
```

After prep:
- Build/archive in Xcode for TestFlight
- Build AAB/APK in Android Studio or Gradle for Play beta

## Known Operational Notes

- Some Angular budget warnings are currently tolerated in beta workflows and are non-blocking for build completion.
- Aspen API behavior can vary by deployment; this app includes defensive fallbacks for several endpoints.

## Project Structure (high level)

- `src/app/pages` — top-level screens
- `src/app/components` — reusable UI blocks and modals
- `src/app/services` — API, caching, auth, and domain logic
- `scripts` — release prep automation
- `resources` — source app icons/splash assets
- `ios`, `android` — native Capacitor projects
