# TADL Mobile

TADL Mobile is the Traverse Area District Library mobile app. It is built with Ionic, Angular, and Capacitor, and it uses Aspen Discovery APIs plus a small set of TADL-managed JSON feeds for content like newsletters, events, locations, and webcams.

This README is meant to reflect the current product behavior and the day-to-day developer workflow.

## Core Features

### Account
- Multi-account sign-in and account switching.
- Home and account summaries for checkouts, holds, ready holds, and fines.
- Library card display.
- Preferences page for both account-level settings and app-level settings.
- Account management flows for logout, saved-account removal, and switching users.

### Search
- Catalog search with advanced search options, Aspen facets, and sorting.
- Native barcode scanning for ISBN lookup in iOS and Android builds.
- Search-result actions via kebab menu:
  - Place hold
  - Add to list
  - View details
- MeLCat handoff and suggestion link actions.

### Item Detail
- Format-level holdings display for physical formats.
- Provider-level availability/actions for digital formats.
- List membership display and list actions.
- Add-to-calendar actions for events surfaced from event detail:
  - Google Calendar handoff
  - `.ics` file generation/share fallback
- Hold management from item detail, including multi-format/multi-hold scenarios.

### Holds / Checkouts / Fines
- Holds list with action menus and state-aware restrictions.
- Checkouts list with overdue prioritization.
- Fines summary.
- Checkout history screen.

### Lists
- Create, edit, and delete lists.
- Add and remove titles from lists from search, featured, and item detail.
- Local list-membership index with explicit sync workflow for fast in-app membership lookups.
- “Add to list” pickers can indicate when an item is already present on a known list.

### Locations
- Branch/member location list and location detail pages.
- Weekly hours plus same-day exception handling.
- Upcoming service exceptions block on location detail pages.
- Home-page service alert card for location changes happening today or tomorrow.
- Navigation, call, and email actions from location detail.
- Location exceptions are interpreted in US Eastern time for app logic.

### Events / Newsletter / Featured / Webcams
- Events feed from `feeds.tools.tadl.org`, including cancelled-event handling.
- Newsletter feed from `https://feeds.tools.tadl.org/newsletter.json`.
- Featured browse categories with tabbed format switching.
- Webcams page backed by `https://feeds.tools.tadl.org/webcams.json`.
  - Webcam links open externally so the YouTube app or the system browser can handle playback.

### Theme and Accessibility
- Theme modes: `System`, `Light`, `Dark`.
- App link mode settings: `Use App` and `Use Browser`.
- Contrast/readability work across muted text, pills, and list-heavy pages.
- Small-screen layout fixes for account and location detail pages.

## Tech Stack

- Angular 20
- Ionic Angular 8
- Capacitor 8
- Angular standalone components
- Aspen Discovery API proxy endpoints for search/account/circulation/lists/item availability
- TADL-managed JSON feeds for content features
- Local persistence:
  - Capacitor Preferences
  - `capacitor-secure-storage-plugin` for credential storage when available
  - `@ionic/storage-angular` for larger local cached/indexed data such as list membership

## API / Feed Integration Notes

- Primary Aspen proxy config lives in [src/app/globals.ts](src/app/globals.ts).
- Common Aspen APIs used:
  - `UserAPI` for profile, holds, checkouts, fines, and preferences
  - `SearchAPI` for catalog search and facets
  - `ItemAPI` for grouped work plus variation/availability details
  - `ListAPI` for list management
  - `CacheWarm` for startup/account warm-up
- Cache warm prefers bundled `POST /API/CacheWarm` and falls back to separate warm calls when needed.
- Feed-backed content currently includes:
  - newsletter feed
  - events feed
  - locations feed/detail
  - webcams feed

## Local Development

### Prerequisites
- Node.js and npm
- Dependencies from `package.json`
- Xcode for iOS work
- Android Studio + Android SDK for Android work

### Install
```bash
npm install
```

### Run in browser
```bash
npm run start
```

Equivalent Ionic CLI option:
```bash
ionic serve
```

### Build web assets
```bash
npm run build
```

### Type-check
```bash
npx tsc -p tsconfig.app.json --noEmit
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

Release prep scripts handle:
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
- Archive in Xcode for TestFlight
- Build Android artifacts in Android Studio or with Gradle for Play distribution

## Known Operational Notes

- Some Angular budget warnings are currently tolerated and are not treated as release blockers by themselves.
- Aspen API behavior can vary by deployment, so the app includes defensive fallbacks around several service calls.
- YouTube embeds are not used for webcam playback inside the app because external playback is more reliable in Capacitor/WebView contexts.

## Project Structure

- `src/app/pages` — top-level screens
- `src/app/components` — reusable UI blocks and modals
- `src/app/services` — API, caching, auth, and domain logic
- `scripts` — release prep automation
- `resources` — source app icons/splash assets
- `ios`, `android` — native Capacitor projects
