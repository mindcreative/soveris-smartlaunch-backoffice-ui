---
title: "Back-Office UX Specification \u2014 Products & Domains Expansion"
status: draft
updated: "2026-09-10"
created: "2026-09-07"
version: "1.0.0"
---

# Back-Office UX Specification \u2014 Products & Domains Expansion

## Foundation

### Form-Factor

- **Primary surface**: Desktop web (1280px+ viewport)
- **Responsive**: Desktop remains primary; critical flows work at 320 CSS px, 400% zoom, 200% text zoom and with a virtual keyboard under UX-AIB-BASE
- **UI system**: React + TypeScript + Tailwind CSS + React Router DOM + TanStack Query
- **Visual identity reference**: `DESIGN.md`

### Existing Patterns to Follow

| Pattern | Source | Description |
|---------|--------|-------------|
| Centered modal dialogs | `src/components/shared/Modal.tsx` | Portal-based, accessible, keyboard-navigable, size variants (sm/md/lg/xl) |
| Data tables | `src/components/shared/DataTable.tsx` | Column-based rendering, sortable columns |
| Badges | `src/components/shared/Badge.tsx` | Status indicators with color variants |
| Empty states | `src/components/shared/EmptyState.tsx` | Icon + title + description for empty lists |
| Error displays | `src/components/shared/ErrorDisplay.tsx` | Error message with retry action |
| Loading spinners | `src/components/shared/LoadingSpinner.tsx` | Size variants with optional message |
| Permissions gating | `src/auth/permissions.ts` | `ROLE_PERMISSIONS` record, `hasPermission()` hook |
| Sidebar navigation | `src/components/layout/Sidebar.tsx` | Icon-based nav with active state highlighting |
| Query hooks | `src/hooks/useQueryHooks.ts` | TanStack Query wrapper for API calls |

### DESIGN.md Relationship

`DESIGN.md` (in this directory) owns **how things look**: colors, typography, spacing, component visual specs. This document owns **how things work**: information architecture, behavior, states, interactions, accessibility, user journeys. DESIGN.md owns visual choices; this document owns behavior. The approved OQ-001–004 resolution and normative UX-AIB-BASE accessibility/private-state contract govern both; see cross-references below.

---

## Information Architecture

### Navigation Structure

```
Back-Office Navigation (Sidebar)
\u2261 Dashboard
\u2261 Submissions
\u2261 Analytics
\u2261 Billing
\u2261 Products          <- NEW
\u2261 Domains           <- NEW
\u2261 Themes            (placeholder)
\u2261 AI Tools          (placeholder, permission-gated)
\u2261 Users
\u2261 Audit Logs       (Admin only, permission-gated)
```

**Changes from current state:**
- **REMOVED**: "Content" page (decommissioned \u2014 its functionality moves to Products)
- **ADDED**: "Products" \u2014 dedicated product management
- **ADDED**: "Domains" \u2014 dedicated domain configuration

### Page Hierarchy

```
Products (top-level)
\u251c\u2500\u2500 Product List (default view)
\u2502   \u251c\u2500\u2500 Create Product (modal)
\u2502   \u2514\u2500\u2500 Edit Product (modal)
\u2502       \u251c\u2500\u2500 General Settings
\u2502       \u251c\u2500\u2500 Hero Content
\u2502       \u251c\u2500\u2500 Features (optional)
\u2502       \u251c\u2500\u2500 FAQ (optional)
\u2502       \u251c\u2500\u2500 Form
\u2502       \u251c\u2500\u2500 Footer
\u2502       \u2514\u2500\u2500 SEO
\u2514\u2500\u2500 Delete Product (confirmation modal)

Domains (top-level)
\u251c\u2500\u2500 Domain List
\u2502   \u251c\u2500\u2500 Add Domain (modal)
\u2502   \u2514\u2500\u2500 Domain Detail
\u2502       \u251c\u2500\u2500 Domain Configuration
\u2502       \u251c\u2500\u2500 Verification Status
\u2502       \u2514\u2500\u2500 Product Bindings
\u2514\u2500\u2500 Remove Domain (confirmation modal)
```

### Routing

| Route | Component | Access |
|-------|-----------|--------|
| `/products` | `ProductsPage` | `products:view` |
| `/domains` | `DomainsPage` | `domains:view` |

---

## Voice and Tone

### Principles

- **Direct and actionable**: Every label, button, and message tells the user what to do or what happened.
- **Confident but not arrogant**: The system guides users without condescension.
- **Consistent terminology**: "Product" not "listing" or "item". "Active/Archived" names lifecycle; "Draft/Published" names publication. Do not conflate them or call archived content deleted.

### Microcopy Guidelines

| Context | Pattern | Example |
|---------|---------|---------|
| Buttons | Verb + object | "Save Changes", "Delete Product", "Verify Domain" |
| Status badges | Adjective | "Active", "Archived", "Pending Verification", "Expired" |
| Empty states | Title + helpful description | "No products yet" \u2192 "Create your first product to get started." |
| Errors | Clear cause + action | "Failed to save product. Please check your input and try again." |
| Confirmations | Question format | "Are you sure you want to delete this product?" |
| AI features | Benefit-oriented | "Generate with AI" (not "Run AI inference") |

---

## Component Patterns

### Product List Table

**Location**: `src/pages/products/ProductsPage.tsx`

**Columns** (left to right):

| Column | Width | Sortable | Render |
|--------|-------|----------|--------|
| Name | Auto | Yes | Clickable text \u2192 opens Edit modal |
| Slug | Fixed (120px) | Yes | Monospace text |
| Status | Fixed (90px) | No | Badge: green "Active" / gray "Archived" |
| Content Status | Fixed (110px) | No | Complete/Incomplete from publication rules; separate Draft/Published label and draft/live revisions |
| Images | Fixed (70px) | No | Number with image icon |
| Domain | Auto | No | Server-computed eligible canonical URL or "URL not yet available" |
| Updated | Fixed (120px) | Yes | Relative date or "\u2014" |
| Actions | Fixed (50px) | No | Red X icon button (delete) |

**Behavior**:
- Clicking a product name opens the Edit Product modal (see Edit Modal section)
- Clicking the delete icon shows a confirmation modal
- "Create Product" button in page header opens the Create modal

**Content Status Logic**:
- Complete/Incomplete is server-derived publication completeness, independent of active/archived and draft/published. The accepted INPUT-05 v1 contract requires Hero and a supported non-empty Form with exactly one required Email-profile field; its property name is configurable. Footer remains optional.
- Renderer-required Hero fields must be valid; optional Features/FAQ absence never means Incomplete.

### Create Product Modal

**Pattern**: Minimal create (name + slug only), then full Edit modal opens.

**Fields**:
1. **Name** (text input, required) \u2014 placeholder: "My Product"
2. **Slug** (text input, required) \u2014 placeholder: "my-product" \u2014 with auto-generate from name button
3. **Submit button**: "Create & Edit"

**Behavior**:
1. User fills name and slug, clicks "Create & Edit"
2. Product is created as an unpublished draft via authorized scoped API; active-product quota is checked atomically
3. On successful creation, Edit Product modal opens immediately with the new product pre-loaded
4. User can then fill in content sections

**Validation**:
- Name: non-empty, max 128 characters
- Slug: valid URL slug format (lowercase, hyphens, alphanumeric), unique per client

### Edit Product Modal

**Pattern**: Centered modal, single scrollable view, sections separated by headings.

**Size**: `xl` (max-w-xl base), with `max-h-[90vh]` and internal scrolling per section.

**Structure** (top to bottom):

```
+----------------------------------------------------------------------+
|  Edit Product: [Product Name]                                    [x] |
+----------------------------------------------------------------------+
| [General Settings]                                                   |
|   Name *          [___________________]                              |
|   Slug *          [_____________] [refresh]                          |
|   Status          [v Active        ]                                 |
|   Theme           [___________________]                              |
|                                        [Generate with AI]            |
| [Hero Content]                                                       |
|   Title *         [___________________]                              |
|   Subtitle *      [___________________]                              |
|   Trust text      [___________________]                              |
|   CTA Text *      [___________________]                              |
|   CTA Link *      [___________________]                              |
|   Image           [Upload area]                                      |
|                    Min: 1200x630px, Max: 2MB                         |
|                                        [Generate with AI]            |
| [Features (optional)]                                                |
|   [+ Add Feature]                                                    |
|   Feature 1:                                                         |
|     Title       [___________________]                                |
|     Description [___________________]                                |
|     Image/alt   [___________________]                                |
|                                        [Generate with AI]            |
| [FAQ (optional)]                                                     |
|   [+ Add Question]                                                   |
|   Q: What is your product?                                           |
|   A: [___________________]                                           |
|                                        [Generate with AI]            |
| [Form]                                                               |
|   [Supported form profile - INPUT-05]                                       |
|                                        [Generate with AI]            |
| [Footer]                                                             |
|   [+ Add Section]                                                    |
|   Section: Product                                                   |
|     Links:                                                           |
|     - Features  [/features] [-]                                      |
|     - Pricing   [/pricing]  [-]                                      |
|                                        [Generate with AI]            |
| [SEO]                                                                |
|   Meta Title      [___________________]                              |
|   Meta Description [_________________]                              |
|                                        [Generate with AI]            |
+----------------------------------------------------------------------+
|                                              [Cancel]    [Save draft] [Publish]| 
+----------------------------------------------------------------------+
```

**Section Details**:

#### General Settings
- **Name** (text, required, max 128 chars)
- **Slug** (text, required, URL-slug format, unique per client)
- **Status** (select: Active / Archived)
- **Theme** (text, placeholder \u2014 future implementation)
- **AI Generate button** below section (server-selected capability, permission, limits and credit reasons; internal is not a subscription tier)

#### Hero Content
- **Title** (text, required)
- **Subtitle** (text, required for publication)
- Preserve canonical hero trustText/secondaryCta where present; do not add an unrenderable generic description field.
- **CTA Text** (text, required for publication)
- **CTA Link** (text, required safe URL for publication)
- **Image source and alt text** (required for publication); upload is a separate baseline asset flow (see Image Upload section)
- **Image guidelines**: "Min: 1200x630px (1.91:1 ratio), Max: 2MB"
- **AI Generate button** below section

#### Features (optional)
- **Add Feature** button to add new feature item
- Each feature preserves renderer-compatible title, description and optional image metadata; no dropped images on no-op edit
- **AI Generate button** below section

#### FAQ (optional)
- **Add Question** button to add new FAQ item
- Each FAQ has: Question (text), Answer (textarea)
- **AI Generate button** below section

#### Form
- Use the accepted INPUT-05 custom supported-profile editor only: text/email, textarea, select/radio string enums and checkbox string arrays. Do not imply support for unrestricted nested JSON Schema or silently fall back for unsupported vocabulary.
- Renders form schema fields: name, type, label, required, options
- **AI Generate button** below section

#### Footer
- **Add Section** button to add new footer section
- Each section has: Heading (text), Links (dynamic list of name + href)
- Footer is optional. When absent, the product renderer must not synthesize product links; separately configured platform/legal chrome remains outside canonical product content.
- **AI Generate button** below section

#### SEO
- **Meta Title** (text, max 60 chars recommended)
- **Meta Description** (textarea, max 160 chars recommended)
- Optional SEO fields follow canonical schema and both renderer consumers; no extra keyword property before its contract is supported.
- **AI Generate button** below section

**Save Behavior**:
- Save draft validates safe field types, URLs, byte/depth limits and ownership; incomplete publication fields produce warnings.
- Publish/Update published validates strict complete canonical content, checking expected draft and live revisions atomically. A failed publish leaves live content unchanged.
- Show current live and draft revisions and separate lifecycle/publication/completeness. No automatic publishing or autosave.
- 400 malformed, 413 oversized, 422 JSON-pointer errors, 409 stale revision and ownership-safe 404 remain distinguishable. Preserve edits/modal on rejection; focus a linked summary and associate inline errors, then allow corrected input to re-enable Save.
- Successful saves refresh Client/product-scoped list/detail/capabilities. The user can continue editing; closing restores focus. Network failures use durable status, not another blocking modal.

### Delete Product Modal

**Pattern**: Confirmation modal (same as Users page deactivate confirmation).

**Trigger**: Red X icon button in Actions column.

**Content**:
- Title: "Delete Product"
- Body: "Are you sure you want to delete '[Product Name]'? Review affected bindings and retained or restricted submissions/images. Hard deletion is unavailable until the dependency policy (INPUT-07) is defined; archiving stops serving and retains records."
- Buttons: "Cancel" (secondary), "Delete Product" (red primary)

**Behavior**:
- On confirm: execute only the server-allowed action with expected revision; removal must record audit and durable edge cleanup before deletion.
- On success: table refreshes, user sees updated list
- On error: preserve context and show actionable inline/durable status; never imply successful cascade.

### AI Generate Button

**Ownership:** Stories 4.9/4.10 own text Generate/Preview/Regenerate/Apply/Dismiss; 5.11 owns actual-image submission/tracking. The Products editor (10.5) consumes these controls when delivered, without duplicate UI implementation or an AI prerequisite for manual work.

**Eligibility:** Server-selected internal policy or eligible customer policy, current permission, applicable AI flags, configured limits, provider/pricing and funded wallet. Internal Clients retain delivered feature eligibility without a subscription, but still need credits; customer free summary/onboarding does not enable editor generation. Show reason-specific feature unavailable, exhausted resource, unconfigured funding, insufficient credits or permission-denied guidance. No classification toggle or paid-upgrade prompt merely because an internal Client has no subscription.

**Behavior:** Preserve the draft during generation; preview before intentional Apply, validate the full merged draft with revisions, never auto-publish or debit twice. Regenerate is a new quoted operation. Timeout/unknown execution retains JobId and safe status/recovery; do not blindly resubmit. An image prompt is text generation; actual images use the async pipeline.

**Source documents:** Internal/eligible-customer source feature access is accepted, but PDF/business-plan ingestion and mini-RAG are excluded from this editor increment pending INPUT-08 and separate processing stories. Do not display an enabled upload-and-generate promise. Ordinary image upload is not document ingestion.

**Generated images:** 10.8 adopts the authorized private result into a durable product-owned asset after 5.10/5.11; never save an expiring result URL as a public image source.

### Image Upload (Inline per Section)

**Pattern**: Supported sections have ordinary image upload controls independent of AI. API/UX/Operations must finalize INPUT-06 transport, ownership, byte/dimension enforcement and cleanup before Story 10.6; the guidance below is not a complete storage policy. No AI Job or reservation is created by an upload.

**Hero Image**:
- Upload area: larger minimum size
- Guidelines displayed: "Min: 1200x630px (1.91:1 ratio), Max: 2MB"
- Accepted formats: JPG, PNG, WebP
- Preview shown after upload

**Feature Image**:
- Upload area: smaller minimum size
- Guidelines: "Min: 400x400px (1:1 ratio), Max: 1MB"
- Same accepted formats

**Image Guidelines Display**:
- Shown below each upload area
- Format: "Min: [dimensions] ([ratio]), Max: [size]MB"
- Helps users avoid negative SEO impact from oversized images

**Upload Flow**:
1. User drags/drops or clicks upload area
2. File validation (format, size)
3. Upload progress indicator
4. Preview thumbnail with remove option
5. Authorized product-owned asset reference is validated into the draft; publishing is separate. Preserve inputs and expose progress/retry/removal. No cross-Client asset references.

---

## State Patterns

### Product List States

| State | Condition | UI |
|-------|-----------|----|
| **Loading** | Initial data fetch | LoadingSpinner centered, "Loading products..." |
| **Empty** | No products exist | EmptyState with icon, title "No products yet", description "Create your first product to get started.", "Create Product" button |
| **Error** | API failure | ErrorDisplay with message and retry button |
| **Populated** | Products loaded | DataTable with columns, "Create Product" button in header |
| **Deleting** | Delete in progress | Row shows spinner or disabled state |
| **Creating** | Create in progress | Create modal shows spinner on submit |
| **Saving** | Edit in progress | Save button shows spinner, disabled |

### Edit Modal States

| State | Condition | UI |
|-------|-----------|----|
| **Fresh** | New product, no content | All fields empty, mandatory fields marked with * |
| **Loaded** | Existing product loaded | Fields populated with existing data |
| **Dirty** | Changes made | Save draft and Publish actions reflect their separate validation states; unsaved changes indicator |
| **Validating** | Save in progress | Save button shows spinner |
| **Validation Error** | JSON schema violation | Linked error summary and JSON-pointer inline errors; edits preserved and corrected input re-enables Save |
| **Saving** | API call in progress | Save button shows spinner, all inputs disabled |
| **Saved** | Save successful | Draft/live revision and result status update; continue editing or close with restored focus |

### Content Status States

| Status | Condition | Badge Color |
|--------|-----------|-------------|
| **Complete** | Valid required Hero and supported non-empty Form; optional Features/FAQ/Footer/SEO may be absent | Green (success) |
| **Incomplete** | Publication-required content missing/invalid; safe draft still allowed | Yellow (warning) |

### Domain Status States

| Status | Serving and UI |
|---|---|
| Pending verification | No serving; complete record instructions, last/next check, Verify now cooldown |
| Ownership verified / provisioning | No serving; independent routing and TLS progress, retain proof details |
| Active | Only valid ownership + routing + TLS + current capability/deadline and active published target |
| Failed campaign | No serving; observed issue and Retry; instructions remain visible |
| Suspended | No serving when applicable access deadline expires; specific policy/security reason |
| Ownership expired / TLS expired | No serving even with worker stopped; name which evidence expired |

Client-bound domains permit internal and Basic/Brand/Brand Premium customers; product-bound domains permit internal and Brand Premium customers. Multiple aliases may target one product; primary selection is among eligible aliases. Host release disables serving and persists cleanup before freeing the claim; current authorization/revision is rechecked.

## Interaction Primitives

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Escape` | Close modal (if not saving) |
| `Ctrl+S` / `Cmd+S` | Save draft in Edit modal |
| `Tab` / `Shift+Tab` | Navigate through focusable elements |

### Modal Behavior

- **Backdrop click**: Closes modal (if not saving)
- **Focus trap**: Modal traps focus within dialog (existing Modal component handles this)
- **Initial focus**: First input field in Create modal; close button in Edit modal
- **Scroll lock**: Body scroll disabled when modal is open
- **Restore focus**: Focus returns to trigger element on close

### Table Interactions

- **Row click**: Opens Edit modal (only on Name column click, not entire row)
- **Sort**: Click column header to toggle ascending/descending
- **Delete**: Click red X icon \u2192 confirmation modal \u2192 delete on confirm

### Form Interactions

- **Auto-save draft**: Consider implementing auto-save of unsaved changes (future)
- **Validation on blur**: Required field validation triggers when user leaves field
- **Validation on save**: Full schema validation triggers on Save button click
- **Slug auto-generate**: Click refresh button to auto-generate slug from name (lowercase, hyphens, remove special chars)

---

## Accessibility Floor

### WCAG 2.2 AA Compliance — UX-AIB-BASE

| Criterion | Implementation |
|-----------|----------------|
| **Keyboard navigation** | All interactive elements reachable via Tab; focus trap in modals |
| **Focus visible** | Focus rings use `focus-visible:ring-2 focus-visible:ring-indigo-600` (existing pattern) |
| **Color contrast** | Normal text including badges meets 4.5:1; meaningful non-text boundaries meet 3:1; verify actual token pairs |
| **ARIA labels** | Icon buttons have `aria-label`; modals have `aria-modal="true"` and `aria-labelledby` |
| **Screen reader** | Status changes announced via live regions; form errors announced on submit |
| **Reduced motion** | No animations that could trigger vestibular disorders |

### Screen Reader Announcements

| Event | Announcement |
|-------|-------------|
| Modal opens | "Dialog: [Title], [description]" |
| Modal closes | Focus returns to trigger element |
| Product created | "Product '[Name]' created successfully" (live region) |
| Product deleted | "Product '[Name]' deleted" (live region) |
| Save error | "Save failed: [error message]" (live region) |
| Content status change | "Content status changed to [Complete/Incomplete]" (live region) |

---

## User Journeys

### Journey A: Solo Product Owner (Freemium)

**Protagonist**: Sarah, runs a small SaaS called "FocusFlow". She's on the freemium tier with one product.

**Goal**: Create and configure her product landing page.

**Steps**:
1. Sarah logs into the back-office and clicks "Products" in the sidebar
2. She sees an empty state: "No products yet" with a "Create Product" button
3. She clicks "Create Product", fills in name "FocusFlow" and slug "focusflow"
4. The Edit modal opens immediately with the new product
5. She fills in the Hero Content section:
   - Title: "FocusFlow \u2014 AI-Powered Focus Tracking"
   - Subtitle: "Reclaim your attention"
   - Uploads a hero image
6. She fills in the Form section:
   - Adds an email capture field
   - Adds a "What describes you?" select field
7. She optionally fills in the Footer section:
   - Adds a "Product" section with links to Features and Pricing
8. She saves a safe draft; optional FAQ/Features/Footer/SEO absence does not make it incomplete. Publication completeness requires the validated Hero and supported non-empty Form with exactly one required, schema-discovered Email-profile field defined by INPUT-05.
9. She returns later, clicks the product name, adds Features and FAQ
10. The server reports completeness separately from publication/lifecycle.
11. She notices the "Generate with AI" buttons are grayed out with tooltip: "Upgrade to a paid plan to generate content with AI"
12. She publishes validated content; the UI shows its server-computed registered canonical URL, or URL not yet available.

### Journey B: Brand Customer (Brand Tier)

**Protagonist**: Marcus, marketing lead at "Acme Corp". They're on the Brand tier with a custom domain.

**Goal**: Configure their custom domain and bind their products to it.

**Steps**:
1. Marcus logs in and clicks "Domains" in the sidebar
2. He sees an empty domain list with "Add Domain" button
3. He clicks "Add Domain", enters "app.acmecorp.com"
4. He sees verification instructions: "Add this CNAME record to your DNS:"
   - Complete fresh token-specific CNAME record from the API, or TXT proof plus separate traffic-routing instructions; example zones are not provisioned assets.
5. He adds the DNS record and clicks "Verify"
6. Domain status shows "Pending Verification" (yellow badge)
7. Ownership can become verified while routing/TLS remain provisioning. Active requires all evidence; checks continue beyond five minutes, with a 48-hour campaign and safe Retry.
8. He goes to "Products" and sees his products listed with "app.acmecorp.com" in the Domain column
9. Once existing metered AI stories are delivered and eligibility/credits pass, he previews generated hero text and intentionally applies it to a validated draft. PDF ingestion is not delivered by this increment.
10. After publication and current domain eligibility, the server offers the registered Client-domain-plus-slug URL.

### Journey C: Admin Deletes Product

**Protagonist**: Jen, back-office admin.

**Goal**: Remove an archived product that's no longer needed.

**Steps**:
1. Jen navigates to Products page
2. She filters or scrolls to find the archived product
3. She clicks the red X icon in the Actions column
4. Confirmation modal appears: "Are you sure you want to delete 'Old Product'? This action cannot be undone."
5. She confirms only if the server permits removal under INPUT-07; otherwise she sees dependent-record guidance and can archive.
6. The server disables serving, records audit and durable binding cleanup before permitted deletion.
7. The refreshed list and durable status state the actual outcome.

---

## Concern Scan

### Accessibility
- Keyboard navigation for all interactions
- Screen reader announcements for state changes
- Color contrast compliance
- Focus management in modals

### Platforms
- Desktop-first (1280px+)
- Tablet responsive (768px+)
- 320px/400% reflow and real virtual-keyboard usability required

### Brand
- Consistent with existing back-office visual language
- AI features reflect internal/customer capability, permission, limits and metered credits
- Subscription tier messaging is clear but not pushy

### Content Density
- Edit modal is long-scrolling \u2014 sections are clearly separated
- AI Generate buttons add visual weight \u2014 consider spacing
- Use structured/stacked responsive rows; an isolated table scroll needs an equivalent view, no page-wide horizontal scrolling

### Input Modalities
- Mouse/trackpad primary
- Keyboard secondary (tab navigation, shortcuts)
- Touch/virtual-keyboard critical flows included under UX-AIB-BASE

### Notifications
- Success/error toasts for CRUD operations
- Live region announcements for screen readers
- Content status changes reflected immediately in table

### Performance
- Product list pagination (20 items per page, matching Users page pattern)
- Image upload progress indicators
- Debounced slug auto-generation

---

## Open Questions

> **Accepted OQ-001–004** (do not reopen; remaining inputs are listed separately):

| ID | Title | Priority | Description |
|----|-------|----------|-------------|
| OQ-001 | Subscription tier storage | Accepted | Explicit subscription tier; separate persisted Client classification and typed capability evaluation. |
| OQ-002 | Domain-product binding storage | Accepted | One domain_bindings registry; replace client_hosts and every consumer directly. |
| OQ-003 | JSON content validation | Accepted | Versioned canonical JSON Schema 2020-12, authoritative C# and browser runtime validation; strict publish and safe drafts. |
| OQ-004 | Domain verification flow | Accepted | Fresh token CNAME/TXT, durable polling, independent proof/routing/TLS; deterministic local doubles. |

> **Important** (should resolve before implementation):

| ID | Title | Priority | Description |
|----|-------|----------|-------------|
| OQ-005 | Domain page navigation position | Important | Where in the nav should Domains appear? After Products? Before Billing? |
| OQ-006 | Image upload mechanism | Important | How should image upload work? Direct to blob storage? Through back-office API? Accepted formats? Progress indicators? |
| OQ-007 | Dynamic form builder architecture | Resolved 2026-09-12 | Custom bounded supported-profile editor; no generic react-jsonschema-form/RJSF editor in v1. |
| OQ-008 | AI Generate implementation | Important | INPUT-08: document-source processing excluded from this increment until Product/API/UX define separate ingestion stories. Existing 4.9/4.10/5.11 own generation and draft/result integration. |
| OQ-009 | Content Status computation | Resolved 2026-09-12 | Publication requires valid Hero and a supported non-empty Form with exactly one required Email-profile field whose property name is configurable. Footer, Features/FAQ and SEO are optional. |
| OQ-010 | Delete confirmation behavior | Important | Archive vs hard delete? What happens to existing submissions linked to the product? |

> **Nice-to-have** (can iterate):

| ID | Title | Priority | Description |
|----|-------|----------|-------------|
| OQ-011 | Product templates | Future | Create from template (empty, hero-only, full landing page). Deferred after initial release. |
| OQ-012 | Auto-save drafts | Future | Auto-save unsaved changes in Edit modal. Deferred after initial release. |
| OQ-013 | Bulk actions | Future | Select multiple products for batch operations. Deferred after initial release. |

---

## Cross-References

| Element | Referenced In |
|---------|---------------|
| Modal component | `src/components/shared/Modal.tsx` |
| DataTable component | `src/components/shared/DataTable.tsx` |
| Badge component | `src/components/shared/Badge.tsx` |
| EmptyState component | `src/components/shared/EmptyState.tsx` |
| ErrorDisplay component | `src/components/shared/ErrorDisplay.tsx` |
| LoadingSpinner component | `src/components/shared/LoadingSpinner.tsx` |
| Permissions model | `src/auth/permissions.ts` |
| Sidebar navigation | `src/components/layout/Sidebar.tsx` |
| Query hooks | `src/hooks/useQueryHooks.ts` |
| Product types | `src/types/content.ts` |
| Billing types | `src/types/billing.ts` |
| Visual design specs | `DESIGN.md` |

## September 10 planning integration and evidence

See [approved resolution](../../soveris-business/_bmad-output/planning-artifacts/architectures/architecture-products-domains-oq-001-004-resolution.md), [contracts/input register](../../soveris-business/_bmad-output/planning-artifacts/specs/spec-backoffice-ui-implementation/products-domains-contracts.md), and [normative UX-AIB-BASE](../../soveris-business/_bmad-output/planning-artifacts/back-office-review/ux-ai-billing-phase-1-addendum.md). Products/Domains and tier surfaces inherit NFR-11/12/13 and the full verification gate, including keyboard, focus, screen reader, reflow/zoom, text spacing, forced colours, reduced motion and private-state transitions. The September 9 Story 2.8 exception does not defer new-story checks. Development uses only local Docker, explicit development bindings and deterministic DNS/edge doubles; real-edge launch evidence is future Epic 8 work. OQ-005 text is preserved and excluded from this amendment.
