---
title: "Back-Office Visual Design Tokens"
status: draft
updated: "2026-09-10"
created: "2026-09-07"
version: "1.0.0"
designSystem: "Tailwind CSS"
---

# Back-Office Visual Design Tokens

## Brand & Style

- **Identity**: Soveris Back-Office — professional, clean, productivity-focused
- **Style**: Minimal, content-dense, enterprise SaaS
- **Inspiration**: Linear, Vercel Dashboard, Stripe Dashboard
- **Tone**: Confident, efficient, uncluttered

## Colors

### Primary Palette

| Token | Value | Usage |
|-------|-------|-------|
| `primary-600` | `#4F46E5` (indigo-600) | Active nav items, primary buttons, focus rings |
| `primary-50` | `#EEF2FF` (indigo-50) | Active nav backgrounds |
| `primary-700` | `#4338CA` (indigo-700) | Primary button hover |

### Neutral Palette

| Token | Value | Usage |
|-------|-------|-------|
| `gray-950` | `#030712` | Primary text (headings) |
| `gray-900` | `#111827` | Body text |
| `gray-700` | `#374151` | Secondary text, inactive nav |
| `gray-500` | `#6B7280` | Tertiary text, placeholders |
| `gray-300` | `#D1D5DB` | Borders, dividers |
| `gray-200` | `#E5E7EB` | Table borders, card borders |
| `gray-100` | `#F3F4F6` | Page background, hover states |
| `gray-50` | `#F9FAFB` | Card backgrounds |
| `white` | `#FFFFFF` | Surface backgrounds |

### Semantic Colors

| Token | Value | Usage |
|-------|-------|-------|
| `success-600` | `#16A34A` (green-600) | Success badges, active status |
| `success-50` | `#F0FDF4` (green-50) | Success backgrounds |
| `warning-600` | `#D97706` (amber-600) | Warning badges, incomplete status |
| `warning-50` | `#FFFBEB` (amber-50) | Warning backgrounds |
| `error-600` | `#DC2626` (red-600) | Error badges, delete actions, inactive status |
| `error-50` | `#FEF2F2` (red-50) | Error backgrounds, delete hover |
| `info-600` | `#2563EB` (blue-600) | Info badges, admin role |
| `info-50` | `#EFF6FF` (blue-50) | Info backgrounds |

### Contrast Requirements

- Normal text, including small text/badge labels, meets at least 4.5:1. Large text and meaningful non-text boundaries meet their applicable 3:1 requirement.
- Verify actual foreground/background pairs, focus, forced colours and disabled guidance; token labels are not measured evidence. No unverified success-600 contrast claim.
- Products/Domains/tier surfaces inherit WCAG 2.2 AA and UX-AIB-BASE; preserve the existing system while correcting failing combinations.

## Typography

### Type Scale

| Token | Size | Weight | Line Height | Usage |
|-------|------|--------|-------------|-------|
| `heading-xl` | 1.25rem (20px) | semibold (600) | 1.4 | Page titles |
| `heading-lg` | 1.125rem (18px) | semibold (600) | 1.4 | Modal titles, section headings |
| `heading-md` | 1rem (16px) | semibold (600) | 1.5 | Subsection headings |
| `body-base` | 0.875rem (14px) | normal (400) | 1.5 | Body text, table cells |
| `body-sm` | 0.75rem (12px) | normal (400) | 1.5 | Labels, captions, badges |
| `body-xs` | 0.6875rem (11px) | normal (400) | 1.4 | Monospace text, slugs |

### Font Family

- **Primary**: System font stack (Tailwind `font-sans`)
- **Monospace**: System monospace (Tailwind `font-mono`) for slugs, IDs

```css
/* Tailwind defaults are sufficient — no custom font imports needed */
font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
```

## Spacing

### Spacing Scale

| Token | Value | Usage |
|-------|-------|-------|
| `space-1` | 0.25rem (4px) | Tight gaps, icon spacing |
| `space-2` | 0.5rem (8px) | Small gaps, padding |
| `space-3` | 0.75rem (12px) | Button padding, card padding |
| `space-4` | 1rem (16px) | Standard gap, section padding |
| `space-6` | 1.5rem (24px) | Large gaps, page padding |
| `space-8` | 2rem (32px) | Page padding, section spacing |

### Layout Spacing

| Element | Spacing |
|---------|---------|
| Page container padding | `px-4 py-6 sm:px-6 lg:px-8` |
| Card inner padding | `p-4 sm:p-6` |
| Table cell padding | `px-4 py-3` |
| Form field gap | `space-y-4` |
| Section separator | `border-t border-gray-200 my-4` |

## Elevation & Depth

| Token | Shadow | Usage |
|-------|--------|-------|
| `shadow-sm` | `0 1px 2px 0 rgb(0 0 0 / 0.05)` | Table rows, small cards |
| `shadow-md` | `0 4px 6px -1px rgb(0 0 0 / 0.1)` | Cards, dropdowns |
| `shadow-lg` | `0 10px 15px -3px rgb(0 0 0 / 0.1)` | Modals |
| `shadow-xl` | `0 20px 25px -5px rgb(0 0 0 / 0.1)` | Modal dialog surface |

### Modal Elevation

- **Backdrop**: `bg-black/50` (50% opacity black overlay)
- **Dialog**: `bg-white shadow-xl rounded-lg`
- **Z-index**: Modal uses `fixed inset-0 z-50` (matches existing pattern)

## Shapes

| Token | Value | Usage |
|-------|-------|-------|
| `rounded-sm` | 0.125rem (2px) | Tight rounded corners |
| `rounded` | 0.25rem (4px) | Input fields, small buttons |
| `rounded-md` | 0.375rem (6px) | Buttons, badges, cards |
| `rounded-lg` | 0.5rem (8px) | Modal dialog, larger cards |
| `rounded-full` | 9999px | Avatar circles, pill badges |

## Components

### Sidebar Navigation

**Active state**:
- Background: `bg-indigo-50`
- Text: `text-indigo-700`
- Font: `font-medium`

**Inactive state**:
- Background: transparent
- Text: `text-gray-700`
- Hover: `hover:bg-gray-50 hover:text-gray-900`

**Icon size**: `text-lg` (20px)

**Link height**: `min-h-11` (44px) for touch target

### Data Table

**Header**:
- Background: `bg-gray-50`
- Text: `text-gray-500`, `text-xs`, `font-medium`, `uppercase`
- Border bottom: `border-b border-gray-200`

**Row**:
- Default: `border-b border-gray-200`
- Hover: `hover:bg-gray-50`
- Last row: no bottom border

**Cell**:
- Padding: `px-4 py-3`
- Text: `text-sm text-gray-900`

### Badges

| Variant | Background | Text | Border |
|---------|-----------|------|--------|
| `success` | `bg-green-50` | `text-green-700` | `border-green-200` |
| `warning` | `bg-amber-50` | `text-amber-700` | `border-amber-200` |
| `error` | `bg-red-50` | `text-red-700` | `border-red-200` |
| `info` | `bg-blue-50` | `text-blue-700` | `border-blue-200` |
| `neutral` | `bg-gray-100` | `text-gray-700` | `border-gray-200` |

**Badge sizing**:
- Padding: `px-2 py-0.5`
- Font: `text-xs font-medium`
- Rounded: `rounded-full`

### Buttons

**Primary button**:
- Background: `bg-indigo-600`
- Text: `text-white`
- Hover: `hover:bg-indigo-700`
- Disabled: `opacity-50 cursor-not-allowed`
- Padding: `px-4 py-2`
- Font: `text-sm font-medium`
- Rounded: `rounded-md`

**Secondary button**:
- Background: `bg-white`
- Border: `border border-gray-300`
- Text: `text-gray-700`
- Hover: `hover:bg-gray-50`

**Danger button**:
- Background: `bg-red-600`
- Text: `text-white`
- Hover: `hover:bg-red-700`

**Icon button** (delete X):
- Icon: `text-red-600`
- Hover: `hover:text-red-700 hover:bg-red-50`
- Size: `p-2`
- Rounded: `rounded-md`
- Focus: `focus-visible:ring-2 focus-visible:ring-red-600`

### Modal

**Header**:
- Border bottom: `border-b border-gray-200`
- Padding: `px-4 py-3 sm:px-6 sm:py-4`
- Title: `text-lg font-semibold text-gray-950`

**Body**:
- Padding: `px-4 py-4 sm:px-6`
- Scroll: `overflow-y-auto` (for long forms)

**Footer**:
- Border top: `border-t border-gray-200`
- Padding: `px-4 py-4 sm:px-6`
- Button alignment: `flex justify-end gap-3`

### Form Inputs

**Text input / textarea**:
- Border: `border border-gray-300`
- Padding: `px-3 py-2`
- Focus ring: `focus:ring-2 focus:ring-indigo-500 focus:border-transparent`
- Rounded: `rounded-md`
- Font: `text-sm`

**Select**:
- Same as text input
- Arrow indicator via native browser styling

**Label**:
- Font: `text-sm font-medium`
- Color: `text-gray-700`
- Bottom margin: `mb-1`

### AI Generate Button

**Enabled state**:
- Icon: `sparkles` (\u2728)
- Text: "Generate with AI"
- Color: `text-indigo-600`
- Hover: `text-indigo-700 bg-indigo-50`
- Size: `text-xs`

**Disabled state**:
- Color: `text-gray-400`
- Cursor: `cursor-not-allowed`
- Opacity: `opacity-50`
- Durable accessible explanation from server denial: feature unavailable, limit reached, missing configuration/funding, insufficient credits or permission loss. A tooltip alone is insufficient. Internal without subscription is not a paid-upgrade case.

### Image Upload Area

**Default state**:
- Border: `border-2 border-dashed border-gray-300`
- Rounded: `rounded-md`
- Padding: `py-8`
- Hover: `border-gray-400 bg-gray-50`
- Background: `bg-gray-50`

**Guidelines text**:
- Font: `text-xs text-gray-500`
- Margin top: `mt-2`

---

## Do's and Don'ts

### Do
- Use the existing Modal component for all dialogs
- Use Badge components for all status indicators
- Follow the existing permission gating pattern
- Use TanStack Query for all data fetching
- Keep the sidebar navigation pattern consistent
- Use system fonts (no custom font imports)
- Maintain 4.5:1 contrast for all body text
- Use indigo-600 as the primary action color

### Don't
- Don't introduce new color tokens without approval
- Don't change the modal component API
- Don't use inline styles (use Tailwind classes)
- Don't add animations without design approval
- Don't change the sidebar navigation structure
- Don't use non-system fonts
- Don't reduce contrast below WCAG 2.2 AA
- Don't add hover effects that change layout (causes jank)

## Products & Domains release states

Use distinct labelled lifecycle/publication/completeness and ownership/routing/TLS badges. Preserve input/focus on validation/revision errors. Layout must reflow at 320px/400% zoom and remain usable with virtual keyboards; primary desktop layout does not exclude these checks. Existing 4.9/4.10/5.11 own metered AI UI. No new-story accessibility evidence deferral is granted.
