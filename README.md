# TADL Mobile 7.0.4 — Internal Technical Changelog

## Platform / Architecture
- Migrated app behavior to Aspen Discovery-backed APIs (search/account/holds/checkouts/lists/fines flows).
- Continued modernization on Ionic + Angular + Capacitor stack.
- Updated native project metadata and release tooling flow alignment.

## Navigation / IA
- Reworked access patterns to surface account-critical actions directly on Home.
- Preserved global menu consistency while improving back/close behavior patterns.
- Reduced reliance on hidden account-side-menu navigation for core patron tasks.

## Search
- Improved home -> search handoff behavior and advanced-search routing.
- Added ISBN scanner integration via `@capacitor/barcode-scanner`.
- Added MeLCat and Suggest-an-Item actions from search tools.
- Improved enter-key and keyboard-dismiss behavior on native devices.

## Holds
- Standardized user-facing status language and color treatment.
- Added clearer segmentation for Ready-for-Pickup vs not-ready holds.
- Improved post-action local updates to reduce avoidable full refetches.
- Updated item-detail hold placement to use default pickup preference first.
- Added legacy pickup id mapping support (`23 -> 7`, etc.) to bridge old preferences codes to Aspen location ids.

## Checkouts
- Adjusted sorting: overdue first, then due date ascending.
- Improved overdue visual emphasis.
- Standardized row action controls and larger touch targets.

## Fines
- Enabled fines page navigation and list rendering with itemization.
- Corrected total owed calculation behavior when upstream total value is unreliable.
- Added conditional payment CTA and centralized URL configuration.

## Lists
- Added local list-membership index service using `@ionic/storage-angular`.
- Implemented explicit "Sync memberships" flow in My Lists.
- Added top-level My Lists actions (`Sync memberships`, `+ New list`).
- Hooked incremental index updates into add/remove list mutations.
- Item detail now reads membership from local index defensively (no crash if unsynced/missing).

## Item Detail
- Improved digital format availability rendering.
  - Suppresses generic availability lines once provider-level (Hoopla/Libby) statuses/actions are available.
- UI refinements for list-membership block and action controls.

## Events / News
- Event detail now supports room and age-group display logic.
- Excluded all-day placeholder events (`00:00:00` start/end) from list ingestion.
- Improved event/news detail styling and readability.
- Refined external link policy:
  - In-app browser for regular web flows.
  - External launch path for app-interceptable e-resource links.

## Theme / Visual System
- Added 3-way theme preference model:
  - `system`, `light`, `dark`
- Implemented live system-theme following in `system` mode.
- Increased dark-mode muted-text contrast globally.
- Standardized kebab action affordances across holds/checkouts/lists/list-detail/item-detail list rows.

## Native / UX Polish
- Splash screen configuration/assets updated for both platforms.
- Added map/navigation launch support from location details.
- Addressed spacing/alignment/typography consistency issues across pages.
