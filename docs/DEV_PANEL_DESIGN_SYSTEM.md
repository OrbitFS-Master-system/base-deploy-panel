# OrbitFS Dev Panel Design System

This document is the source of truth for the Dev Panel visual language. New screens and converted screens should follow this contract instead of inventing one-off styles.

## Product feel

OrbitFS Dev Panel is a dense operational workstation, not a generic SaaS dashboard.

The interface should feel:
- technical
- compact
- calm
- authoritative
- highly scannable
- dark-first
- information-dense without being cluttered

Avoid oversized marketing cards, large empty hero areas, repeated summaries, decorative gradients that compete with data, and multiple widgets showing the same state.

## Application shell

Desktop:
- fixed top bar: 72px
- persistent left navigation: 264px
- content fills remaining width
- grouped navigation: Operate / Control / Govern
- user and system connection state live in the top-right
- OrbitFS identity lives in the sidebar on desktop
- mobile keeps a compact brand in the top bar and a horizontal navigation strip

Main content should use a wide workstation canvas rather than a narrow centered website column.

## Core colors

Background:
- app: #06080c
- sidebar: #080b10
- control/panel dark: #090d13 / #0a0f16
- raised panel: approximately #0e131b

Primary:
- Orbit blue: #6d8cff
- brighter blue: #7898ff
- blue text/accent: #7f9cff to #a7bbff

Text:
- primary: #f5f7fb
- secondary: #cfd7e3
- muted: #8694a7
- dim labels: #627084

Borders:
- default: rgba(255,255,255,.07)
- inner separators: rgba(255,255,255,.05)

## Semantic status colors

Status must never blend into the panel background.

Success:
- published
- approved
- passed
- success
- connected
- enabled
- ready
- active
- received
- open

Warning:
- pending
- queued
- running
- draft
- waiting
- review
- request
- assigned

Danger:
- failed
- failure
- rejected
- error
- offline
- unavailable
- disabled
- unpublished

Info:
- informational or transitional states that are not success/warning/danger

Neutral:
- archived
- idle
- closed
- not run
- not validated

Do not use the same blue treatment for all statuses.

## Typography

- page title: 2.0–2.2rem, tight tracking
- section title: ~0.76rem, semibold
- nav title: ~0.73rem
- table/body technical text: ~0.62–0.72rem
- helper/meta text: ~0.54–0.62rem
- uppercase operational labels: ~0.55–0.60rem with tracking

## Panels

Panels use:
- 1px low-contrast border
- 13–14px radius
- dark raised surface
- very subtle inset highlight
- compact 0.7–1rem padding
- separators instead of nested cards whenever possible

Prefer one panel with rows over multiple cards repeating the same information.

## Page structure

Every page should normally have:
1. page eyebrow / operational area
2. page title and one short description
3. page-specific actions
4. primary working surface
5. optional right-side operational rail only if it adds unique information

Do not repeat the same counts in the page metrics, right rail, table header, and status card. Each fact should have one primary home.

## Overview

Overview should contain:
- current release summary metrics
- recent releases table
- one system-status rail
- release channels
- current workflow state
- release activity / pipeline explanation

Do not repeat validation/pending/workflow counts in more than one area.

## Base Deployment workbench

Stages:
1. Inspect source
2. Version & changes
3. Build package
4. License Master

Keep:
- source repository/ref/commit
- previous approved baseline
- deployment log
- changed commits/files
- package/manifest/checksum state
- technical validation/lifecycle

License Manager stays technical authority.

## Update Releaser workbench

Stages:
1. Inspect Engine
2. Compatibility
3. Package update
4. Release handoff

Keep:
- Engine source/ref/commit
- update target/component selection
- minimum Base version
- minimum deployer protocol
- changed commits/files
- update changelog
- artifact/manifest/checksum
- License Manager technical approval
- Billing Store final publication state
- Customer Portal visibility state

Do not expose a Dev Panel customer Publish action.

## Release registry

Use a dense table/list with release/version, type, channel, validation, review, status, and lifecycle actions.

Filters stay in one compact filter bar.

## Monitoring

Monitoring should show License Manager connectivity, current GitHub worker/run, repository worker state, validation failures, pending technical review, and release activity.

Do not duplicate the same workflow details in both a metric card and a second status card unless one adds new detail.

## Channels

Core channel policy must remain visible even if access requests or assignments are temporarily unavailable.

Display one degraded-state notice rather than repeating backend errors in multiple panels.

## Customer Portal

This screen is monitoring/read-only from Dev Panel. It can show customer-visible releases, channel actions/access modes, and publication state.

Billing Store remains the final publication gate for Updates.

## Forms

Inputs:
- dark solid background
- visible border
- 10px radius
- clear blue focus ring
- labels above controls

Buttons:
- primary = Orbit blue
- secondary = subtle dark surface
- destructive actions should not look like primary blue actions

## Information density rules

- remove repeated authority explanations if the page already has an authority rail
- one status badge per state field
- one primary count per metric
- collapse duplicate health summaries
- prefer compact row detail over separate cards
- use right rails for unique contextual state, not repeated KPIs

## Responsive behavior

Desktop layout starts at tablet/desktop-like viewport widths so browser “Desktop site” mode on phones can still show the workstation shell.

Below the desktop breakpoint:
- sidebar becomes horizontal mobile navigation
- tables may collapse to stacked rows
- preserve status color and hierarchy
- do not hide critical release state

## Conversion rule

When converting an existing or new page to Dev Panel design:
1. preserve functionality first
2. map the page into the shared shell
3. replace one-off cards with shared panel patterns
4. convert state text to semantic status badges
5. remove duplicate information
6. add a right rail only for unique operational context
7. verify desktop and compact layouts
8. verify no authority boundary changed
