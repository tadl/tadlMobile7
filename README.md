# TADL Mobile

TADL Mobile is the Traverse Area District Library mobile app. It is built with Ionic, Angular, and Capacitor and uses Aspen Discovery proxy APIs plus a small set of TADL-managed JSON feeds for content such as events, newsletters, locations, and webcams.

This README is intended to reflect the current product behavior, project structure, and release workflow as accurately as possible.

## Product Overview

The app provides:

- Patron account access for one or more saved library accounts
- Catalog search and item detail
- Holds, checkouts, fines, and checkout history
- User-created lists
- Branch and member-library locations with service exceptions
- Events, newsletter, featured items, and webcams
- App-level preferences for theme and link-routing behavior

The app is designed to work primarily against TADL’s Aspen Discovery installation and related proxy endpoints:

- Discovery web host: `https://discover.tadl.org`
- Aspen API proxy host: `https://aspen.tools.tadl.org/API`
- Location data host: `https://locations.tools.tadl.org`
- Feed host: `https://feeds.tools.tadl.org`

Primary runtime configuration lives in [src/app/globals.ts](./src/app/globals.ts).

## Feature Inventory

### App Shell and Navigation

- Standalone Angular routing with lazy-loaded pages
- Split-pane layout with left-side menu on larger screens
- Top-level menu entries for:
  - Home
  - Account
  - Search
  - Locations
  - Events
  - Newsletter
  - Featured Items
  - Webcams
  - About
- Global progress bar driven by the HTTP loading interceptor
- Native splash screen held until first navigation is ready
- App-link handling for `discover.tadl.org` URLs

### Home

- Account welcome / summary block
- Search entry point
- Service alert card when one or more locations have service exceptions today or tomorrow
- Direct navigation into account-related pages

### Account and Saved Accounts

- Username/password sign-in
- Saved-account restore on app launch
- Multiple saved accounts
- Switch-user flow
- Logout and remove-saved-account flow
- Library card modal
- Links into:
  - Checkouts
  - Holds
  - Fines
  - My Lists
  - Checkout History
  - Preferences

### Preferences

- App preferences:
  - Link mode: `Use App` or `Use Browser`
  - Theme: `System`, `Light`, or `Dark`
- Circulation preferences:
  - Pickup library
  - Default search location
  - Keep circulation history
- User preferences:
  - Username
  - Holdshelf alias
  - Email
  - Password
- Notification preferences:
  - Phone notify number
  - Text notify number
  - Email notify toggle
  - Phone notify toggle
  - Text notify toggle

### Search

- Keyword search and advanced search
- Search facets and filters
- Sort options
- Infinite scroll paging
- Native barcode scanning for ISBN search on iOS and Android builds
- Search result actions via kebab menu:
  - Place hold
  - Add to list
  - View details
- MeLCat suggestion / handoff links
- Search resets correctly when barcode scanning is canceled

### Item Detail

- Grouped-work detail modal
- Title, author, language, description, and cover display
- Physical format and copy availability display
- Digital provider availability display
- Consistent copy-count display for both physical and digital sections
- Add to list
- Hold placement
- Hold management for currently held formats:
  - Suspend
  - Activate
  - Change pickup location
  - Cancel
- Optimistic hold updates followed by fresh-hold refresh
- Copy-details popover for physical holdings

### Holds

- Active ILS holds list
- Separation of:
  - Ready for pickup
  - Not ready
- State-aware status labels and pickup deadline text
- Hold action menu:
  - Suspend / Activate
  - Change pickup location
  - Cancel
  - View details
- MeLCat manager handoff for MeLCat-style items

### Checkouts

- Active checkouts list
- Renew single item
- Renew all eligible items
- Renewability display and renewal counts
- Overdue / due-date handling
- MeLCat manager handoff for MeLCat-style items

### Checkout History

- Paginated reading history
- Duplicate-history collapse for cleaner display
- Current-checkout filtering
- Open title in item detail where possible
- Transient Aspen auth-glitch retry handling

### My Lists

- View user lists
- Create list
- Edit list
- Delete list
- Open list detail
- Per-title actions inside list detail:
  - Place hold
  - Remove from list
  - View details
- List membership awareness in add-to-list pickers
- “Already added” markers when local membership data says an item is already on a list

### Locations

- Feed-backed locations list
- Location detail modal
- Address, phone, email, and navigation actions
- Weekly schedule display
- Same-day service exception handling
- Upcoming service exceptions block
- Service exception reasoning and hours display
- US Eastern time interpretation for date-only location exceptions
- Home-page service alert integration

Important behavior:

- Date-only closures and exceptions are treated as Eastern-time calendar-day events
- If times are omitted for a closure, the app treats the closure as midnight-to-midnight for that date

### Events

- Feed-backed events list
- Venue/location filtering
- Event detail modal
- Cancellation display
- Registration / external links
- Add to calendar:
  - Native calendar prompt flow
  - Google Calendar handoff
  - `.ics` generation and download/share fallback

### Newsletter

- Feed-backed newsletter list from `https://feeds.tools.tadl.org/newsletter.json`
- Summary list view
- HTML detail rendering
- Internal-body link routing for supported TADL/discovery links
- Fallback hero image handling when newsletter HTML does not include an image

### Featured Items

- Tabbed featured sections
- Feed/API-backed category list
- Category detail pages
- Shared item actions consistent with Search

### Webcams

- Feed-backed webcam list from `https://feeds.tools.tadl.org/webcams.json`
- External open behavior for webcam links
- YouTube app / system browser handoff instead of in-app embed playback

### About

- App version
- Update version
- Build number
- Screen classification
- Storage driver
- Theme
- Link mode
- Credential storage type
- Platform list
- Network status / type
- Device information:
  - Device name
  - Virtual flag
  - Manufacturer
  - Model
  - OS / OS version
  - WebView version

## Technical Stack

- Angular 20
- Ionic Angular 8
- Capacitor 8
- Angular standalone components and standalone routing
- RxJS 7
- SCSS

Main package definitions live in [package.json](./package.json).

## Native / Capacitor Plugins in Use

- `@capacitor/app`
- `@capacitor/app-launcher`
- `@capacitor/barcode-scanner`
- `@capacitor/browser`
- `@capacitor/device`
- `@capacitor/haptics`
- `@capacitor/keyboard`
- `@capacitor/network`
- `@capacitor/preferences`
- `@capacitor/splash-screen`
- `@capacitor/status-bar`
- `@ebarooni/capacitor-calendar`
- `capacitor-secure-storage-plugin`

## Data Sources and Services

### Aspen / Proxy APIs

The app talks to proxy endpoints rather than directly to the ILS.

Common API families include:

- `UserAPI`
  - profile counts
  - holds
  - checkouts
  - fines
  - checkout history
  - preference updates
  - hold placement / hold mutation
- `SearchAPI`
  - search
  - facets
  - result paging
- `ItemAPI`
  - grouped work detail
  - variation / format / action detail
- `ListAPI`
  - list CRUD
  - list-title membership
- `CacheWarm`
  - bundled account warm-up payload

### Feed-Backed Content

Current feed-backed content includes:

- newsletter feed
- events feed
- locations feed
- webcams feed

### Important Services

- [src/app/services/auth.service.ts](./src/app/services/auth.service.ts)
  - auth state, saved-account restore, active-account state
- [src/app/services/account-store.service.ts](./src/app/services/account-store.service.ts)
  - saved account metadata and password handling
- [src/app/services/cache-warm.service.ts](./src/app/services/cache-warm.service.ts)
  - startup/resume warm-up for profile, lists, preferences, and locations
- [src/app/services/holds.service.ts](./src/app/services/holds.service.ts)
  - holds fetch and mutation logic
- [src/app/services/hold-support.service.ts](./src/app/services/hold-support.service.ts)
  - shared hold-target resolution and optimistic hold cache helpers
- [src/app/services/locations.service.ts](./src/app/services/locations.service.ts)
  - cached + live location loading
- [src/app/services/discovery-link-router.service.ts](./src/app/services/discovery-link-router.service.ts)
  - app/browser routing for supported discovery links
- [src/app/services/loading.interceptor.ts](./src/app/services/loading.interceptor.ts)
  - global loading bar integration and default request timeout
- [src/app/services/toast.service.ts](./src/app/services/toast.service.ts)
  - shared toast behavior, including hold-success “Manage” actions

## Caching and Local State

The app uses multiple layers of local state:

- Capacitor Preferences
  - theme mode
  - link mode
  - lightweight cached values
- secure credential storage when available
- Ionic Storage / local app storage
  - user lists
  - membership data
  - preferences
  - holds cache
  - locations cache
  - other service payload caches
- in-memory snapshots
  - used for faster initial rendering on some pages such as locations

Important behavior:

- cache warm runs on auth changes and on app resume, with throttling
- many pages render cached data first, then refresh from network
- hold placement uses optimistic cache updates and then refreshes from fresh hold data
- HTTP requests now have a default timeout so stalled requests fail instead of spinning forever

## Deep Links and External Open Behavior

The app supports link-mode preferences:

- `Use App`
  - supported `discover.tadl.org` links are routed into the app
- `Use Browser`
  - those links stay external

Native release prep also restores:

- iOS associated-domain entitlements for `discover.tadl.org`
- Android app-link intent filters for discovery URLs

Webcams intentionally open externally because in-app YouTube embed playback is less reliable in Capacitor WebViews.

## Development

### Prerequisites

- Node.js compatible with the repo’s Angular / Capacitor toolchain
- npm
- Xcode for iOS builds
- Android Studio and Android SDK for Android builds

Optional but commonly useful:

- Ionic CLI
- Java / Gradle tooling for local Android command-line builds

### Install Dependencies

```bash
npm install
```

### Start Local Development Server

```bash
npm run start
```

Equivalent:

```bash
ionic serve
```

### Build Web Assets

```bash
npm run build
```

### Watch Build

```bash
npm run watch
```

### Type Check

```bash
npx tsc -p tsconfig.app.json --noEmit
```

### Lint

```bash
npm run lint
```

### Unit Tests

```bash
npm test
```

## Native Development

### Capacitor Sync

Sync built web assets into native projects:

```bash
npx cap sync
```

Or per platform:

```bash
npx cap sync ios
npx cap sync android
```

### Open Native Projects

```bash
npx cap open ios
npx cap open android
```

### Capacitor Config

Capacitor configuration lives in [capacitor.config.ts](./capacitor.config.ts).

Notable behaviors:

- iOS and Android use different app IDs
- splash screen is configured for manual hide after first navigation
- `webDir` is `www`

## Release Prep Workflow

Release prep is handled by [scripts/release-prep.mjs](./scripts/release-prep.mjs).

Available scripts:

```bash
npm run prep:ios -- --version 7.0.10
npm run prep:android -- --version 7.0.10
npm run prep:both -- --version 7.0.10
```

Clean/recreate variants:

```bash
npm run prep:ios:clean -- --version 7.0.10
npm run prep:android:clean -- --version 7.0.10
npm run prep:both:clean -- --version 7.0.10
```

Optional release-prep flags still exist for override cases such as custom build numbers, skipping the web build, or recreating native projects, but the normal workflow only requires `--version`.

The release prep script handles platform-specific release tasks such as:

- app version/build metadata updates
- Angular production build
- Capacitor sync
- iOS project patching
  - bundle identifier
  - marketing version
  - build number
  - entitlements restoration
  - display name patching
  - camera / calendar usage strings
- Android project patching
  - application ID
  - version name / version code
  - release signing config scaffolding
  - app-link manifest restoration
  - display-name / resource updates
- preservation/restoration of specific generated files during recreation flows

After prep:

- use Xcode to archive and upload to TestFlight
- use Android Studio or Gradle to create Play-distribution artifacts

## Build Warnings and Operational Notes

Current expected behavior:

- production build succeeds with warnings
- Angular budget warnings are currently tolerated
- the Stencil empty-glob warning is currently tolerated

Important operational notes:

- Aspen responses can be inconsistent or occasionally flaky, so the app contains defensive retries and fallbacks in several flows
- some pages intentionally hydrate from cache before network refresh
- webcam playback uses external open behavior by design
- location service exceptions are interpreted in `America/New_York`

## Project Structure

- `src/app/app.component.*`
  - application shell and left-side menu
- `src/app/app.routes.ts`
  - route table
- `src/app/globals.ts`
  - runtime configuration, shared helpers, URLs, pickup locations, theme/link settings
- `src/app/pages`
  - top-level screens
- `src/app/components`
  - reusable UI blocks and modal/detail components
- `src/app/services`
  - domain logic, API wrappers, caching, auth, link routing, and helper services
- `src/assets`
  - static app assets
- `src/theme`
  - Ionic theme variables
- `scripts`
  - release prep automation
- `resources`
  - source icons and splash assets
- `ios`
  - native iOS Capacitor project
- `android`
  - native Android Capacitor project
- `www`
  - Angular production build output

## Route Map

Current top-level routes include:

- `/home`
- `/account`
- `/search`
- `/item/:id`
- `/events`
- `/news`
- `/locations`
- `/featured`
- `/featured/:id`
- `/webcams`
- `/about`
- `/holds`
- `/checkouts`
- `/fines`
- `/checkout-history`
- `/account-preferences`
- `/my-lists`
- `/my-lists/:id`

Route definitions live in [src/app/app.routes.ts](./src/app/app.routes.ts).
