---
name: "CVS — Industrial Editorial Design System"
description: "Dark-first industrial editorial design system combining warm obsidian surfaces, bone typography, vermilion signal accents, and 1px hairline grids for the Candidate Verification System."
---

## Overview

The **Candidate Verification System (CVS)** design system merges the tactile, Swiss-editorial precision of **Studio 01** (`website-v2`) with the operational clarity required for an enterprise recruitment verification platform. Designed for Admins, Recruiters, and Reviewers, it replaces generic SaaS gradients and neon clutter with warm obsidian surfaces (`#0E0E0C`), crisp bone-white typography (`#E8E3D6`), signal vermilion (`#FF4D1C`) reserved strictly for primary actions and active focus, and `1px` hairline borders that organize dense verification tables, resume findings, and audit timelines without visual fatigue.

- **Design Style:** Industrial Editorial / High-Contrast Dark Utility
- **Primary Audience:** Recruitment Operations Admins, Recruiters, and Compliance Reviewers
- **Emotional Tone:** Trustworthy, deliberate, auditable, and calm under high data density

## Colors

The palette anchors on a warm obsidian ground (`#0E0E0C`) and elevated charcoal-stone containers (`#141411`, `#1A1A16`, `#23231E`) to eliminate harsh `#000000` halation. Bone parchment (`#E8E3D6`) carries primary information, while muted stone (`#9E9B90`) handles secondary metadata. Signal vermilion (`#FF4D1C`) is used with extreme restraint for primary calls to action, active navigation indicators, and key focal highlights. Semantic status hues (`success`, `warning`, `error`, `info`) communicate verification states only—never decoration.

```yaml
colors:
  primary: "#FF4D1C"
  on-primary: "#0E0E0C"
  primary-container: "#3C0800"
  on-primary-container: "#FFDBD2"
  surface: "#0E0E0C"
  surface-container-low: "#141411"
  surface-container: "#1A1A16"
  surface-container-high: "#23231E"
  on-surface: "#E8E3D6"
  on-surface-variant: "#9E9B90"
  outline: "#5F5E5B"
  outline-variant: "#2B2A26"
  success: "#58D68D"
  on-success: "#0E0E0C"
  warning: "#F59E0B"
  on-warning: "#0E0E0C"
  error: "#FF5449"
  on-error: "#0E0E0C"
  info: "#63A4FF"
  on-info: "#0E0E0C"
```

## Typography

A three-family typographic system balances architectural authority with operational legibility:

- **Headline (`Inter Tight`):** Tight tracking (`-0.03em` to `-0.045em`) for page titles, KPI figures, and section headers.
- **Body (`Inter`):** Neutral, high-legibility sans-serif for table cells, candidate details, comments, and form controls.
- **Mono (`IBM Plex Mono`):** Uppercase with tracked spacing (`0.06em`) for verification IDs, timestamps, numbered indices (`01`, `02`), status badges, and table column headers. All numeric metrics and dates must use `tabular-nums`.

```yaml
typography:
  display-lg:
    fontFamily: "Red Hat Display"
    fontSize: 44px
    fontWeight: 500
    lineHeight: 48px
    letterSpacing: -1.6px
  display-lg-mobile:
    fontFamily: "Red Hat Display"
    fontSize: 32px
    fontWeight: 500
    lineHeight: 36px
    letterSpacing: -1.0px
  headline-lg:
    fontFamily: "Red Hat Display"
    fontSize: 30px
    fontWeight: 500
    lineHeight: 34px
    letterSpacing: -0.9px
  headline-md:
    fontFamily: "Red Hat Display"
    fontSize: 22px
    fontWeight: 500
    lineHeight: 28px
    letterSpacing: -0.5px
  title-lg:
    fontFamily: "Red Hat Display"
    fontSize: 18px
    fontWeight: 500
    lineHeight: 24px
    letterSpacing: -0.3px
  title-md:
    fontFamily: "Carrois Gothic"
    fontSize: 15px
    fontWeight: 500
    lineHeight: 22px
    letterSpacing: -0.1px
  body-md:
    fontFamily: "Carrois Gothic"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 22px
    letterSpacing: 0px
  body-sm:
    fontFamily: "Carrois Gothic"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 20px
    letterSpacing: 0px
  label-lg:
    fontFamily: "Geist Mono"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 16px
    letterSpacing: 0.72px
  label-sm:
    fontFamily: "Geist Mono"
    fontSize: 11px
    fontWeight: 400
    lineHeight: 14px
    letterSpacing: 0.66px
```

## Layout & Spacing

The application uses a persistent **App Shell** on desktop (`1280px+`): a `240px` left sidebar (`surface-container-low`) separated by a `1px` `outline-variant` vertical rule, a `64px` sticky top bar (`surface`) with breadcrumb, global candidate search, and live backend health status, and a fluid `12-column` main workspace (`max-w-[1440px]`). On tablet and mobile (`< 1024px`), the sidebar collapses behind a top-bar menu trigger and multi-column KPI/chart grids stack cleanly to a single column.

```yaml
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
```

## Elevation & Depth

Hierarchy is established through **hairline borders and tonal stepping** rather than drop shadows or heavy blur:

- **Tonal Layers:** Ground (`surface`) → Sidebar (`surface-container-low`) → Cards & Tables (`surface-container`) → Hover / Active Popovers (`surface-container-high`).
- **Hairline Grid:** `1px` borders in `outline-variant` (`#2B2A26`) define card boundaries, table rows, and header/sidebar dividers.
- **Atmospheric Texture:** A subtle, non-interactive `5%` opacity SVG fractal-noise grain overlay may sit on the background canvas (`pointer-events: none`), paired with a restrained wireframe/low-poly 3D verification shield emblem in hero or brand moments.

## Shapes

Sharp, architectural corners reinforce the precision of an audit and verification tool. Avoid pill-shaped cards or overly soft radii.

```yaml
rounded:
  none: 0px
  sm: 2px
  DEFAULT: 4px
  md: 6px
  lg: 8px
  full: 9999px
```

## Motion & Micro-interaction

Motion is crisp, purposeful, and never decorative. Interactive controls respond immediately; table rows and list items use a subtle horizontal micro-shift (`translateX(4px)`) on hover inspired by the editorial work rows in `website-v2`. Honor `prefers-reduced-motion` across all transitions.

```yaml
motion:
  state-change:
    duration: 150ms
    delay: 0ms
    timingFunction: cubic-bezier(0.2, 0, 0, 1)
  row-shift:
    duration: 280ms
    delay: 0ms
    timingFunction: cubic-bezier(0.6, 0, 0.2, 1)
  surface-enter:
    duration: 240ms
    delay: 0ms
    timingFunction: cubic-bezier(0.2, 0, 0, 1)
```

## Voice & Content Strategy

- **Tone:** Neutral, factual, and audit-ready. Never frame automated resume/document checks as proof of fraud or misconduct; use phrases like `"Not detected"`, `"Needs review"`, or `"Potential inconsistency"`.
- **Capitalisation:** Sentence case for headings, buttons, and body copy; uppercase monospace for section indices (`(01) OVERVIEW`), table column headers, and status pills.
- **Action Labels:** Specific verb-noun pairs (`"Import CSV"`, `"Start verification"`, `"Assign reviewer"`, `"Request information"`), never `"Submit"` or `"OK"`.
- **Numbers & Dates:** Use ISO-style or unambiguous short dates (`24 Nov 2026, 14:32 IST`) and `tabular-nums` on all counts, percentages, and IDs (`VER-2048`, `CAND-0891`).

## Components

Component implementations live as individual HTML sticker sheet files in
`components/`. Each file contains the canonical, styled HTML components with
`<!-- COMPONENT: name -->` comment markers. Read each file before use.

- **Badge** → `@components/badge.html`: `badge-numeric`, `badge-dot`
- **Button** → `@components/button.html`: `button-primary`, `button-icon`, `button-with-icon`
- **Card** → `@components/card.html`: `card-elevated`, `card-action`, `card-interactive`, `card-interactive-2`
- **Table** → `@components/table.html`: `table-standard`, `table-interactive`, `table-selectable`
- **Typography** → `@components/typography.html`: `typography-display`, `typography-body`, `typography-label`
