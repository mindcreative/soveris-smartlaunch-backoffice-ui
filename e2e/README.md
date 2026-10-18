# Browser verification

The default `playwright.config.ts` runs functional tests against Vite's development
server. Report request-isolation checks run here too: each navigation generation
must have one active request per report, and obsolete requests must be cancelled.
Development StrictMode can issue a cancelled predecessor; cumulative request
counts are not the isolation contract. Component tests additionally resolve old
promises despite cancellation to verify the authority fence itself.

Report performance acceptance uses a fresh production build:

```bash
report_results=$(mktemp -d -t billing-reports-results-XXXXXXXX)
npx playwright test --config playwright.reports.config.ts --output "$report_results"
```

This configuration builds current sources, starts a private preview server, and
runs both `billing-reports.spec.ts` and `billing-reports-performance.spec.ts` with
one worker and no retries. The full `playwright.appearance.config.ts` matrix also
includes both files in Light and Dark. The development configuration excludes only
the report performance file, alongside its existing built-only appearance tests;
the functional report suite remains in development coverage.

The unchanged local-feedback budgets are **100 ms p95** for each action and
**500 ms** for labelled pending feedback. Each action has 30 samples. The fixture
retains 367 credit periods and 9,900 traversed expense groups, with at most 100
expense rows rendered. This is built UI with mocked HTTP, not production network
latency or capacity evidence. `responsiveness.json` retains partial/full samples,
budgets, browser/host identity and loaded script paths even when a test fails.
`request-lifetimes.json` records Client/report/generation and cancellation outcomes.

Real HTTP and Domains browser verification belongs to Infrastructure's
`tests/backoffice-live-host-integration.sh`, with `DOMAINS_BROWSER_SMOKE=1` and
`CREDIT_ACTIVITY_HTTP_EVIDENCE_DIR` pointing to an owned temporary evidence folder.
Do not substitute mocked reports for the live fixture lane. Finalize required
evidence through Infrastructure's external evidence policy before removing output.
