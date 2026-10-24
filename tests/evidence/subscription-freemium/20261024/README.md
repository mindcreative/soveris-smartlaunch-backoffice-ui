# Subscription freemium validation fix — 2026-10-24

The QA customer's subscriptions response correctly contains no current subscription.
Its capabilities response uses `customer_freemium` and zero for `requests_per_minute`
and `concurrent_ai_operations`, as explicitly permitted by the backend policy
validator. The UI incorrectly required positive values for every limit and mapped
the resulting capability validation error to a subscription-contract message.

The adapter now accepts zero only for those two freemium limits. Other limits
remain positive, and negative or overflowing Int64 values remain invalid. Capability
failures have their own durable error label; private-data eviction and permission
handling remain enforced. Story 18.2 middleware and backend sources were unchanged.

Verification: the initial regression run had **3 failed / 124 passed**; the focused
successor passed **133** tests. The broader billing selection passed **346 tests in
27 files**. `npm run build` passed, retaining existing bundle-size and mixed-import
warnings. A real Chromium login as the seeded QA customer, through the existing
bind-mounted local UI and real API without response mocks, displayed the freemium
policy and **No current subscription**. Both API requests returned 200. No workspace
subscription-creation controls appeared. Initial browser harness attempts used a
127.0.0.1 UI origin rejected by API CORS; the configured localhost origin passed.

## File List

- Runtime: `src/api/billingApi.ts`, `src/pages/billing/BillingSubscriptionPage.tsx`.
- Tests: `src/api/billingApi.test.ts`, `src/pages/billing/BillingSubscriptionPage.test.tsx`.
- Required executable fixture: `src/test/fixtures/customer-freemium-capabilities.json`,
  captured from the local QA capabilities response without authentication tokens.
- Evidence: this README and [external archive descriptor/member index](evidence.tar.gz.external.json).

## Retained evidence

Fetch the archive through Infrastructure's canonical evidence CLI. Every locator
below is an exact member in `evidence.tar.gz`:

- `run/verification-summary.json`: result and failure/successor dispositions.
- `run/red.log`, `run/red-source-identities.json`: initial failures and source identity.
- `run/green.log`, `run/billing-regression.log`, `run/build.log`: passing successors.
- `run/final-identities.json`: final source and generated build asset SHA-256 values.
- `run/source/before/` and `run/source/final/`: exact runtime baseline and final source/test/fixture snapshots.
- `run/capabilities.json`, `run/subscriptions.json`: original real API response bytes.
- `run/browser.log`, `run/browser-diagnostic.log`: original browser harness failures.
- `run/browser-successor.log`, `run/browser-result.json`, `run/subscriptions-fixed.png`: real-browser successor.
- `run/pre-review-inventory.json`, `run/cleanup-plan.json`: eight-repository inventory and cleanup scope.

The archive is stored outside Git with verified primary/GOLD2 copies and actual
backup restoration. Expanded temporary evidence is removed only after matching
every original file to its indexed archived member. Physical repository source
files are **481 → 483**, adding this summary and the descriptor; counts exclude
ignored dependency/build trees and are separate from Git status. No repository
scratch files were created; owned expanded temporary evidence files were **25 → 0**
after archive/member verification. The final inventory found unchanged status and
physical counts in the other seven repositories. Existing unrelated work and uncertain build output
were preserved. This fix makes no production deployment or story-acceptance claim.
