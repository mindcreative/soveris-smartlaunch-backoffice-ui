# Current authorization

Private routes wait for `/api/backoffice/auth/current`. Browser storage contains
only tokens; Client role names and stored user data cannot grant permissions.
Legacy stored sessions require login again. The server supplies exact Client
permissions, current Client role ID, original session ID and security revision.

Authority changes cancel private queries and retire rendered rows, unsaved edits,
optimistic state and downloadable object URLs. Explicit authorization failure
shows the safe access state. Dependency failure offers Verify access. Generic
business errors retain unknown-outcome recovery when the verified session remains
valid. A refresh verifies the new projection before replaying a GET; mutations
never replay automatically after401.

Billing controls use explicit permissions. Platform permissions are a separate
server projection; no Client role supplies them. The shipping API keeps platform
operations closed until session assurance is implemented. Story16.2 owns the
separated customer/platform experience;16.7 owns real MFA.

Product-removal recovery material includes the original actor, Client role,
session and revision. During reload it remains unreadable until the server
projection is verified. A different session or revision deletes it. Financial
export bytes belong to the requesting session and remain subject to backend
status/redemption checks.

`e2e/currentSession.ts` supplies mocked current projections for browser transport
regressions. Live specs persist token-only version2 and query the actual endpoint;
they do not mock current authority. Run live specs only through Infrastructure's
supported fixture runners. The default Playwright lane excludes `*-live.spec.ts`;
`playwright.appearance.config.ts` runs the built mocked matrix in light and dark.
