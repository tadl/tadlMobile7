# Aspen 26.08 testing

This branch builds version 7.2.10 against `api=tadl-test` through the normal
TADLAspen proxy. Catalog links and relative covers use
`https://tadl-test.libdiscovery.org`. The production baseline observed on
November 12, 2026 was Aspen 25.05.00; test was 26.08.00.

## Run on an iPhone

```sh
npm run build
npx cap sync ios
npx cap open ios
```

Select your phone in Xcode and run the App scheme. The native bundle ID stays
`org.tadl.tadl`. Test accounts, secure passwords, profiles and cached responses
use separate storage keys, so this build starts with a separate login. Existing
production storage keys are preserved for a subsequent production build.

The six bundled pickup locations are identical to production, intentionally.
`AppConfig?api=tadl-test` returned 503 because no test configuration was
published; the app uses this bundled mapping. A future published test mapping
will replace it through the normal configuration refresh.

## Compatibility findings

The app already accepts both direct API payloads and `result` wrappers for
WorkAPI/ItemAPI. Search, item details, availability, variations and featured
category results succeeded through both backends. Synthetic contract tests
cover these shapes, plain format labels, and old/new hold actions.

First-login history requires a TADLAspen change. Aspen 25.05 imports the ILS
history in the history request. Aspen 26.08 queues it for the native
`loadInitialReadingHistory` cron, scheduled every five minutes by default. Its
initial successful API response can contain no imported history yet. The proxy
must distinguish this from a failed or ambiguous synchronous import and keep
reporting `importing` until Aspen confirms completion. The app now polls for
up to ten minutes while the history view is visible; leaving the view stops
polling, and reopening it or pulling to refresh checks again.

Aspen 26.08 can also synchronize history settings from Evergreen at login when
the home library has both `optInToReadingHistoryUpdatesILS` and
`optOutOfReadingHistoryUpdatesILS` enabled. Check those settings before testing
a patron who has never logged into Aspen. Calling Aspen opt-in when Evergreen
history is already enabled can reset the retention start date to today with
some settings. The proxy compatibility change refuses that automatic opt-in
when the newer API exposes mismatched tracking flags.

Reading lists come from Aspen's `getUserLists`, followed by `getListTitles`.
These API calls do not automatically import classic Evergreen lists on first
login in either baseline. Classic list import is a separate Aspen account
action. The mobile warmup hydrates the lists Aspen returns; it must preserve
existing cached lists when an upstream list response fails or is malformed.
A successful empty list response still clears stale cached lists.

Validation on November 12: 96 browser tests, lint, application/test TypeScript
checks, production web build and `cap sync ios` passed. Read-only checks with
the existing initialized test account passed for login, checkouts, holds,
fines, lists, list titles, coordinated history and the startup bundle. No
circulation/list/preference mutations or native device tests were performed.

Primary source: [26.08 release](https://github.com/Aspen-Discovery/aspen-discovery/releases/tag/26.08.00),
[queued history loading](https://github.com/Aspen-Discovery/aspen-discovery/blob/26.08.00/code/web/CatalogConnection.php),
[native import completion](https://github.com/Aspen-Discovery/aspen-discovery/blob/26.08.00/code/web/cron/loadInitialReadingHistory.php),
[Evergreen history settings](https://github.com/Aspen-Discovery/aspen-discovery/blob/26.08.00/code/web/Drivers/Evergreen.php),
and [list API](https://github.com/Aspen-Discovery/aspen-discovery/blob/26.08.00/code/web/services/API/ListAPI.php).

## Device acceptance

Use an existing Aspen account and a separate account that has Evergreen history
enabled but has never initialized history in Aspen. Signing into the test app
for the first time is distinct from signing into Aspen for the first time.

1. Sign in; verify profile counts, pickup preference and reading-list count.
2. Open each reading list and paginate its titles. Add/remove a synthetic test
   item and create/rename/delete a disposable list; reopen to verify persistence.
3. On the fresh Aspen account, open Checkout History immediately. Expect an
   import message while queued, then existing historical titles after cron
   finishes. It must not report a completed empty history or become permanently
   uncertain just because the first request queued an import.
4. Restart and sign in again. Confirm history remains available without a
   duplicate initial import. Check dates, pagination, covers and item links.
5. With a disposable history account, test opt-out during a queued/running
   import. Confirmation must wait for safe cleanup; deleted titles must not
   reappear. Check an account whose Evergreen history was already disabled too.
6. Exercise search/filter/sort, physical and digital item details, place/cancel
   hold, freeze/activate, pickup changes, checkout renewal and multiple accounts.

## Release handoff

The TADLAspen history compatibility change is a separate server change and must
be deployed before accepting first-login history on 26.08. A commit or push is
not a deployment. The existing initialized test account can validate ordinary
history reads, but cannot prove the fresh-account import path.

Keep the mobile compatibility changes and version commit when preparing the
production submission. Exclude this branch's testing-profile commit: the store
build needs `api=tadl-prod` and `https://discover.tadl.org`, so it works against
25.05 before the Tuesday upgrade and 26.08 afterward. Rebuild and sync iOS after
switching profiles; already-copied native web assets do not change with Git.
