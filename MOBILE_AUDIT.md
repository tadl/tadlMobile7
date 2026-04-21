# TADL Mobile 7 - Codebase Audit Report

This audit identifies performance bottlenecks, native bridge inefficiencies, and outdated UI patterns in the `tadlMobile7` codebase, with a focus on Ionic/Capacitor optimization.

## 1. Performance Bottlenecks

### 1.1 Sequential App Bootstrapping
In `src/app/app.component.ts`, the `platform.ready()` block executes several native initialization steps sequentially using `await` within `safeBootStep`.
- **Finding:** `getDeviceInfo`, `initThemePreference`, `initLinkPreference`, and others are awaited one after another.
- **Impact:** Each native bridge call incurs a small overhead. Running them sequentially increases the total time the splash screen is visible.
- **Recommendation:** Use `Promise.all` to parallelize independent boot steps.

### 1.2 Change Detection Inefficiency
Most components, including heavy ones like `SearchPage` and `ItemDetailComponent`, use the default Angular change detection strategy.
- **Finding:** Templates frequently call component methods (e.g., `holdStatusClass()`, `mediaIconName()`, `formatLastCheckOut()`) directly.
- **Impact:** These methods execute on every change detection cycle (e.g., every scroll, touch, or timer event), leading to "jank" on lower-end mobile devices.
- **Recommendation:** Switch to `ChangeDetectionStrategy.OnPush` and use pure pipes or pre-calculated properties for display logic.

### 1.3 Expensive HTML Decoding in Search
The `SearchPage` uses a DOM-based approach to decode HTML labels.
- **Finding:** `decodeLabel(input: any)` in `search.page.ts` creates a `textarea` element on the fly to decode entities.
- **Impact:** Creating DOM elements during result processing is slow, especially when rendering large lists of facets.
- **Recommendation:** Use a regex-based decoder or pre-process labels on the server-side.

---

## 2. Native Bridge Analysis

### 2.1 Sequential Secure Storage Access
The `AccountStoreService` frequently awaits `SecureStoragePlugin` and `Preferences` calls.
- **Finding:** Methods like `normalizeAccounts` perform multiple asynchronous calls in a loop.
- **Impact:** While necessary for security, frequent "chatter" over the native bridge can slow down account switching and initialization.
- **Recommendation:** Batch preference updates where possible and cache more aggressively in memory (already partially implemented in `passwordCache`).

### 2.2 Redundant Network Status Tracking
The `Globals` service (`src/app/globals.ts`) tracks network status using both browser events (`window.online`/`offline`) and the Capacitor `Network` plugin.
- **Finding:** Multiple listeners are attached to the same state.
- **Impact:** Minor overhead, but adds complexity to the state synchronization.
- **Recommendation:** Consolidate into a single `NetworkService` that abstracts the best available method for the platform.

### 2.3 Keyboard Plugin Chatter
In `SearchPage` and `HomePage`, `Keyboard.hide()` is called defensively during navigation.
- **Finding:** Frequent calls to `Keyboard.hide()` even if the keyboard is not visibly open.
- **Impact:** Unnecessary bridge calls.
- **Recommendation:** Check if the keyboard is actually visible before calling `hide()` or rely on Ionic's built-in focus management.

---

## 2.4 Modern Injection Patterns
The codebase relies heavily on constructor-based dependency injection.
- **Finding:** Over 280 instances of constructor injection are triggering linting errors (`@angular-eslint/prefer-inject`).
- **Impact:** While not a performance bottleneck, it indicates an inconsistent adoption of modern Angular patterns (Angular 17+).
- **Recommendation:** Use `ng generate @angular/core:inject` to migrate to the `inject()` function.

---

## 3. UI/UX & Architecture Patterns

### 3.1 "God Object" Service
The `Globals` service (`src/app/globals.ts`) has too many responsibilities.
- **Finding:** It handles theme management, network status, API configuration, navigation helpers, and modal state.
- **Impact:** Difficult to test and maintain; creates tight coupling across the entire app.
- **Recommendation:** Refactor into modular services: `ThemeService`, `NetworkService`, `ConfigService`, and `UiStateService`.

### 3.2 Legacy Component Imports
Despite using Angular 20 and Ionic 8, many components still import the monolithic `IonicModule`.
- **Finding:** `HomePage`, `SearchPage`, and `ItemDetailComponent` import `IonicModule` from `@ionic/angular`.
- **Impact:** Increases bundle size as it prevents effective tree-shaking of unused Ionic components.
- **Recommendation:** Migrate to `@ionic/angular/standalone` and import only the specific Ionic components used in each file.

### 3.3 Imperative Overlay Management
The app heavily uses `ActionSheetController` and `ModalController` to create overlays programmatically.
- **Finding:** Extensive use of `controller.create(...)` followed by `modal.present()`.
- **Impact:** Harder to track overlay state in the Angular component tree; often leads to "modal-on-modal" bugs.
- **Recommendation:** Move to declarative overlays using `<ion-modal [isOpen]="...">` where appropriate.

### 3.4 Manual Splash Screen Management
`AppComponent` contains complex logic to hide the splash screen with hardcoded timeouts (900ms, 3500ms).
- **Finding:** The app manually coordinates `SplashScreen.hide()`.
- **Impact:** This often results in a "white flash" or perceived lag if the first contentful paint doesn't align with the timer.
- **Recommendation:** Use Capacitor's `autoHide: false` and call `hide()` only when the first route has finished rendering.

---

## 4. Summary of Suggested Actions

1.  **Parallelize Boot Steps:** Refactor `AppComponent` startup to use `Promise.all`.
2.  **OnPush Change Detection:** Implement `OnPush` across all pages.
3.  **Standalone Components:** Refactor Ionic imports to use standalone components for better tree-shaking.
4.  **Modularize Globals:** Break down the `Globals` service into focused domain services.
5.  **Migrate Injection Patterns:** Use `inject()` instead of constructor injection to align with modern standards and fix linting issues.
6.  **Optimize Templates:** Replace method calls in templates with pipes or signals to reduce change detection overhead.
